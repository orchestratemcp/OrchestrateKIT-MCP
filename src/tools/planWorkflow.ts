/**
 * plan_workflow — MAR-100 meta-tool.
 *
 * Single-call planner that replaces the manual 5-tool ritual
 * (list_known_routes → get_route → compose_workflow_route →
 * get_stack_recommendation → review_workflow_design).
 *
 * It runs one composeRoute pass, then:
 *  - decides plan_source: when a validated playbook matches the goal with high
 *    enough recall and PRECISION (recall ≥ 0.60, precision ≥ 0.72 — see the
 *    threshold block below; the precision floor was retuned in MAR-130) it LEADS
 *    WITH THE PLAYBOOK's golden-path route rather than the composed candidate.
 *    This operationalises the MAR-98 finding that for playbook-matched requests
 *    the validated route is the right answer and compose output is noise.
 *  - runs the deterministic review rule set on the chosen route's component set
 *    and inlines the safety findings.
 *  - inlines the stack recommendation and the MAR-116 model-tier profile.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Component } from "../registry/componentSchema.js";
import { loadRegistry } from "../registry/registryLoader.js";
import {
  composeRoute,
  computeModelTierProfile,
  computeCredentialAdvisory,
  toRouteStep,
  type ComposeInput,
  type CredentialAdvisory,
  type RegistrySnapshot,
  type RouteStep,
} from "../graph/routeComposer.js";
import {
  computeExecutionOrder,
  detectAvoidViolations,
  edgesWithinSet,
  type AvoidViolation,
} from "../graph/routeOrdering.js";
import { ALWAYS_REQUIRES_GATE } from "../graph/safetyAugmenter.js";
import { findOverlappingPlaybooks } from "../graph/playbookOverlap.js";
import { buildReviewContext } from "./reviewWorkflowDesign.js";
import { ALL_RULES } from "../review/rules/index.js";
import {
  calculateRiskScore,
  deriveStatus,
  type ReviewFinding,
} from "../review/types.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ───────────────────────────── types ─────────────────────────────

export type PlanSource = "playbook" | "composed";

export type PlanWorkflowInput = ComposeInput;

/**
 * plan_workflow's own playbook-routing thresholds (MAR-100, retuned in MAR-130).
 *
 * The MAR-98 split is PRECISION-driven: a genuine playbook match produces a
 * high-precision composed set (almost everything compose picked is in the
 * playbook), whereas a goal whose primary domain is something else only overlaps
 * a playbook because of generic glue (intent_classifier + the auto-added
 * human_approval_gate / audit_log) plus a couple of lexically-injected
 * components — high recall, mediocre precision.
 *
 * MAR-130 regression: the old precision floor of 0.60 let `email_calendar_assistant`
 * lead 5/10 dogfood sessions across CRM / invoice / HR / social, dropping the real
 * primary-domain component (e.g. crm_note_write) for calendar_lookup/calendar_write.
 * compose's MAR-91 guard (recall ≥ 0.80) correctly rejected those, but it is NOT
 * applied here — plan_workflow has this separate, weaker gate.
 *
 * Calibration across the canonical goals cleanly separates the two populations by
 * PRECISION (recall is too low for genuine data/research/codebase to use the 0.80
 * compose floor):
 *   genuine playbook (keep):   research 0.83 · content 0.78 · email 0.73 · codebase 1.00 · data 0.83  (min 0.73)
 *   over-match / composed:     CRM 0.63 · invoice 0.67 · HR 0.70 · social 0.44 · p6 0.50 · p7 0.50    (max 0.70)
 * A precision floor of 0.72 sits in the gap and downgrades every over-match
 * (including HR) to a composed candidate while keeping all genuine matches.
 */
const PLAYBOOK_RECALL_MIN = 0.6;
const PLAYBOOK_PRECISION_MIN = 0.72;

