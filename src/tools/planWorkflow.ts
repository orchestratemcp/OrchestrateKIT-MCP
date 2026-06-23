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
import type { LoopContract } from "../registry/playbookSchema.js";
import { loadRegistry } from "../registry/registryProvider.js";
import {
  composeRoute,
  computeModelTierProfile,
  computeCredentialAdvisory,
  toRouteStep,
  type ComposeInput,
  type CredentialAdvisory,
  type RegistrySnapshot,
  type RouteStep,
  type UntestedEdge,
} from "../graph/routeComposer.js";
import {
  computeExecutionOrder,
  detectAvoidViolations,
  edgesWithinSet,
  type AvoidViolation,
} from "../graph/routeOrdering.js";
import { ALWAYS_REQUIRES_GATE } from "../graph/safetyAugmenter.js";
import { findOverlappingPlaybooks } from "../graph/playbookOverlap.js";
import {
  composeWorkerPipeline,
  type WorkerPipeline,
} from "../graph/workerPipeline.js";
import {
  computeAutomationClearance,
  type AutomationClearance,
} from "../graph/automationClearance.js";
import { buildReviewContext } from "./reviewWorkflowDesign.js";
import { ALL_RULES } from "../review/rules/index.js";
import {
  calculateRiskScore,
  deriveStatus,
  type ReviewFinding,
} from "../review/types.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { PlanWorkflowOutputShape } from "./outputSchemas.js";

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

/**
 * Strong email/calendar signal tokens. At least one must be present in the goal
 * for email_calendar_assistant to fire as a playbook match (MAR-142). Prevents
 * the playbook routing from claiming a Stripe-to-Slack reporting goal (which
 * mentions neither email nor calendar) just because its lexical tokens happen to
 * score above the precision floor.
 */
const STRONG_EMAIL_CALENDAR_TOKENS = [
  "email", "inbox", "mailbox", "reply", "replies", "draft", "calendar",
  "meeting", "invite", "appointment", "send email", "mail",
];

function hasEmailCalendarSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return STRONG_EMAIL_CALENDAR_TOKENS.some((t) => g.includes(t));
}

/**
 * Explicit "read-only / no-write" constraint phrases (MAR-142). When present in
 * a goal that was routed to a playbook containing write components, surface a
 * safety warning — the playbook route's fixed structure cannot adapt its writes
 * to match the constraint (unlike the composed path which has MAR-132 advisory).
 */
const WRITE_CONSTRAINT_SIGNALS = [
  "read-only",
  "read only",
  "never write",
  "no write",
  "no writes",
  "no database update",
  "no emails sent",
  "no email sent",
  "never send",
];

function hasWriteConstraint(goal: string): boolean {
  const g = goal.toLowerCase();
  return WRITE_CONSTRAINT_SIGNALS.some((s) => g.includes(s));
}

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
 * moved out of `enforced_approval_gates` so the output stops contradicting the
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
  /** Untested edges within the route, each with its registry severity (MAR-133). */
  untested_edges: UntestedEdge[];
  avoid_when_violations: AvoidViolation[];
  /**
   * Approval gates ACTUALLY PRESENT AND ENFORCED in `recommended_route` (MAR-148).
   *
   * Distinct from `safety_review.approval_gates_required`, which is what the
   * review rules say the route NEEDS. The two used to both be named "required",
   * so a route that needs a gate but doesn't contain one read as a contradiction
   * (Dogfood Round 3 G2: `required_approval_gates: []` next to
   * `approval_gates_required: [human_approval_gate]`). Renamed to `enforced_*`
   * so the pair reads as a legible gap — "needed, but not enforced" — rather than
   * a self-contradiction. Empty when a gate is downgraded to advisory (below).
   */
  enforced_approval_gates: string[];
  /**
   * Non-null when the goal explicitly opted out of a human gate but the route
   * still performs an irreversible external write (MAR-132). The gate stays in
   * `recommended_route` as a strong recommendation; it is just not listed in
   * `enforced_approval_gates`.
   */
  approval_gate_advisory: ApprovalGateAdvisory | null;
  evals_to_add: string[];
  /**
   * Advisory multi-worker BUILD pipeline (MAR-166): the specialist workers
   * (planner → coder → reviewer → tester) recommended to implement this plan in
   * the user's own runtime, with their handoff contracts. Deterministic and the
   * same build team for every plan; empty when the registry has no workers.
   */
  worker_pipeline: WorkerPipeline;
  /**
   * Advisory bounded-loop guidance (MAR-167). Non-null only when the planned
   * route contains `loop_controller` — i.e. the goal asks for an iterative /
   * looping agent. Surfaces the canonical dynamic_worker_loop contract (max
   * iterations, stop/escalation conditions, the reviewer-independence and
   * no-write-until-final-gate guardrails) as the framework-agnostic spec to
   * export. The graph itself stays DAG-only; this is a control-flow annotation.
   */
  loop_guidance: LoopGuidance | null;
  /**
   * Earned-by-evidence autonomy level (MAR-168). Present on every plan. The
   * level is the highest blast-radius action class across the route; we ADVISE
   * whether it can run unattended and list the controls required to earn it —
   * we never drop the gate ourselves.
   */
  automation_clearance: AutomationClearance;
  next_steps: string[];
};