export type SafetyReview = {
  status: "pass" | "warnings" | "fail";
  risk_score: number;
  blocking_issues: string[];
  warnings: string[];
  approval_gates_required: string[];
};

export type PlanPlaybook = {
  id: string;
  title: string;
  route_id: string;
  confidence: number;
  recall: number;
  precision: number;
};

/**
 * Surfaced when the goal explicitly opts out of human approval (unattended /
 * no-gate / fully automated) but the route still contains an irreversible
 * external write that warrants a gate (MAR-132). The gate is KEPT in the route
 * as a strong recommendation rather than dropped — never silently removed — and
 * moved out of `required_approval_gates` so the output stops contradicting the
 * user's stated constraint.
 */
export type ApprovalGateAdvisory = {
  gate: string;
  write_components: string[];
  reason: string;
};

/**
 * Explicit "no human gate" phrases. Substring-matched on the lowercased goal.
 * Deliberately narrow — only unambiguous opt-outs, never bare "automated".
 */
const UNATTENDED_WAIVER_SIGNALS = [
  "unattended",
  "no human",
  "without human",
  "no approval",
  "without approval",
  "no gate",
  "without a gate",
  "no manual approval",
  "fully automated",
  "fully autonomous",
];

/** True when the goal explicitly waives a human approval gate (MAR-132). */
export function hasUnattendedWaiver(goal: string): boolean {
  const g = goal.toLowerCase();
  return UNATTENDED_WAIVER_SIGNALS.some((s) => g.includes(s));
}

export type PlanWorkflowOutput = {
  plan_source: PlanSource;
  goal: string;
  summary_markdown: string;
  recommended_route: RouteStep[];
  planning_order: string[];
  execution_order: string[];
  model_tier_profile: {
    frontier: string[];
    standard: string[];
    small: string[];
    none: string[];
  };
  /** Present when plan_source === "playbook". */
  playbook: PlanPlaybook | null;
  route_status: string;
  route_score: number;
  confidence_label: string;
  stack: object;
  safety_review: SafetyReview;
  credential_advisory: CredentialAdvisory;
  untested_edges: string[];
  avoid_when_violations: AvoidViolation[];
  required_approval_gates: string[];
  /**
   * Non-null when the goal explicitly opted out of a human gate but the route
   * still performs an irreversible external write (MAR-132). The gate stays in
   * `recommended_route` as a strong recommendation; it is just not listed in
   * `required_approval_gates`.
   */
  approval_gate_advisory: ApprovalGateAdvisory | null;
  evals_to_add: string[];
  next_steps: string[];
};

// ───────────────────────────── core ─────────────────────────────

/** Resolve component IDs to Component objects, preserving order, dropping unknowns. */
function resolveComponents(ids: string[], registry: RegistrySnapshot): Component[] {
  const byId = new Map(registry.components.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is Component => c !== undefined);
}

/** Run the deterministic review rule set over a route's component set. */
function reviewRoute(
  goal: string,
  componentIds: string[],
  riskLevel: string | undefined,
  registry: RegistrySnapshot,
): SafetyReview {
  const ctx = buildReviewContext(
    {
      goal,
      component_ids: componentIds,
      agents: [],
      tools: [],
      integrations: [],
      risk_level: riskLevel as "low" | "medium" | "high" | "critical" | undefined,
    },
    registry,
  );

  const findings: ReviewFinding[] = ALL_RULES.flatMap((rule) => rule(ctx));
  const risk_score = calculateRiskScore(findings);
  const status = deriveStatus(risk_score, findings);

  const blocking_issues = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => f.message);
  const warnings = findings
    .filter((f) => f.severity === "medium" || f.severity === "low")
    .map((f) => f.message);
  const approval_gates_required = findings.some(
    (f) =>
      f.category === "approval_gate" &&
      (f.severity === "critical" || f.severity === "high"),
  )
    ? ["human_approval_gate"]
    : [];

  return { status, risk_score, blocking_issues, warnings, approval_gates_required };
}