export type LoopGuidance = {
  playbook_id: string;
  worker_sequence: string[];
  loop_contract: LoopContract;
  guardrail_checklist: string[];
};

/**
 * When the planned route is loop-shaped (contains `loop_controller`), surface
 * the canonical bounded-loop contract from the dynamic_worker_loop playbook.
 * Sourced from the registry so the contract has a single source of truth, and
 * deliberately decoupled from playbook ROUTING so it never affects precision.
 */
export function buildLoopGuidance(
  routeComponentIds: string[],
  registry: RegistrySnapshot,
): LoopGuidance | null {
  if (!routeComponentIds.includes("loop_controller")) return null;
  const pb = registry.playbooks.find((p) => p.loop_contract);
  if (!pb || !pb.loop_contract) return null;
  return {
    playbook_id: pb.id,
    worker_sequence: pb.worker_sequence ?? [],
    loop_contract: pb.loop_contract,
    guardrail_checklist: pb.guardrails,
  };
}

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

/** Untested edges fully within the route's component set, with severity (MAR-133). */
function untestedEdgesWithin(
  componentIds: string[],
  registry: RegistrySnapshot,
): UntestedEdge[] {
  return edgesWithinSet(new Set(componentIds), registry.edges)
    .filter((e) => !e.tested)
    .map((e) => ({ id: e.id, severity: e.severity }));
}

/**
 * MAR-101: scannable front-matter status block prepended to every
 * `summary_markdown`, regardless of `output_depth`. It surfaces the four facts
 * that decide whether a plan is safe to build — route_status, safety, blocking
 * issues, approval state, untested-edge count — at the very top so pipeline
 * problems (an unvalidated route, a failed safety review, a write that forfeits
 * its gate) are unmissable instead of buried below the step list.
 *
 * Rendered as a YAML-style front-matter fence: machine-scannable for a client
 * that wants to gate on it, glanceable for a human, with a ✅/⚠️/❌ status icon
 * per line.
 *
 * MAR-148: the `approval` line distinguishes ENFORCED gates (present in the
 * route) from gates the review REQUIRES but the route does not contain — the
 * G2 gap that used to read as a self-contradiction. A required-but-unenforced
 * gate (with no deliberate waiver) is the most dangerous state and renders ❌.
 */
function buildStatusHeader(
  routeStatus: string,
  safety: SafetyReview,
  untestedEdges: UntestedEdge[],
  enforcedGates: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  clearance: AutomationClearance,
): string {
  const routeIcon =
    routeStatus === "validated" ? "✅" : routeStatus === "blocked_candidate" ? "❌" : "⚠️";
  const safetyIcon =
    safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  const blockingCount = safety.blocking_issues.length;
  const blockingIcon = blockingCount === 0 ? "✅" : "❌";

  // enforced (present) → advisory (deliberately waived) → required-but-missing
  // (the G2 gap) → none needed.
  let approval: string;
  if (enforcedGates.length > 0) {
    approval = `✅ enforced — ${enforcedGates.join(", ")}`;
  } else if (approvalAdvisory) {
    approval = `⚠️ advisory — ${approvalAdvisory.gate} kept but not enforced (you waived it)`;
  } else if (safety.approval_gates_required.length > 0) {
    approval = `❌ REQUIRED but NOT enforced — ${safety.approval_gates_required.join(", ")}`;
  } else {
    approval = "✅ none needed";
  }

  const untestedIcon = untestedEdges.length === 0 ? "✅" : "⚠️";

  // MAR-168: autonomy clearance. ✅ may run unattended · ⚠️ human by default
  // (earnable) · ❌ human always required (L4).
  const autoIcon = clearance.autonomous_allowed
    ? "✅"
    : clearance.level === "L4"
    ? "❌"
    : "⚠️";
  const autoText = clearance.autonomous_allowed
    ? "may run unattended"
    : clearance.level === "L4"
    ? "human ALWAYS required"
    : "human by default";

  return [
    `---`,
    `route_status:   ${routeIcon} ${routeStatus}`,
    `safety:         ${safetyIcon} ${safety.status} (risk ${safety.risk_score}/100)`,
    `blocking:       ${blockingIcon} ${blockingCount} issue${blockingCount === 1 ? "" : "s"}`,
    `approval:       ${approval}`,
    `automation:     ${autoIcon} ${clearance.level} — ${autoText}`,
    `untested_edges: ${untestedIcon} ${untestedEdges.length}`,
    `---`,
  ].join("\n");
}