/** Untested edges fully within the route's component set. */
function untestedEdgesWithin(
  componentIds: string[],
  registry: RegistrySnapshot,
): string[] {
  return edgesWithinSet(new Set(componentIds), registry.edges)
    .filter((e) => !e.tested)
    .map((e) => e.id);
}

function buildPlanMarkdown(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  playbook: PlanPlaybook | null,
  safety: SafetyReview,
  modelTiers: PlanWorkflowOutput["model_tier_profile"],
  credentials: CredentialAdvisory,
  untestedEdges: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
): string {
  const lines: string[] = [];

  if (planSource === "playbook" && playbook) {
    lines.push(
      `## ✅ Plan: use validated playbook \`${playbook.id}\``,
      ``,
      `**Goal:** ${goal}`,
      ``,
      `> This goal is covered by the validated playbook **${playbook.title}** ` +
        `(\`${playbook.id}\`, route \`${playbook.route_id}\`, recall ${Math.round(playbook.recall * 100)}%, ` +
        `precision ${Math.round(playbook.precision * 100)}%). The plan below is its golden-path route — ` +
        `prefer it over a freshly composed candidate.`,
      ``,
    );
  } else {
    lines.push(
      `## 🧩 Plan: composed candidate route`,
      ``,
      `**Goal:** ${goal}`,
      ``,
      `> No validated playbook strongly matches this goal, so this is a CANDIDATE route ` +
        `composed from the graph. Review the untested edges and safety findings before building.`,
      ``,
    );
  }

  lines.push(`### Steps`, ``);
  for (const s of steps) {
    const tierTag = s.model_tier === "none" ? "deterministic" : `${s.model_tier} LLM`;
    lines.push(
      `${s.step}. **\`${s.component_id}\`** [${tierTag}, risk: \`${s.risk_level}\`] — ${s.purpose}`,
    );
  }
  lines.push(``);

  lines.push(`### Model-tier profile`, ``);
  if (modelTiers.frontier.length > 0)
    lines.push(`- **frontier:** ${modelTiers.frontier.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.standard.length > 0)
    lines.push(`- **standard:** ${modelTiers.standard.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.small.length > 0)
    lines.push(`- **small:** ${modelTiers.small.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.none.length > 0)
    lines.push(`- **deterministic (no LLM):** ${modelTiers.none.map((c) => `\`${c}\``).join(", ")}`);
  lines.push(``);

  const safetyEmoji =
    safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  lines.push(
    `### Safety review`,
    ``,
    `**Status:** ${safetyEmoji} ${safety.status.toUpperCase()} | **Risk score:** ${safety.risk_score}/100`,
    ``,
  );
  if (safety.blocking_issues.length > 0) {
    lines.push(`**Blocking issues (${safety.blocking_issues.length}):**`);
    for (const b of safety.blocking_issues) lines.push(`- ${b}`);
    lines.push(``);
  }
  if (approvalAdvisory) {
    lines.push(
      `**⚠️ Approval gate (advisory, not enforced):** ${approvalAdvisory.reason}`,
      ``,
    );
  }
  if (safety.approval_gates_required.length > 0) {
    lines.push(
      `**Approval gates required:** ${safety.approval_gates_required.map((g) => `\`${g}\``).join(", ")}`,
      ``,
    );
  }

  if (credentials.components_requiring_credentials.length > 0) {
    lines.push(`### Credentials & permissions`, ``);
    for (const c of credentials.components_requiring_credentials) {
      const scopes = c.required_scopes.length > 0 ? c.required_scopes.join("; ") : "see component docs";
      lines.push(`- **\`${c.component_id}\`** needs: ${scopes}`);
    }
    if (credentials.secret_manager_recommendation) {
      lines.push(``, `> ${credentials.secret_manager_recommendation}`);
    }
    lines.push(``);
  }

  if (untestedEdges.length > 0) {
    lines.push(
      `### Untested edges (${untestedEdges.length})`,
      ``,
      `${untestedEdges.slice(0, 8).map((e) => `\`${e}\``).join(", ")}${untestedEdges.length > 8 ? " …" : ""}`,
      ``,
    );
  }

  return lines.join("\n");
}

export function planWorkflow(
  input: PlanWorkflowInput,
  registry: RegistrySnapshot,
): PlanWorkflowOutput {
  // ── Step 1: one compose pass does most of the work ──
  const composed = composeRoute(input, registry);

  // ── Step 2: plan_workflow's own precision-aware playbook routing (MAR-98) ──
  const composedIds = new Set(composed.recommended_route.map((s) => s.component_id));
  const bestOverlap = findOverlappingPlaybooks(composedIds, registry.playbooks, 0.3)[0];
  const playbookMatch =
    bestOverlap &&
    bestOverlap.overlap_fraction >= PLAYBOOK_RECALL_MIN &&
    bestOverlap.precision >= PLAYBOOK_PRECISION_MIN
      ? bestOverlap
      : null;
  const planSource: PlanSource = playbookMatch ? "playbook" : "composed";

  // ── Step 3: build the route depending on plan_source ──
  let steps: RouteStep[];
  let planningOrder: string[];
  let executionOrder: string[];
  let playbook: PlanPlaybook | null = null;
  let routeComponentIds: string[];

  if (planSource === "playbook" && playbookMatch) {
    // Lead with the validated playbook's golden-path route (MAR-98).
    const pb = registry.playbooks.find((p) => p.id === playbookMatch.playbook_id);
    const route = pb
      ? registry.routes.find((r) => r.id === pb.golden_path_route_id)
      : undefined;
    const ids = route?.components ?? pb?.components ?? [];
    const components = resolveComponents(ids, registry);
    const ordered = computeExecutionOrder(components, registry.edges);

    steps = ordered.map((c, i) => toRouteStep(c, i));
    planningOrder = components.map((c) => c.id);
    executionOrder = ordered.map((c) => c.id);
    routeComponentIds = ordered.map((c) => c.id);
    playbook = pb
      ? {
          id: pb.id,
          title: pb.title,
          route_id: pb.golden_path_route_id,
          confidence: route?.confidence ?? 0,
          recall: playbookMatch.overlap_fraction,
          precision: playbookMatch.precision,
        }
      : null;
  } else {
    // Composed candidate — reuse compose output directly.
    steps = composed.recommended_route;
    planningOrder = composed.planning_order;
    executionOrder = composed.execution_order;
    routeComponentIds = composed.recommended_route.map((s) => s.component_id);
  }

  // ── Step 4: review the chosen route's component set ──
  const safety_review = reviewRoute(
    input.goal,
    routeComponentIds,
    input.risk_level,
    registry,
  );

  // ── Step 5: derived facts on the chosen route ──
  const routeComponents = resolveComponents(routeComponentIds, registry);
  const model_tier_profile = computeModelTierProfile(routeComponents);
  const credential_advisory = computeCredentialAdvisory(routeComponents);
  const untested_edges = untestedEdgesWithin(routeComponentIds, registry);
  const avoid_when_violations = detectAvoidViolations(
    new Set(routeComponentIds),
    registry.edges,
  );
  const hasGate = routeComponentIds.includes("human_approval_gate");
  const gatedWrites = routeComponentIds.filter((id) => ALWAYS_REQUIRES_GATE.has(id));

  // ── MAR-132: reconcile an explicit "unattended / no-gate" constraint ──
  // When the user opts out but an irreversible external write is present, keep
  // the gate in the route (never silently dropped) but downgrade it from a hard
  // requirement to an advisory so the output stops contradicting the prompt.
  let required_approval_gates: string[];
  let approval_gate_advisory: ApprovalGateAdvisory | null = null;

  if (hasGate && gatedWrites.length > 0 && hasUnattendedWaiver(input.goal)) {
    required_approval_gates = [];
    approval_gate_advisory = {
      gate: "human_approval_gate",
      write_components: gatedWrites,
      reason:
        `You asked for an unattended / no-gate flow, but this route performs an ` +
        `irreversible external write (${gatedWrites.join(", ")}). \`human_approval_gate\` ` +
        `is kept as a STRONG RECOMMENDATION, not an enforced requirement — remove it ` +
        `deliberately only if you accept unattended external writes with no human review.`,
    };
  } else {
    required_approval_gates = hasGate
      ? ["human_approval_gate"]
      : composed.required_approval_gates;
  }

  // ── Step 6: fused markdown ──
  const summary_markdown = buildPlanMarkdown(
    input.goal,
    planSource,
    steps,
    playbook,
    safety_review,
    model_tier_profile,
    credential_advisory,
    untested_edges,
    approval_gate_advisory,
  );

  return {
    plan_source: planSource,
    goal: input.goal,
    summary_markdown,
    recommended_route: steps,
    planning_order: planningOrder,
    execution_order: executionOrder,
    model_tier_profile,
    playbook,
    route_status: composed.route_status,
    route_score: composed.route_score,
    confidence_label: composed.confidence_label,
    stack: composed.recommended_stack,
    safety_review,
    credential_advisory,
    untested_edges,
    avoid_when_violations,
    required_approval_gates,
    approval_gate_advisory,
    evals_to_add: composed.evals_to_add,
    next_steps:
      planSource === "playbook"
        ? [
            `get_playbook({ id: "${playbook?.id ?? ""}" })`,
            `get_route({ id: "${playbook?.route_id ?? ""}", include_component_details: true })`,
            "get_graph_component",
          ]
        : ["list_known_routes", "compose_workflow_route", "get_graph_component"],
  };
}