function buildBriefPlanMarkdown(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  playbook: PlanPlaybook | null,
  safety: SafetyReview,
  untestedEdges: UntestedEdge[],
  enforcedGates: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
): string {
  const lines: string[] = [];

  if (planSource === "playbook" && playbook) {
    lines.push(
      `**Validated playbook:** \`${playbook.id}\` — ${playbook.title} ` +
        `(recall ${Math.round(playbook.recall * 100)}%, precision ${Math.round(playbook.precision * 100)}%)`,
      ``,
    );
  } else {
    lines.push(`**Composed candidate route** — no validated playbook strongly matches.`, ``);
  }

  lines.push(`**Steps**`, ``);
  for (const s of steps) {
    const tier = s.model_tier === "none" ? "deterministic" : `${s.model_tier} LLM`;
    lines.push(`${s.step}. **${s.component_name ?? s.component_id}** — ${s.purpose} [${tier}, ${s.risk_level} risk]`);
  }
  lines.push(``);

  const safetyMark = safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  lines.push(`**Safety:** ${safetyMark} ${safety.status.toUpperCase()}`);
  if (enforcedGates.length > 0) {
    lines.push(`**Approval enforced:** ${enforcedGates.map((g) => `\`${g}\``).join(", ")}`);
  } else if (!approvalAdvisory && safety.approval_gates_required.length > 0) {
    // MAR-148: the review requires a gate the route does not enforce (G2 gap).
    lines.push(
      `**⚠️ Approval REQUIRED but NOT enforced:** ` +
        `${safety.approval_gates_required.map((g) => `\`${g}\``).join(", ")}`,
    );
  }
  if (approvalAdvisory) {
    lines.push(`**Gate advisory:** ${approvalAdvisory.reason}`);
  }
  if (safety.blocking_issues.length > 0) {
    lines.push(`**Blocking issues:** ${safety.blocking_issues.join("; ")}`);
  }
  if (untestedEdges.length > 0) {
    lines.push(`**Untested edges:** ${untestedEdges.length} — verify before building.`);
  }

  return lines.join("\n");
}

function buildPlanMarkdown(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  playbook: PlanPlaybook | null,
  safety: SafetyReview,
  modelTiers: PlanWorkflowOutput["model_tier_profile"],
  credentials: CredentialAdvisory,
  untestedEdges: UntestedEdge[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  workerPipeline: WorkerPipeline,
  loopGuidance: LoopGuidance | null,
  clearance: AutomationClearance,
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

  // MAR-168: autonomy clearance section.
  const autoMark = clearance.autonomous_allowed ? "✅" : clearance.level === "L4" ? "❌" : "⚠️";
  lines.push(
    `### Automation clearance: ${autoMark} ${clearance.level}`,
    ``,
    `**Autonomous allowed:** ${clearance.autonomous_allowed ? "yes" : "no — human in the loop"}`,
    ``,
    `> ${clearance.reason}`,
    ``,
  );
  if (clearance.highest_action_components.length > 0) {
    lines.push(
      `Driven by: ${clearance.highest_action_components.map((c) => `\`${c}\``).join(", ")}`,
      ``,
    );
  }
  if (clearance.required_controls.length > 0) {
    lines.push(`**Required controls to run unattended:**`);
    for (const ctrl of clearance.required_controls) lines.push(`- ${ctrl}`);
    lines.push(``);
  }

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
      `${untestedEdges.slice(0, 8).map((e) => `\`${e.id}\` (${e.severity})`).join(", ")}${untestedEdges.length > 8 ? " …" : ""}`,
      ``,
    );
  }

  // MAR-166: advisory build team for implementing this plan in your runtime.
  if (workerPipeline.workers.length > 0) {
    lines.push(
      `### Build team (worker pipeline)`,
      ``,
      `> Specialist workers with safe contracts to BUILD this plan — handed off ` +
        `in order. OrchestrateMCP recommends the team; you run it in your own runtime.`,
      ``,
    );
    const chain = workerPipeline.workers.map((w) => `\`${w.worker_id}\``).join(" → ");
    lines.push(`**Pipeline:** ${chain}`, ``);
    for (const w of workerPipeline.workers) {
      const tier = w.model_tier === "none" ? "deterministic" : `${w.model_tier} tier`;
      lines.push(
        `${w.step}. **${w.title}** (\`${w.role}\`, ${tier}) — ` +
          `consumes: ${w.inputs.join("; ") || "—"} → produces: ${w.outputs.join("; ") || "—"}`,
      );
    }
    if (workerPipeline.feedback_loops.length > 0) {
      lines.push(
        ``,
        `**Fix loops:** ${workerPipeline.feedback_loops
          .map((h) => `\`${h.from}\` → \`${h.to}\``)
          .join(", ")}`,
      );
    }
    lines.push(``);
  }

  // MAR-167: bounded-loop contract when the route is loop-shaped.
  if (loopGuidance) {
    const lc = loopGuidance.loop_contract;
    lines.push(
      `### Loop contract & guardrails`,
      ``,
      `> This plan loops. It MUST be bounded and reviewer-independent. Export ` +
        `this contract to your runtime (Cowork / LangGraph / CrewAI) — the graph ` +
        `stays DAG-only; the loop bound lives in the contract.`,
      ``,
      `- **Worker loop:** ${loopGuidance.worker_sequence.map((w) => `\`${w}\``).join(" → ")}`,
      `- **max_iterations:** ${lc.max_iterations}`,
      `- **Stop when:** ${lc.stop_condition}`,
      `- **Escalate when:** ${lc.escalation_condition}`,
      `- **Human gate required for:** ${lc.human_gate_required_for.join(", ")}`,
      `- **State persisted:** ${lc.state_required ? "yes" : "no"} · **Audited:** ${lc.audit_required ? "yes" : "no"}`,
      `- **Reviewer independent of planner/coder:** ${lc.reviewer_independent ? "yes" : "no"}`,
      `- **No external write/deploy/send until final gate:** ${lc.no_write_until_final_gate ? "yes" : "no"}`,
      ``,
      `**Guardrail checklist:**`,
    );
    for (const g of loopGuidance.guardrail_checklist) lines.push(`- [ ] ${g}`);
    lines.push(``);
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
  // MAR-142: also require at least one strong email/calendar token in the goal
  // before accepting email_calendar_assistant as a playbook match — the precision
  // floor alone (0.72) is not sufficient when generic tokens like "read" happen
  // to score above it on a non-email goal (e.g. Stripe→Slack read-only report).
  const emailCalendarGatePassed =
    !bestOverlap ||
    bestOverlap.playbook_id !== "email_calendar_assistant" ||
    hasEmailCalendarSignal(input.goal);

  const playbookMatch =
    bestOverlap &&
    bestOverlap.overlap_fraction >= PLAYBOOK_RECALL_MIN &&
    bestOverlap.precision >= PLAYBOOK_PRECISION_MIN &&
    emailCalendarGatePassed
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
  let enforced_approval_gates: string[];
  let approval_gate_advisory: ApprovalGateAdvisory | null = null;

  if (hasGate && gatedWrites.length > 0 && hasUnattendedWaiver(input.goal)) {
    enforced_approval_gates = [];
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
    enforced_approval_gates = hasGate
      ? ["human_approval_gate"]
      : composed.required_approval_gates;
  }

  // ── MAR-142: warn when a playbook route contains writes the goal explicitly forbade ──
  // The composed path has MAR-132's advisory; the playbook path serves a fixed
  // route structure and cannot adapt its write steps to a read-only constraint.
  // Surface a warning instead of silently contradicting the goal's constraint.
  if (planSource === "playbook" && hasWriteConstraint(input.goal)) {
    const writeComponents = routeComponentIds.filter((id) => ALWAYS_REQUIRES_GATE.has(id));
    if (writeComponents.length > 0) {
      safety_review.warnings.push(
        `Read-only / no-write constraint in goal conflicts with write step(s) in this ` +
        `playbook route (${writeComponents.join(", ")}). Consider switching to a composed ` +
        `candidate or removing the write components manually.`,
      );
    }
  }

  // ── route_status consistent with plan_workflow's OWN plan_source (MAR-133) ──
  // composeRoute sets route_status="validated" only via its internal
  // playbook-first flag (recall ≥ 0.80 / precision ≥ 0.50). plan_workflow applies
  // a STRICTER gate (recall ≥ 0.60 / precision ≥ 0.72 + email/calendar signal),
  // so passing compose's status through verbatim produced `route_status:
  // "validated"` alongside `plan_source: "composed"` / `playbook: null` — a
  // self-contradicting, trust-overclaiming output (Dogfood Round 3 G4). Derive
  // the status from the route plan_workflow actually returns: a validated playbook
  // golden-path → "validated"; a composed candidate can never be "validated".
  const hasCriticalAvoid = avoid_when_violations.some((v) => v.severity === "critical");
  const route_status: string = hasCriticalAvoid
    ? "blocked_candidate"
    : planSource === "playbook"
    ? "validated"
    : composed.route_status === "validated"
    ? "candidate"
    : composed.route_status;

  // ── MAR-166: advisory build pipeline (planner → coder → reviewer → tester) ──
  // Same deterministic build team for every plan; the registry supplies the
  // workers and their handoff contracts.
  const worker_pipeline = composeWorkerPipeline(registry.workers ?? []);

  // ── MAR-167: bounded-loop contract when the route is loop-shaped ──
  const loop_guidance = buildLoopGuidance(routeComponentIds, registry);

  // ── MAR-168: earned-by-evidence autonomy clearance (every plan) ──
  const automation_clearance = computeAutomationClearance(
    routeComponentIds,
    registry,
    untested_edges,
  );

  // ── Step 6: fused markdown ──
  // MAR-101: every depth leads with the same scannable status front-matter so
  // route_status / safety / blocking / approval / untested-edge count are
  // unmissable regardless of how much detail follows.
  const outputDepth = input.output_depth ?? "standard";
  const statusHeader = buildStatusHeader(
    route_status,
    safety_review,
    untested_edges,
    enforced_approval_gates,
    approval_gate_advisory,
    automation_clearance,
  );
  const body =
    outputDepth === "brief"
      ? buildBriefPlanMarkdown(
          input.goal,
          planSource,
          steps,
          playbook,
          safety_review,
          untested_edges,
          enforced_approval_gates,
          approval_gate_advisory,
        )
      : buildPlanMarkdown(
          input.goal,
          planSource,
          steps,
          playbook,
          safety_review,
          model_tier_profile,
          credential_advisory,
          untested_edges,
          approval_gate_advisory,
          worker_pipeline,
          loop_guidance,
          automation_clearance,
        );
  const summary_markdown = `${statusHeader}\n\n${body}`;

  return {
    plan_source: planSource,
    goal: input.goal,
    summary_markdown,
    recommended_route: steps,
    planning_order: planningOrder,
    execution_order: executionOrder,
    model_tier_profile,
    playbook,
    route_status,
    route_score: composed.route_score,
    confidence_label: composed.confidence_label,
    stack: composed.recommended_stack,
    safety_review,
    credential_advisory,
    untested_edges,
    avoid_when_violations,
    enforced_approval_gates,
    approval_gate_advisory,
    evals_to_add: composed.evals_to_add,
    worker_pipeline,
    loop_guidance,
    automation_clearance,
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

// ─────────────────────────── goal guard (MAR-162) ───────────────────────────

/**
 * Deterministic goal-guard (MAR-162). ChatGPT — especially in plain chat —
 * fabricates a "goal" from the server preamble / its own system instructions and
 * calls plan_workflow before the user has stated a real workflow. Planning that
 * produces confident garbage and breaks the honest-planner promise. This guard is
 * the tool-side backstop to MAR-147's instruction-side elicitation.
 *
 * It is HIGH-PRECISION on purpose: a false positive (blocking a real goal) is
 * worse than a false negative, so it only fires on UNMISTAKABLE non-goals —
 * echoed instruction/preamble text, tool names, or content-free "plan a workflow"
 * asks. Anything that reads like a real plain-English workflow passes through.
 * No LLM; pure string checks.
 */

/**
 * Phrases that appear in the server instructions / a model's own meta-narration
 * but NEVER in a real user workflow goal. If the goal contains one, it is almost
 * certainly echoed preamble, not a thing to build.
 */
const PREAMBLE_MARKERS = [
  // product / tool identity
  "orchestratemcp",
  "orchestratekit",
  "workflow-design advisor",
  "plan_workflow",
  "compose_workflow",
  "list_known_routes",
  "explain_component",
  // instruction-text fragments (from SERVER_INSTRUCTIONS / MAR-147)
  "gather the user's constraints",
  "before you plan",
  "before the first",
  "ask the user",
  "ask for the goal",
  "read-only vs",
  "attended vs",
  "outbound sends",
  "plain english goal",
  "plain-english goal",
  // model self-narration / persona echoes
  "you are an ai",
  "you are a workflow",
  "as an ai assistant",
  "i am an ai",
  "language model",
  "help the user",
  "assist the user",
];

/**
 * Whole-goal patterns for a content-free "just plan something" ask — a planning
 * verb on a generic noun with nothing actually described. Anchored (`^…$`) so a
 * real goal that merely STARTS this way ("build an agent that reads emails…")
 * is never caught.
 */
const TRIVIAL_GOAL_PATTERNS: RegExp[] = [
  /^(please\s+)?(can you\s+|could you\s+)?(help me\s+)?(to\s+)?(plan|design|build|create|make|set\s?up|architect)\s+(me\s+)?(a|an|my|the|some)?\s*(?:(?:workflow|agent|automation|pipeline|process|orchestration|flow)\s*)+(for me|for us|for my team|for my business|for my company|please|now|today|asap|thanks|thank you)?\.?$/,
  /^(what can you do|what do you do|how does this work|what is this|help|hi|hii|hello|hey|test|testing)\.?!?$/,
  /^(i\s+(need|want)|i'?d\s+like)\s+(a|an|some)?\s*(workflow|agent|automation|help|plan)\.?$/,
];

export type GoalAssessment = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether `goal` is a real workflow goal or echoed preamble / a content-
 * free ask. Exported for unit testing (golden good vs bad cases).
 */
export function assessGoalInput(goal: string): GoalAssessment {
  const g = goal.trim().toLowerCase();

  for (const marker of PREAMBLE_MARKERS) {
    if (g.includes(marker)) {
      return { ok: false, reason: `looks like instructions/preamble (matched "${marker}")` };
    }
  }

  for (const re of TRIVIAL_GOAL_PATTERNS) {
    if (re.test(g)) {
      return { ok: false, reason: "no workflow is described — just a generic 'plan something' ask" };
    }
  }

  // A single token (after the schema's 5-char floor) cannot describe a workflow.
  if (g.split(/\s+/).filter(Boolean).length < 2) {
    return { ok: false, reason: "too short to describe a workflow" };
  }

  return { ok: true };
}

/** The example goal shown to a client that tripped the guard. */
const NEEDS_GOAL_EXAMPLE =
  "read emails, detect sales leads, research the company, and draft a reply for my approval";

export type NeedsGoalResult = {
  status: "needs_goal";
  reason: string;
  example: string;
  summary_markdown: string;
};

/**
 * Build the `needs_goal` payload returned instead of a fabricated plan (MAR-162).
 * `diagnosis` is the one-line reason shown to the user; it defaults to the
 * echoed-preamble case and is overridden for the too-vague / empty-route case
 * (MAR-145 ChatGPT-dogfood finding) — both render the same headline + nudge.
 */
export function buildNeedsGoalResult(
  reason: string,
  diagnosis = "That input reads like setup/instructions text, not a workflow to plan",
): NeedsGoalResult {
  return {
    status: "needs_goal",
    reason,
    example: NEEDS_GOAL_EXAMPLE,
    summary_markdown:
      `## ⚠️ I need the actual workflow goal first\n\n` +
      `${diagnosis}, so I haven't planned anything ` +
      `(planning a guessed goal would produce confident-but-wrong output).\n\n` +
      `**Tell me, in one plain-English sentence, what you want the agent to DO** — the steps, the data, and the tools.\n\n` +
      `**Example:** _"${NEEDS_GOAL_EXAMPLE}."_\n\n` +
      `Then call \`plan_workflow\` again with that as the \`goal\`.`,
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
      outputSchema: PlanWorkflowOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        // MAR-162: refuse to plan echoed preamble / a content-free ask. Returns
        // a needs_goal nudge instead of a confident plan for a fabricated goal.
        const assessment = assessGoalInput(input.goal);
        if (!assessment.ok) {
          logger.debug(`plan_workflow → needs_goal (${assessment.reason})`);
          const needsGoal = buildNeedsGoalResult(assessment.reason);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(needsGoal) }],
            structuredContent: needsGoal,
          };
        }

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

        // MAR-145 (ChatGPT dogfood): a goal vague enough to match no components
        // yields an empty route — a useless plan. Backstop the assessGoalInput
        // guard by returning needs_goal instead of an empty plan ("set up an
        // agent workflow for me" and similar slip past the phrase guard).
        if (result.recommended_route.length === 0) {
          logger.debug("plan_workflow → needs_goal (empty route — goal too vague)");
          const needsGoal = buildNeedsGoalResult(
            "no workflow steps matched the goal — it is too vague",
            "I couldn't identify any workflow steps from that goal — it is too vague",
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(needsGoal) }],
            structuredContent: needsGoal,
          };
        }

        logger.debug(
          `plan_workflow → source=${result.plan_source} steps=${result.recommended_route.length} ` +
          `safety=${result.safety_review.status}`,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        logger.error("plan_workflow failed", err);
        return toErrorResult(err);
      }
    },
  );
}