// ─────────────────────────── registration ───────────────────────────

const InputShape = {
  goal: z.string().min(5).describe(
    "Describe the workflow you want to build in plain language. " +
    "Example: 'read emails, detect leads, research the company and draft a reply.'",
  ),
  must_have_capabilities: z.array(z.string()).default([]).describe(
    "Capabilities the plan must include. Missing capabilities are flagged.",
  ),
  must_avoid: z.array(z.string()).default([]).describe(
    "Component IDs to exclude from the plan.",
  ),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional().describe(
    "Maximum acceptable risk level for components.",
  ),
  local_or_hosted: z.enum(["local", "hosted", "either"]).default("either").describe(
    "Local tool vs hosted product — affects the stack recommendation.",
  ),
  output_depth: z.enum(["brief", "standard", "deep"]).default("standard").describe(
    "brief = route only. standard = route + safety + tiers. deep = includes all evals.",
  ),
};

export function registerPlanWorkflow(server: McpServer): void {
  server.registerTool(
    "plan_workflow",
    {
      title: "Plan Workflow",
      description:
        "One-call workflow planner. Give it a goal and it returns a complete plan: " +
        "the recommended route (validated playbook when one strongly matches the goal, " +
        "otherwise a composed candidate), per-step model-tier guidance, an inlined safety review, " +
        "the recommended stack, and untested-edge warnings. " +
        "Replaces the manual sequence of list_known_routes → get_route → compose_workflow_route → " +
        "get_stack_recommendation → review_workflow_design. " +
        "Prefer this as the entry point for designing a new AI workflow.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: false });
        const result = planWorkflow(
          {
            goal: input.goal,
            must_have_capabilities: input.must_have_capabilities,
            must_avoid: input.must_avoid,
            risk_level: input.risk_level,
            local_or_hosted: input.local_or_hosted,
            output_depth: input.output_depth,
          },
          registry,
        );

        logger.debug(
          `plan_workflow → source=${result.plan_source} steps=${result.recommended_route.length} ` +
          `safety=${result.safety_review.status}`,
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        logger.error("plan_workflow failed", err);
        return toErrorResult(err);
      }
    },
  );
}
