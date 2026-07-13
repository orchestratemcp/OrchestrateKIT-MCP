/**
 * export_build_brief — MAR-205 / BRIEF-01
 *
 * Takes a plan_workflow result and emits ONE canonical, provenance-tagged Build
 * Brief — a self-contained handoff document for an IDE agent (Cursor), a
 * human builder, or a Linear issue. Covers §0–§8:
 *
 *   §0 Constraints  — read-only / unattended / outbound constraints from the goal
 *   §1 Summary      — one-line plain-English description of the workflow
 *   §2 Route        — ordered component list with model tiers (🟢 grounded)
 *   §3 Worker contracts — build-team handoffs from worker_pipeline
 *   §4 Loop contract   — bounded-iteration spec (null when no loop)
 *   §5 Safety          — clearance level, untested-edge risk questions
 *   §6 Do-NOT-add      — negative scope (avoid_when + forbidden)
 *   §7 Review loop-back — evals + what to check before shipping
 *   §8 Definition of Done — gate checklist derived from safety + clearance
 *   §9 Observability wiring — DASH run-event wiring (MAR-296 / DASH-02)
 *
 * Also emits a deterministic `agent.manifest.json` (`agent_manifest`) conforming
 * to orchestratedash's DASH-01 telemetry contract — data in the brief, never
 * sent anywhere.
 *
 * STATELESS CONTRACT: stores nothing, makes no network calls. The brief is the
 * paste-ready artifact; the human takes it to their IDE or Lab.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { detectConstraintSignals } from "../lib/constraintSignals.js";
import { registryContentFingerprint } from "../registry/loadRegistryBundled.js";
import {
  buildAgentManifest,
  DASH_ENDPOINT_ENV,
  DASH_TOKEN_ENV,
  type AgentManifest,
  type ManifestBuildTarget,
} from "../lib/observabilityContract.js";
import { buildConnectArtifacts, s11Connect, type ConnectArtifacts } from "../lib/connectContract.js";
import { ExportBuildBriefOutputShape } from "./outputSchemas.js";

// ──────────────────────────────── input ────────────────────────────────

const RouteStepShape = z
  .object({
    step: z.number(),
    component_id: z.string(),
    component_name: z.string().optional(),
    purpose: z.string().optional(),
    model_tier: z.string().optional(),
    risk_level: z.string().optional(),
  })
  .passthrough();

const SafetyReviewShape = z
  .object({
    status: z.enum(["pass", "warnings", "fail"]),
    risk_score: z.number(),
    blocking_issues: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
    approval_gates_required: z.array(z.string()).default([]),
  })
  .passthrough();

const AutomationClearanceShape = z
  .object({
    level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
    autonomous_allowed: z.boolean(),
    reason: z.string(),
    required_controls: z.array(z.string()).default([]),
    highest_action_components: z.array(z.string()).default([]),
  })
  .passthrough();

const WorkerShape = z
  .object({
    step: z.number(),
    worker_id: z.string(),
    role: z.string(),
    title: z.string(),
    model_tier: z.string(),
    inputs: z.array(z.string()),
    outputs: z.array(z.string()),
  })
  .passthrough();

const LoopContractShape = z
  .object({
    max_iterations: z.number(),
    stop_condition: z.string(),
    escalation_condition: z.string(),
    state_required: z.boolean(),
    audit_required: z.boolean(),
    human_gate_required_for: z.array(z.string()),
    reviewer_independent: z.boolean(),
    no_write_until_final_gate: z.boolean(),
  })
  .passthrough();

// Exported (MAR-256/255 regression) so tests can validate against the ACTUAL
// zod schema the MCP tool wrapper enforces — calling exportBuildBrief() the
// core function directly bypasses this layer entirely, which is exactly how
// the worker_pipeline-null rejection shipped undetected (live audit, 2026-07-05).
export const InputShape = {
  goal: z.string().min(5).describe("The original workflow goal — verbatim from plan_workflow."),
  plan_source: z
    .enum(["playbook", "composed"])
    .describe("plan_workflow.plan_source — 'playbook' or 'composed'."),
  route_status: z
    .string()
    .describe("plan_workflow.route_status — 'validated', 'candidate', 'blocked_candidate'."),
  recommended_route: z
    .array(RouteStepShape)
    .min(1)
    .describe("plan_workflow.recommended_route — ordered step list."),
  safety_review: SafetyReviewShape.describe("plan_workflow.safety_review."),
  automation_clearance: AutomationClearanceShape.describe("plan_workflow.automation_clearance."),
  enforced_approval_gates: z
    .array(z.string())
    .default([])
    .describe("plan_workflow.enforced_approval_gates."),
  untested_edges: z
    .array(z.object({ id: z.string(), severity: z.string() }).passthrough())
    .default([])
    .describe("plan_workflow.untested_edges — each with id + severity."),
  avoid_when_violations: z
    .array(z.object({ edge: z.string().optional(), reason: z.string().optional() }).passthrough())
    .default([])
    .describe("plan_workflow.avoid_when_violations."),
  evals_to_add: z
    .array(z.string())
    .default([])
    .describe("plan_workflow.evals_to_add — eval gaps the plan surfaced."),
  design_notes: z
    .array(z.string())
    .default([])
    .describe("plan_workflow.design_notes — edge control_flow_note + structural advisories."),
  worker_pipeline: z
    .object({
      workers: z.array(WorkerShape),
      feedback_loops: z.array(z.object({}).passthrough()).default([]),
    })
    .passthrough()
    .nullable()
    .optional()
    .describe(
      "plan_workflow.worker_pipeline — build team (optional). Nullable since MAR-256: " +
      "plan_workflow returns null at guided/brief/standard depth, not just omission — " +
      "a straight pass-through of that field must not fail validation.",
    ),
  loop_guidance: z
    .object({
      playbook_id: z.string(),
      worker_sequence: z.array(z.string()),
      loop_contract: LoopContractShape,
      guardrail_checklist: z.array(z.string()),
    })
    .passthrough()
    .nullable()
    .optional()
    .describe("plan_workflow.loop_guidance — null unless route is loop-shaped."),
  approval_gate_advisory: z
    .object({
      gate: z.string(),
      write_components: z.array(z.string()),
      reason: z.string(),
    })
    .passthrough()
    .nullable()
    .optional()
    .describe("plan_workflow.approval_gate_advisory — non-null when gate is downgraded to advisory."),
  // handoff targets — optional, default to prose only
  handoff_targets: z
    .array(z.enum(["prompt", "linear", "obsidian"]))
    .default(["prompt"])
    .describe(
      "Output formats to include: 'prompt' = paste-ready agent prompt, " +
      "'linear' = Linear issue description, 'obsidian' = Obsidian note. " +
      "Defaults to prompt only.",
    ),
  // ── MAR-296 / DASH-02: agent.manifest.json inputs (all optional) ──
  playbook_id: z
    .string()
    .default("")
    .describe("plan_workflow.playbook.id when plan_source is 'playbook'; '' when composed."),
  route_id: z
    .string()
    .default("")
    .describe("plan_workflow.playbook.route_id when plan_source is 'playbook'; '' when composed."),
  build_target: z
    .enum(["cowork", "cursor", "chatgpt_gpt", "code"])
    .default("code")
    .describe("Where the agent will be BUILT — recorded in the DASH manifest. Defaults to 'code'."),
  output_location: z
    .string()
    .default("")
    .describe(
      "Where this agent's output lands (from the plan-time monitoring question), " +
      "echoed into the DASH manifest. Free text, e.g. 'HubSpot notes + Gmail drafts'.",
    ),
  agent_name: z
    .string()
    .optional()
    .describe("Override the manifest agent slug. Defaults to a slug of the playbook id or goal."),
};

// ──────────────────────────────── output ───────────────────────────────

export type BuildBriefOutput = {
  brief_markdown: string;
  sections: {
    s0_constraints: string;
    s1_summary: string;
    s2_route: string;
    s3_worker_contracts: string;
    /** Always a string since MAR-255 — an explicit "no loop" line when absent
     * (the §3→§5 numbering hole read as a bug). */
    s4_loop_contract: string;
    s5_safety: string;
    s6_do_not_add: string;
    s7_review_loopback: string;
    s8_definition_of_done: string;
    /** §9 event-wiring instructions for a DASH-monitored build (MAR-296). */
    s9_observability: string;
    /** §11 fast-connect credential setup (MAR-364). (§10 is the artifact
     * compiler paragraph, rendered only in brief_markdown — no s10 key.) */
    s11_connect: string;
  };
  handoffs: {
    prompt?: string;
    linear?: string;
    obsidian?: string;
  };
  artifact_package: BuildArtifactPackage;
  /**
   * The `agent.manifest.json` for this plan (MAR-296 / DASH-02) — deterministic,
   * conforms to orchestratedash `contracts/agent.manifest.schema.json`. Write it
   * next to the built agent and import it into DASH. The MCP never sends it
   * anywhere; it is data in the brief.
   */
  agent_manifest: AgentManifest;
  /**
   * Fast-connect artifacts (MAR-364): per-env-var credential manifest (provider,
   * mint deep-link, live-probe spec) + the full source of scripts/connect.mjs
   * to write into the built repo. Deterministic; probes run on the user's
   * machine, never here.
   */
  connect: ConnectArtifacts;
  provenance_tag: "registry-grounded";
  grounding_note: string;
};

type ArtifactFieldValue = string | string[];

export const ARTIFACT_ISSUE_FIELD_ORDER = [
  "title",
  "goal",
  "user_story",
  "context",
  "inputs",
  "outputs",
  "required_tools",
  "data_model",
  "step_by_step_implementation",
  "edge_cases",
  "failure_modes",
  "security",
  "approval_gates",
  "acceptance_criteria",
  "test_cases",
  "definition_of_done",
  "claude_code_cursor_prompt",
  "files_likely_affected",
  "non_goals",
] as const;

export type ArtifactIssueFieldKey = typeof ARTIFACT_ISSUE_FIELD_ORDER[number];
export type ArtifactIssueFields = Record<ArtifactIssueFieldKey, ArtifactFieldValue>;

export type BuildArtifactPackage = {
  compiler: "export_build_brief.artifact_compiler.v1";
  status: "compiled";
  scope_confirmation: {
    assumed_confirmed: true;
    instruction: string;
  };
  directives: string[];
  field_order: ArtifactIssueFieldKey[];
  epic: {
    title: string;
    goal: string;
    context: string;
    non_goals: string[];
    milestones: string[];
  };
  milestones: Array<{
    id: string;
    title: string;
    goal: string;
    issue_ids: string[];
  }>;
  linear_issue_templates: Array<{
    id: string;
    milestone_id: string;
    title: string;
    fields: ArtifactIssueFields;
    markdown: string;
  }>;
  few_shot_example: {
    title: string;
    markdown: string;
    note: string;
  };
  build_prompt: string;
  linear_issue_template_markdown: string;
};

// ────────────────────────────── helpers ────────────────────────────────

/**
 * §0 from the SHARED constraint detection (MAR-255) — the same module
 * plan_workflow's gate/waiver logic uses (src/lib/constraintSignals.ts), so the
 * brief can never again open with "no constraint detected" on a goal the
 * planner already constrained (audit 2026-07-01, live). Each detected class
 * shows the goal phrase that triggered it — the compiler shows its work.
 */
function s0Constraints(goal: string, approvalAdvisory: { reason: string } | null | undefined): string {
  const sig = detectConstraintSignals(goal);
  const lines = ["**§0 Constraints** _(stated in goal)_", ""];

  const entries: string[] = [];
  if (sig.read_only.detected)
    entries.push(`read-only — no external writes _(trigger: "${sig.read_only.trigger}")_`);
  if (sig.draft_only.detected)
    entries.push(`draft-only — no autonomous sends _(trigger: "${sig.draft_only.trigger}")_`);
  if (sig.no_outbound.detected && !sig.draft_only.detected)
    entries.push(`no-outbound — stays internal _(trigger: "${sig.no_outbound.trigger}")_`);
  if (sig.attended_required.detected)
    entries.push(`attended — a human reviews before actions _(trigger: "${sig.attended_required.trigger}")_`);
  if (sig.unattended.detected && !sig.attended_required.detected)
    entries.push(`unattended — no human in the loop _(trigger: "${sig.unattended.trigger}")_`);

  if (entries.length === 0) {
    // Only when it's actually true (MAR-255 edge case: keep today's line).
    lines.push("- No explicit read-only / unattended / no-outbound constraint detected.");
  } else {
    for (const c of entries) lines.push(`- ${c}`);
  }

  if (sig.conflict) {
    lines.push(
      "",
      `> ⚠️ **Conflicting constraints:** the goal both waives and requires human review ` +
        `("${sig.unattended.trigger}" vs "${sig.attended_required.trigger}"). ` +
        `Resolve this before building — state ONE of the two in the goal and re-run plan_workflow.`,
    );
  }
  if (approvalAdvisory) {
    lines.push("", `> ⚠️ **Gate advisory:** ${approvalAdvisory.reason}`);
  }
  return lines.join("\n");
}

function s1Summary(
  goal: string,
  planSource: "playbook" | "composed",
  routeStatus: string,
  stepCount: number,
): string {
  const sourceLabel = planSource === "playbook" ? "validated playbook" : "composed candidate";
  const statusEmoji = routeStatus === "validated" ? "✅" : routeStatus === "blocked_candidate" ? "❌" : "⚠️";
  return [
    "**§1 Summary** _(registry-grounded)_ 🟢",
    "",
    `**Goal:** ${goal}`,
    "",
    `**Source:** ${sourceLabel} ${statusEmoji} \`${routeStatus}\`  |  **Steps:** ${stepCount}`,
  ].join("\n");
}

function s2Route(
  steps: z.infer<typeof RouteStepShape>[],
  designNotes: string[],
): string {
  const lines = ["**§2 Route** _(component IDs and model tiers are 🟢 registry-grounded)_", ""];
  for (const s of steps) {
    const tier = s.model_tier === "none" ? "deterministic" : `${s.model_tier} LLM`;
    const risk = s.risk_level ?? "unknown";
    const name = s.component_name ?? s.component_id;
    const purpose = s.purpose ? ` — ${s.purpose}` : "";
    lines.push(`${s.step}. **\`${s.component_id}\`** (${name}) [${tier}, ${risk} risk]${purpose}`);
  }
  if (designNotes.length > 0) {
    lines.push("", "**Design notes** _(edge control_flow_note annotations, 🟢 grounded)_", "");
    for (const n of designNotes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

function s3WorkerContracts(
  workerPipeline: { workers: z.infer<typeof WorkerShape>[]; feedback_loops: object[] } | null | undefined,
): string {
  if (!workerPipeline || workerPipeline.workers.length === 0) {
    // MAR-255: honest absence line — the old copy claimed "No worker pipeline
    // in registry" when the caller simply hadn't passed it (audit defect 2).
    return (
      "**§3 Worker contracts** — Not included in this call. " +
      "Pass `worker_pipeline` from a `plan_workflow` response " +
      '(available at `output_depth: "technical"`, MAR-256) to include the build-team contracts.'
    );
  }
  const lines = [
    "**§3 Worker contracts** _(build team for implementing this plan, 🟢 grounded)_",
    "",
    `**Pipeline:** ${workerPipeline.workers.map((w) => `\`${w.worker_id}\``).join(" → ")}`,
    "",
  ];
  for (const w of workerPipeline.workers) {
    const tier = w.model_tier === "none" ? "deterministic" : `${w.model_tier} tier`;
    lines.push(
      `${w.step}. **${w.title}** (\`${w.role}\`, ${tier})`,
      `   - Consumes: ${w.inputs.join("; ") || "—"}`,
      `   - Produces: ${w.outputs.join("; ") || "—"}`,
    );
  }
  return lines.join("\n");
}

function s4LoopContract(
  loopGuidance: {
    playbook_id: string;
    worker_sequence: string[];
    loop_contract: z.infer<typeof LoopContractShape>;
    guardrail_checklist: string[];
  } | null | undefined,
): string {
  if (!loopGuidance) {
    // MAR-255: render §4 explicitly instead of skipping it — the §3 → §5
    // numbering hole read as a bug to users (audit defect 3).
    return (
      "**§4 Loop contract** — No loop in this plan. " +
      "(Non-empty only when the route is loop-shaped; if plan_workflow returned " +
      "`loop_guidance`, pass it to include the bounded-iteration spec.)"
    );
  }
  const lc = loopGuidance.loop_contract;
  const lines = [
    "**§4 Loop contract** _(bounded-iteration spec, 🟢 grounded from playbook)_",
    "",
    `- **Playbook:** \`${loopGuidance.playbook_id}\``,
    `- **Worker sequence:** ${loopGuidance.worker_sequence.map((w) => `\`${w}\``).join(" → ")}`,
    `- **max_iterations:** ${lc.max_iterations}`,
    `- **Stop when:** ${lc.stop_condition}`,
    `- **Escalate when:** ${lc.escalation_condition}`,
    `- **Human gate required for:** ${lc.human_gate_required_for.join(", ")}`,
    `- **State persisted:** ${lc.state_required ? "yes" : "no"} · **Audited:** ${lc.audit_required ? "yes" : "no"}`,
    `- **Reviewer independent:** ${lc.reviewer_independent ? "yes" : "no"}`,
    `- **No external write until final gate:** ${lc.no_write_until_final_gate ? "yes" : "no"}`,
    "",
    "**Guardrails:**",
  ];
  for (const g of loopGuidance.guardrail_checklist) lines.push(`- [ ] ${g}`);
  return lines.join("\n");
}

function s5Safety(
  safety: z.infer<typeof SafetyReviewShape>,
  clearance: z.infer<typeof AutomationClearanceShape>,
  enforcedGates: string[],
  untestedEdges: { id: string; severity: string }[],
): string {
  const safetyEmoji = safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  const autoEmoji = clearance.autonomous_allowed ? "✅" : clearance.level === "L4" ? "❌" : "⚠️";
  const lines = [
    "**§5 Safety** _(🟢 registry-computed — deterministic rule set)_",
    "",
    `**Safety status:** ${safetyEmoji} ${safety.status.toUpperCase()} (risk ${safety.risk_score}/100)`,
    `**Automation clearance:** ${autoEmoji} ${clearance.level} — ${clearance.autonomous_allowed ? "may run unattended" : "human in the loop required"}`,
    "",
    `> ${clearance.reason}`,
  ];
  if (clearance.highest_action_components.length > 0) {
    lines.push(``, `Driven by: ${clearance.highest_action_components.map((c) => `\`${c}\``).join(", ")}`);
  }
  if (enforcedGates.length > 0) {
    lines.push("", `**Enforced gates:** ${enforcedGates.map((g) => `\`${g}\``).join(", ")}`);
  }
  if (safety.blocking_issues.length > 0) {
    lines.push("", "**Blocking issues:**");
    for (const b of safety.blocking_issues) lines.push(`- ❌ ${b}`);
  }
  if (untestedEdges.length > 0) {
    lines.push("", `**Untested edges (${untestedEdges.length}) — validate before shipping:**`);
    for (const e of untestedEdges) {
      const q =
        e.severity === "critical" ? "❌ CRITICAL — what breaks if this edge misfires in production?"
        : e.severity === "high" ? "⚠️ HIGH — write a test that covers this path before deploying."
        : `(${e.severity}) — add a test or xfail with a linked issue.`;
      lines.push(`- \`${e.id}\` — ${q}`);
    }
  }
  if (clearance.required_controls.length > 0) {
    lines.push("", "**Controls required to run unattended:**");
    for (const ctrl of clearance.required_controls) lines.push(`- ${ctrl}`);
  }
  return lines.join("\n");
}

function s6DoNotAdd(
  avoidViolations: { edge?: string; reason?: string }[],
): string {
  const lines = [
    "**§6 Do-NOT-add** _(negative scope — components the registry flags as avoid_when)_",
    "",
  ];
  if (avoidViolations.length === 0) {
    lines.push("- No avoid_when violations detected for this route.");
  } else {
    for (const v of avoidViolations) {
      const edge = v.edge ? `\`${v.edge}\`` : "unknown edge";
      const reason = v.reason ?? "registry avoid_when rule";
      lines.push(`- ${edge}: ${reason}`);
    }
  }
  lines.push(
    "",
    "> Do not add components outside this route without re-running `plan_workflow` — " +
    "the graph may have avoid_when / avoid_with rules that make additions unsafe.",
  );
  return lines.join("\n");
}

function s7ReviewLoopback(evalsToAdd: string[], warnings: string[]): string {
  const lines = ["**§7 Review loop-back** _(what to verify before shipping)_", ""];
  if (evalsToAdd.length > 0) {
    lines.push("**Evals to add:**");
    for (const e of evalsToAdd) lines.push(`- [ ] ${e}`);
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push("**Safety warnings:**");
    for (const w of warnings) lines.push(`- ⚠️ ${w}`);
    lines.push("");
  }
  if (evalsToAdd.length === 0 && warnings.length === 0) {
    lines.push("- No additional evals or warnings surfaced for this route.");
  }
  lines.push(
    "> Run `review_workflow_design` after any structural change to the route — " +
    "adding or removing a component can introduce new violations.",
  );
  return lines.join("\n");
}

function s8DefinitionOfDone(
  routeStatus: string,
  safety: z.infer<typeof SafetyReviewShape>,
  clearance: z.infer<typeof AutomationClearanceShape>,
  untestedEdges: { id: string; severity: string }[],
  enforcedGates: string[],
): string {
  const lines = ["**§8 Definition of Done** _(gate checklist)_", ""];

  // Route validation gate
  if (routeStatus === "validated") {
    lines.push("- [x] Route is validated (playbook golden path)");
  } else if (routeStatus === "blocked_candidate") {
    lines.push("- [ ] ❌ Route has critical avoid_when violations — resolve before building");
  } else {
    lines.push("- [ ] Route is a candidate — log a dogfood session after shipping to promote to validated");
  }

  // Safety gate
  if (safety.status === "pass") {
    lines.push("- [x] Safety review passed");
  } else {
    lines.push(`- [ ] Safety review: ${safety.status} — resolve ${safety.blocking_issues.length} blocking issue(s)`);
  }

  // Approval gate
  if (enforcedGates.length > 0) {
    lines.push(`- [x] Approval gate enforced: ${enforcedGates.join(", ")}`);
  } else if (clearance.level === "L3" || clearance.level === "L4") {
    lines.push(`- [ ] ⚠️ ${clearance.level} clearance — add human_approval_gate before deploying`);
  }

  // Automation clearance gate
  if (clearance.autonomous_allowed) {
    lines.push(`- [x] Automation clearance ${clearance.level} — may run unattended`);
  } else if (clearance.level === "L4") {
    lines.push("- [ ] L4 — human approval is mandatory and non-droppable");
  } else {
    lines.push(`- [ ] ${clearance.level} — add required controls before removing human gate`);
  }

  // Untested-edge gate
  const criticalUntested = untestedEdges.filter((e) => e.severity === "critical");
  const highUntested = untestedEdges.filter((e) => e.severity === "high");
  if (untestedEdges.length === 0) {
    lines.push("- [x] All in-route edges are tested");
  } else if (criticalUntested.length > 0) {
    lines.push(`- [ ] ❌ ${criticalUntested.length} critical untested edge(s) — block ship until covered`);
  } else if (highUntested.length > 0) {
    lines.push(`- [ ] ⚠️ ${highUntested.length} high-severity untested edge(s) — add tests or xfail`);
  } else {
    lines.push(`- [ ] ${untestedEdges.length} medium/low untested edge(s) — add tests or xfail + issue`);
  }

  // Always-present operational gates
  lines.push(
    "- [ ] Credentials connected + live-probed (`node scripts/connect.mjs --check` green — §11)",
    "- [ ] Credentials scoped to least-privilege (bounded permissions)",
    "- [ ] Dry-run / preview tested before any live action",
    "- [ ] Idempotency verified (safe to retry)",
    "- [ ] Kill switch reachable (operator can halt the run)",
    "- [ ] Audit log wired and producing entries",
  );

  return lines.join("\n");
}

/**
 * §9 — DASH observability wiring (MAR-296 / DASH-02).
 *
 * Instructs the building LLM to emit run events per the DASH-v1 contract. Renders
 * for every build_target (env-var endpoint/token are build-target-agnostic). The
 * manifest itself is the structured `agent_manifest` output field; this section
 * is the human/agent-readable wiring recipe. No PII, non-fatal, env-var config.
 */
function s9Observability(manifest: AgentManifest): string {
  const irreversible = manifest.safety_contract.irreversible_components;
  const lines = [
    "**§9 Observability wiring** _(DASH telemetry contract v1 — 🟢 grounded, advisory to wire)_",
    "",
    `This plan ships with an \`agent.manifest.json\` (the \`agent_manifest\` field of this ` +
      `result). Write it beside the built agent and import it into DASH — the agent card ` +
      `appears with this planned route. Then have the agent POST run events as it executes:`,
    "",
    `- **Endpoint / token:** read from env — \`${DASH_ENDPOINT_ENV}\` and \`${DASH_TOKEN_ENV}\` ` +
      `(static bearer token per agent). \`POST {${DASH_ENDPOINT_ENV}}/api/events\` with ` +
      `\`Authorization: Bearer {${DASH_TOKEN_ENV}}\`.`,
    `- **Events (build_target: \`${manifest.agent.build_target}\`):** emit \`run_started\` → ` +
      `\`step_started\`/\`step_completed\` per step → \`run_completed\` (or \`run_failed\`). ` +
      `Include \`run_id\`, a monotonic \`seq\`, \`ts\`, and the planned \`component_id\`.`,
    `- **Fire-and-forget:** wrap every emit in a non-fatal try/catch — an unreachable DASH ` +
      `must never break the agent run.`,
    `- **No secrets, no PII:** events carry ids, statuses, counts, costs — never message ` +
      `bodies, tokens, or credentials. Keep \`detail\` a short, PII-free hint.`,
  ];
  if (irreversible.length > 0) {
    lines.push(
      `- **Gate compliance:** before each irreversible step ` +
        `(${irreversible.map((c) => `\`${c}\``).join(", ")}) emit \`gate_requested\` then ` +
        `\`gate_resolved\`. DASH flags an irreversible \`step_started\` with no preceding ` +
        `resolved gate as a red badge.`,
    );
  }
  return lines.join("\n");
}

// ─────────────────────────── MAR-249: artifact compiler ─────────────────────

function shortGoal(goal: string, max = 80): string {
  const clean = goal.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}...` : clean;
}

function componentLabel(step: z.infer<typeof RouteStepShape>): string {
  return step.component_name ?? step.component_id;
}

function markdownList(items: string[]): string {
  return items.length === 0 ? "- UNKNOWN - ask before implementation." : items.map((i) => `- ${i}`).join("\n");
}

function fieldToMarkdown(label: string, value: ArtifactFieldValue): string {
  const body = Array.isArray(value) ? markdownList(value) : value;
  return `### ${label}\n${body}`;
}

function issueFieldsToMarkdown(fields: ArtifactIssueFields): string {
  const labels: Record<ArtifactIssueFieldKey, string> = {
    title: "Title",
    goal: "Goal",
    user_story: "User story",
    context: "Context",
    inputs: "Inputs",
    outputs: "Outputs",
    required_tools: "Required tools",
    data_model: "Data model",
    step_by_step_implementation: "Step-by-step implementation",
    edge_cases: "Edge cases",
    failure_modes: "Failure modes",
    security: "Security",
    approval_gates: "Approval gates",
    acceptance_criteria: "Acceptance criteria",
    test_cases: "Test cases",
    definition_of_done: "Definition of Done",
    claude_code_cursor_prompt: "Claude-Code/Cursor prompt",
    files_likely_affected: "Files likely affected",
    non_goals: "Non-goals",
  };

  return ARTIFACT_ISSUE_FIELD_ORDER
    .map((key) => fieldToMarkdown(labels[key], fields[key]))
    .join("\n\n");
}

function buildDataModel(input: {
  recommended_route: z.infer<typeof RouteStepShape>[];
  enforced_approval_gates: string[];
}): string[] {
  const components = input.recommended_route.map((s) => s.component_id).join(" -> ");
  const model = [
    `WorkflowRun: run_id, goal, status, started_at, completed_at, route_components (${components}).`,
    "StepResult: run_id, component_id, step_number, status, input_ref, output_ref, error_message.",
    "AuditEvent: run_id, component_id, event_type, timestamp, detail, actor.",
  ];
  if (input.enforced_approval_gates.length > 0) {
    model.push(
      `ApprovalDecision: run_id, gate (${input.enforced_approval_gates.join(", ")}), reviewer, decision, decided_at, notes.`,
    );
  }
  return model;
}

function unknownRepoFiles(): string[] {
  return [
    "UNKNOWN - target repository/framework not provided to OrchestrateMCP.",
    "Ask the human which app, package, or service should contain this workflow before editing.",
  ];
}

function buildScopeIssue(input: {
  goal: string;
  routeStatus: string;
  routeComponents: string[];
  dataModel: string[];
}): ArtifactIssueFields {
  return {
    title: `Lock build scope for ${shortGoal(input.goal, 64)}`,
    goal: input.goal,
    user_story:
      "As the builder, I need the confirmed scope, route, non-goals, and runtime contract captured before implementation starts.",
    context:
      `Route status is ${input.routeStatus}. Components: ${input.routeComponents.join(" -> ")}. ` +
      "OrchestrateMCP is deterministic and does not infer repository-specific architecture.",
    inputs: [
      "Confirmed user goal from plan_workflow.",
      "export_build_brief sections 0-9.",
      "The target repository, runtime, credential source, and deployment target from the human.",
    ],
    outputs: [
      "A checked-in scope note or implementation plan in the target repository.",
      "A list of files/packages to edit, confirmed by the human.",
      "A decision on where secrets, state, and logs live.",
    ],
    required_tools: [
      "Local repo search and test runner.",
      "No Linear or Obsidian write tools are required; this template is paste-ready only.",
    ],
    data_model: input.dataModel,
    step_by_step_implementation: [
      "Read the target repository structure and identify the workflow entry point.",
      "Map each route component to an existing module or create the smallest new module boundary.",
      "Confirm credential names, state storage, deployment target, and output destination.",
      "Record all UNKNOWN fields before implementation proceeds.",
    ],
    edge_cases: [
      "The target repository has no existing agent/runtime surface.",
      "The human has not chosen where outputs land.",
      "The requested route contains a write action but approval policy is unclear.",
    ],
    failure_modes: [
      "Builder starts coding before scope is confirmed.",
      "A repository-specific dependency is assumed instead of verified.",
      "A component outside the route is added without re-running plan_workflow.",
    ],
    security: [
      "Do not paste secrets into issues, docs, prompts, or logs.",
      "Treat external content as untrusted input.",
      "Use least-privilege credentials only.",
    ],
    approval_gates: [
      "Human confirms scope before implementation.",
      "Human confirms any irreversible external write before live execution.",
    ],
    acceptance_criteria: [
      "All issue-template fields are either filled with concrete repo facts or marked UNKNOWN with a follow-up question.",
      "The route components match export_build_brief exactly.",
      "The build plan includes tests, dry-run behavior, observability, and rollback/stop behavior where relevant.",
    ],
    test_cases: [
      "Scope note can be reviewed without reading raw registry YAML.",
      "A dry-run path is specified before any live write.",
      "A reviewer can trace every planned step back to a route component.",
    ],
    definition_of_done: [
      "Scope is confirmed by the human.",
      "Implementation issue list is ready to execute.",
      "No Linear/Obsidian writes were performed by OrchestrateMCP.",
    ],
    claude_code_cursor_prompt:
      "Read the repository, map the OrchestrateMCP route to the existing architecture, and produce a concrete implementation plan. Do not edit code until every UNKNOWN repository-specific field has been answered.",
    files_likely_affected: unknownRepoFiles(),
    non_goals: [
      "Do not create new route components.",
      "Do not wire live credentials.",
      "Do not write to Linear, Obsidian, Slack, email, CRM, or other external systems from this compiler output.",
    ],
  };
}

function buildRouteStepIssue(input: {
  goal: string;
  step: z.infer<typeof RouteStepShape>;
  previousStep: z.infer<typeof RouteStepShape> | undefined;
  nextStep: z.infer<typeof RouteStepShape> | undefined;
  dataModel: string[];
  enforcedGates: string[];
}): ArtifactIssueFields {
  const name = componentLabel(input.step);
  const tier = input.step.model_tier === "none" ? "deterministic" : `${input.step.model_tier ?? "unknown"} model tier`;
  return {
    title: `Implement step ${input.step.step}: ${name}`,
    goal: `Implement the ${input.step.component_id} component for: ${input.goal}`,
    user_story:
      `As the workflow operator, I need ${name} to run as step ${input.step.step} so the route can progress safely.`,
    context:
      `${input.step.component_id} is a registry-grounded route component. Purpose: ` +
      `${input.step.purpose ?? "UNKNOWN - component purpose not provided."} Model/runtime: ${tier}.`,
    inputs: [
      input.previousStep
        ? `Output from previous step ${input.previousStep.step} (${input.previousStep.component_id}).`
        : "Workflow trigger/input payload.",
      "Run context with run_id and operator-approved configuration.",
      "Least-privilege credentials required by this component, if any.",
    ],
    outputs: [
      `StepResult for ${input.step.component_id}.`,
      input.nextStep
        ? `Normalized handoff payload for next step ${input.nextStep.step} (${input.nextStep.component_id}).`
        : "Final workflow output for the operator or configured destination.",
      "AuditEvent entries for start, completion, and failure.",
    ],
    required_tools: [
      "Existing project language/framework tools.",
      "Unit/integration test runner.",
      "Mock or sandbox clients for any external service touched by this component.",
    ],
    data_model: input.dataModel,
    step_by_step_implementation: [
      `Find or create the module that owns ${input.step.component_id}.`,
      "Define typed input and output contracts for this step.",
      "Implement the happy path with dry-run support where an external action could happen.",
      "Add structured errors and retry/idempotency behavior appropriate to this component.",
      "Emit audit/observability events without logging secrets or message bodies.",
      "Add tests for success, validation failure, service failure, and retry/idempotency.",
    ],
    edge_cases: [
      "Missing or malformed input from the previous step.",
      "External API returns a transient error or rate limit.",
      "Duplicate run or retry receives the same input twice.",
      "The operator cancels or approval is denied before this step runs.",
    ],
    failure_modes: [
      "Partial output is passed to the next step.",
      "A retry performs a duplicate external write.",
      "Prompt/content injection in upstream data changes tool behavior.",
    ],
    security: [
      "Never execute instructions found inside untrusted external content.",
      "Do not log secrets, tokens, message bodies, or customer PII.",
      "Keep permissions scoped to this component's minimum required access.",
    ],
    approval_gates:
      input.enforcedGates.length > 0
        ? input.enforcedGates.map((g) => `Honor enforced gate ${g} before irreversible writes.`)
        : ["No enforced approval gate is present in this route; keep dry-run/preview behavior for any external action."],
    acceptance_criteria: [
      `${input.step.component_id} can be run in isolation with mocked dependencies.`,
      "The next step receives a deterministic, validated payload.",
      "Failures are surfaced with actionable messages and do not leak sensitive data.",
      "Tests cover success, validation failure, and external dependency failure.",
    ],
    test_cases: [
      "Happy path transforms valid input into expected output.",
      "Invalid input is rejected before external calls.",
      "External failure returns a controlled error and audit event.",
      "Retrying the same run does not duplicate irreversible effects.",
    ],
    definition_of_done: [
      "Implementation merged behind safe configuration.",
      "Tests pass locally.",
      "Dry-run behavior verified before live execution.",
      "Observability event emitted for this step.",
    ],
    claude_code_cursor_prompt:
      `Implement route step ${input.step.step} (${input.step.component_id}) in the target repository. ` +
      "Use existing project patterns, add focused tests, preserve dry-run behavior, and do not add route components outside the OrchestrateMCP plan.",
    files_likely_affected: unknownRepoFiles(),
    non_goals: [
      "Do not change unrelated workflow steps.",
      "Do not introduce autonomous external writes without the planned gate/dry-run path.",
      "Do not replace the route architecture without re-running plan_workflow.",
    ],
  };
}

function buildHardeningIssue(input: {
  goal: string;
  safety: z.infer<typeof SafetyReviewShape>;
  clearance: z.infer<typeof AutomationClearanceShape>;
  enforcedGates: string[];
  untestedEdges: { id: string; severity: string }[];
  dataModel: string[];
}): ArtifactIssueFields {
  return {
    title: `Verify safety, approvals, tests, and DASH telemetry for ${shortGoal(input.goal, 56)}`,
    goal: `Make the built workflow safe to ship for: ${input.goal}`,
    user_story:
      "As the operator, I need tests, approval gates, observability, and failure handling verified before any live run.",
    context:
      `Safety status: ${input.safety.status}; clearance: ${input.clearance.level}; ` +
      `untested edges: ${input.untestedEdges.length}.`,
    inputs: [
      "Implemented route steps.",
      "Safety review from export_build_brief section 5.",
      "Definition of Done from export_build_brief section 8.",
      "agent.manifest.json from export_build_brief.",
    ],
    outputs: [
      "Passing test suite.",
      "Dry-run evidence for the workflow.",
      "Approval gate evidence where required.",
      "DASH-compatible run event emission or an explicit TODO if monitoring is deferred.",
    ],
    required_tools: [
      "Project test runner.",
      "Mock external service clients.",
      "DASH endpoint/token environment variables when monitoring is wired.",
    ],
    data_model: input.dataModel,
    step_by_step_implementation: [
      "Add end-to-end dry-run coverage for the whole route.",
      "Add tests or tracked follow-ups for every untested edge.",
      "Verify approval gates block irreversible writes until resolved.",
      "Wire DASH run events as non-fatal fire-and-forget calls.",
      "Document rollback, kill switch, and operational runbook steps.",
    ],
    edge_cases: [
      "DASH endpoint is unreachable.",
      "Approval is denied or times out.",
      "External service is partially unavailable.",
      "The same run is retried after a crash.",
    ],
    failure_modes: [
      "A live write happens during dry-run.",
      "Telemetry failure breaks the agent run.",
      "Approval events are logged after the irreversible step instead of before it.",
    ],
    security: [
      "DASH events must not include message bodies, credentials, or PII.",
      "Secrets come from environment or the platform secret store only.",
      "Audit logs should contain ids, statuses, counts, and short safe detail only.",
    ],
    approval_gates:
      input.enforcedGates.length > 0
        ? input.enforcedGates.map((g) => `Test ${g} blocks irreversible actions before release.`)
        : ["No enforced approval gate in route; verify clearance and document why unattended execution is acceptable."],
    acceptance_criteria: [
      "All section 8 Definition of Done gates are satisfied or have explicit human-approved follow-ups.",
      "Dry-run mode cannot perform live external writes.",
      "Observability emission is non-fatal and excludes secrets/PII.",
      "Untested critical/high edges are covered before shipping.",
    ],
    test_cases: [
      "Full-route dry-run success.",
      "Approval denied path.",
      "Telemetry unavailable path.",
      "Crash/retry idempotency path.",
    ],
    definition_of_done: [
      "pnpm/test equivalent passes in the target repository.",
      "Release notes list remaining UNKNOWNs, if any.",
      "Human reviewer confirms live-run readiness.",
    ],
    claude_code_cursor_prompt:
      "Harden the implemented workflow. Add dry-run, approval-gate, failure, idempotency, and DASH telemetry tests. Keep telemetry non-fatal and do not leak sensitive data.",
    files_likely_affected: unknownRepoFiles(),
    non_goals: [
      "Do not weaken approval requirements to make tests pass.",
      "Do not make telemetry a hard dependency for workflow execution.",
      "Do not ship with unresolved critical/high untested edges.",
    ],
  };
}

function issueMarkdown(id: string, milestoneId: string, fields: ArtifactIssueFields): string {
  return `## ${id} (${milestoneId})\n\n${issueFieldsToMarkdown(fields)}`;
}

function buildArtifactPackage(input: {
  goal: string;
  route_status: string;
  recommended_route: z.infer<typeof RouteStepShape>[];
  safety_review: z.infer<typeof SafetyReviewShape>;
  automation_clearance: z.infer<typeof AutomationClearanceShape>;
  enforced_approval_gates: string[];
  untested_edges: { id: string; severity: string }[];
}): BuildArtifactPackage {
  const routeComponents = input.recommended_route.map((s) => s.component_id);
  const dataModel = buildDataModel({
    recommended_route: input.recommended_route,
    enforced_approval_gates: input.enforced_approval_gates,
  });

  const scopeFields = buildScopeIssue({
    goal: input.goal,
    routeStatus: input.route_status,
    routeComponents,
    dataModel,
  });
  const routeIssues = input.recommended_route.map((step, index) =>
    buildRouteStepIssue({
      goal: input.goal,
      step,
      previousStep: input.recommended_route[index - 1],
      nextStep: input.recommended_route[index + 1],
      dataModel,
      enforcedGates: input.enforced_approval_gates,
    }),
  );
  const hardeningFields = buildHardeningIssue({
    goal: input.goal,
    safety: input.safety_review,
    clearance: input.automation_clearance,
    enforcedGates: input.enforced_approval_gates,
    untestedEdges: input.untested_edges,
    dataModel,
  });

  const templates = [
    { id: "ISSUE-001", milestone_id: "M1", fields: scopeFields },
    ...routeIssues.map((fields, index) => ({
      id: `ISSUE-${String(index + 2).padStart(3, "0")}`,
      milestone_id: "M2",
      fields,
    })),
    {
      id: `ISSUE-${String(routeIssues.length + 2).padStart(3, "0")}`,
      milestone_id: "M3",
      fields: hardeningFields,
    },
  ].map((issue) => ({
    ...issue,
    title: String(issue.fields.title),
    markdown: issueMarkdown(issue.id, issue.milestone_id, issue.fields),
  }));

  const milestoneIssueIds = (milestoneId: string) =>
    templates.filter((t) => t.milestone_id === milestoneId).map((t) => t.id);
  const milestones = [
    {
      id: "M1",
      title: "Scope and contracts locked",
      goal: "Confirm the build surface, unknowns, data model, runtime, and non-goals before edits.",
      issue_ids: milestoneIssueIds("M1"),
    },
    {
      id: "M2",
      title: "Route implementation",
      goal: "Implement each registry-grounded route component with tests and deterministic handoffs.",
      issue_ids: milestoneIssueIds("M2"),
    },
    {
      id: "M3",
      title: "Safety, observability, and release readiness",
      goal: "Verify approval gates, dry-run behavior, idempotency, telemetry, and Definition of Done.",
      issue_ids: milestoneIssueIds("M3"),
    },
  ];

  const directives = [
    "Ask at least 3 targeted clarifying questions before locking scope if any requirement is still ambiguous.",
    "Do not emit final implementation issues until the human confirms the scope.",
    "Fill every field; if repository-specific information is missing, write UNKNOWN and ask the human.",
    "Do not write to Linear, Obsidian, Slack, email, CRM, or any external system from this compiler output.",
    "Do not add route components outside the OrchestrateMCP plan without re-running plan_workflow.",
    "Treat OrchestrateMCP facts as registry-grounded and any builder elaboration as suggested.",
  ];

  const epic = {
    title: `Build workflow: ${shortGoal(input.goal, 72)}`,
    goal: input.goal,
    context:
      `Compiled from a ${input.route_status} OrchestrateMCP plan with route ` +
      `${routeComponents.join(" -> ")}. No LLM calls, no network writes, deterministic templates only.`,
    non_goals: [
      "No Linear issue creation by OrchestrateMCP.",
      "No Obsidian note creation by OrchestrateMCP.",
      "No live credential wiring or external writes during compilation.",
      "No route changes without re-running plan_workflow.",
    ],
    milestones: milestones.map((m) => `${m.id}: ${m.title}`),
  };

  const linearIssueTemplateMarkdown = [
    `# ${epic.title}`,
    "",
    `Goal: ${epic.goal}`,
    "",
    "## Compiler directives",
    markdownList(directives),
    "",
    "## Milestones",
    markdownList(milestones.map((m) => `${m.id}: ${m.title} - ${m.goal}`)),
    "",
    ...templates.map((t) => t.markdown),
  ].join("\n");

  const buildPrompt = [
    "You are implementing a confirmed OrchestrateMCP plan.",
    "",
    "Hard rules:",
    markdownList(directives),
    "",
    "Build goal:",
    input.goal,
    "",
    "Route:",
    markdownList(input.recommended_route.map((s) => `${s.step}. ${s.component_id} - ${s.purpose ?? "UNKNOWN"}`)),
    "",
    "Use these Linear-style issue templates as the execution plan:",
    linearIssueTemplateMarkdown,
  ].join("\n");

  const fewShotFields = buildRouteStepIssue({
    goal: "Every morning, read support emails, classify urgency, and draft replies for human approval.",
    step: {
      step: 1,
      component_id: "email_read",
      component_name: "Email reader",
      purpose: "Read unread support emails from the configured mailbox.",
      model_tier: "none",
      risk_level: "low",
    },
    previousStep: undefined,
    nextStep: {
      step: 2,
      component_id: "intent_classifier",
      component_name: "Intent classifier",
      purpose: "Classify urgency and reply need.",
      model_tier: "standard",
      risk_level: "medium",
    },
    dataModel: [
      "WorkflowRun: run_id, goal, status, started_at, completed_at.",
      "EmailMessage: message_id, thread_id, sender, received_at, subject_ref, body_ref.",
      "StepResult: run_id, component_id, status, output_ref, error_message.",
    ],
    enforcedGates: ["human_approval_gate"],
  });

  return {
    compiler: "export_build_brief.artifact_compiler.v1",
    status: "compiled",
    scope_confirmation: {
      assumed_confirmed: true,
      instruction:
        "export_build_brief is a post-plan compiler. Use this package only after the human confirms scope; otherwise ask the clarifying questions first.",
    },
    directives,
    field_order: [...ARTIFACT_ISSUE_FIELD_ORDER],
    epic,
    milestones,
    linear_issue_templates: templates,
    few_shot_example: {
      title: String(fewShotFields.title),
      markdown: issueMarkdown("EXAMPLE-001", "M2", fewShotFields),
      note:
        "Few-shot example is deterministic and illustrative. Replace repository-specific UNKNOWNs with human-confirmed facts before editing.",
    },
    build_prompt: buildPrompt,
    linear_issue_template_markdown: linearIssueTemplateMarkdown,
  };
}

// ─────────────────────────── handoff formatters ───────────────────────────

function buildPromptHandoff(
  goal: string,
  sections: BuildBriefOutput["sections"],
  artifactPackage: BuildArtifactPackage,
  connect: ConnectArtifacts,
): string {
  const sectionList = [
    sections.s0_constraints,
    sections.s1_summary,
    sections.s2_route,
    sections.s3_worker_contracts,
    sections.s4_loop_contract,
    sections.s5_safety,
    sections.s6_do_not_add,
    sections.s7_review_loopback,
    sections.s8_definition_of_done,
    sections.s9_observability,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n---\n\n");

  return (
    `You are building an AI agent workflow for the following goal:\n\n` +
    `> ${goal}\n\n` +
    `The plan below is deterministically generated by OrchestrateMCP — ` +
    `all component IDs, edge relationships, safety findings, and clearance levels are ` +
    `🟢 registry-grounded facts. Do not add components outside the route without ` +
    `re-running plan_workflow. Your elaborations are 🔵 suggested — do not present ` +
    `them as registry facts.\n\n` +
    `---\n\n${sectionList}\n\n---\n\n` +
    `Work through §8 Definition of Done before shipping. Write the result's ` +
    `\`connect.connect_script\` field verbatim to \`${connect.script_path}\` in the built repo ` +
    `(§11 — fast credential setup; do not retype it). Then use the Tier 2 ` +
    `artifact compiler package below as the build execution prompt.\n\n` +
    `---\n\n${artifactPackage.build_prompt}\n\n---\n\n` +
    `When done, call \`record_session_feedback\` with the completed route and ratings.`
  );
}

function buildLinearHandoff(
  goal: string,
  sections: BuildBriefOutput["sections"],
  artifactPackage: BuildArtifactPackage,
): string {
  return (
    `## Build brief\n\n` +
    `**Goal:** ${goal}\n\n` +
    `${sections.s1_summary}\n\n` +
    `${sections.s2_route}\n\n` +
    `${sections.s5_safety}\n\n` +
    `${sections.s8_definition_of_done}\n\n` +
    `---\n\n` +
    `${artifactPackage.linear_issue_template_markdown}\n\n` +
    `---\n_Generated by OrchestrateMCP export_build_brief (MAR-205). ` +
    `Tier 2 artifact compiler (MAR-249); registry-grounded; no LLM-generated content; ` +
    `no Linear write was performed._`
  );
}

function buildObsidianHandoff(
  goal: string,
  planSource: string,
  routeStatus: string,
  routeComponents: string[],
  sections: BuildBriefOutput["sections"],
): string {
  const date = new Date().toISOString().split("T")[0];
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return (
    `---\n` +
    `tags: [orchestratekit, build-brief]\n` +
    `date: ${date}\n` +
    `plan_source: ${planSource}\n` +
    `route_status: ${routeStatus}\n` +
    `components: [${routeComponents.map((c) => `"${c}"`).join(", ")}]\n` +
    `---\n\n` +
    `# Build Brief: ${slug}\n\n` +
    `${sections.s0_constraints}\n\n` +
    `${sections.s1_summary}\n\n` +
    `${sections.s2_route}\n\n` +
    `${sections.s5_safety}\n\n` +
    `${sections.s8_definition_of_done}\n\n` +
    `## Related\n\n` +
    `- [[registry/routes/${routeStatus === "validated" ? "routes" : "candidates"}]]\n` +
    `- [[sessions/log]]\n`
  );
}

// ─────────────────────────── core ───────────────────────────

export function exportBuildBrief(input: {
  goal: string;
  plan_source: "playbook" | "composed";
  route_status: string;
  recommended_route: z.infer<typeof RouteStepShape>[];
  safety_review: z.infer<typeof SafetyReviewShape>;
  automation_clearance: z.infer<typeof AutomationClearanceShape>;
  enforced_approval_gates: string[];
  untested_edges: { id: string; severity: string }[];
  avoid_when_violations: { edge?: string; reason?: string }[];
  evals_to_add: string[];
  design_notes: string[];
  worker_pipeline?: { workers: z.infer<typeof WorkerShape>[]; feedback_loops: object[] } | null;
  loop_guidance?: {
    playbook_id: string;
    worker_sequence: string[];
    loop_contract: z.infer<typeof LoopContractShape>;
    guardrail_checklist: string[];
  } | null;
  approval_gate_advisory?: { gate: string; write_components: string[]; reason: string } | null;
  handoff_targets: ("prompt" | "linear" | "obsidian")[];
  // ── MAR-296 / DASH-02 (all optional; sensible deterministic defaults) ──
  playbook_id?: string;
  route_id?: string;
  build_target?: ManifestBuildTarget;
  output_location?: string;
  agent_name?: string;
  /** Registry fingerprint for manifest provenance; defaults to the bundle's. */
  registry_fingerprint?: string;
  /** Manifest timestamp; injectable so tests/snapshots stay deterministic. */
  generated_at?: string;
}): BuildBriefOutput {
  const routeComponents = input.recommended_route.map((s) => s.component_id);

  // MAR-296: deterministic agent.manifest.json for DASH (no network, no LLM).
  const agent_manifest = buildAgentManifest({
    goal: input.goal,
    plan_source: input.plan_source,
    playbook_id: input.playbook_id ?? "",
    route_id: input.route_id ?? "",
    build_target: input.build_target ?? "code",
    route_steps: input.recommended_route.map((s) => ({
      step: s.step,
      component_id: s.component_id,
      risk_level: s.risk_level,
      model_tier: s.model_tier,
    })),
    automation_clearance: input.automation_clearance.level,
    enforced_approval_gates: input.enforced_approval_gates,
    output_location: input.output_location ?? "",
    registry_fingerprint: input.registry_fingerprint ?? registryContentFingerprint(),
    agent_name: input.agent_name,
    generated_at: input.generated_at,
  });

  // MAR-364: credential manifest + connect.mjs source, derived from the route.
  const connect = buildConnectArtifacts({
    route_steps: input.recommended_route.map((s) => ({
      component_id: s.component_id,
      model_tier: s.model_tier,
    })),
    agent_name: agent_manifest.agent.name,
    registry_fingerprint: input.registry_fingerprint ?? registryContentFingerprint(),
  });

  const sections: BuildBriefOutput["sections"] = {
    s0_constraints: s0Constraints(input.goal, input.approval_gate_advisory),
    s1_summary: s1Summary(
      input.goal,
      input.plan_source,
      input.route_status,
      input.recommended_route.length,
    ),
    s2_route: s2Route(input.recommended_route, input.design_notes),
    s3_worker_contracts: s3WorkerContracts(input.worker_pipeline),
    s4_loop_contract: s4LoopContract(input.loop_guidance),
    s5_safety: s5Safety(
      input.safety_review,
      input.automation_clearance,
      input.enforced_approval_gates,
      input.untested_edges,
    ),
    s6_do_not_add: s6DoNotAdd(input.avoid_when_violations),
    s7_review_loopback: s7ReviewLoopback(input.evals_to_add, input.safety_review.warnings),
    s8_definition_of_done: s8DefinitionOfDone(
      input.route_status,
      input.safety_review,
      input.automation_clearance,
      input.untested_edges,
      input.enforced_approval_gates,
    ),
    s9_observability: s9Observability(agent_manifest),
    s11_connect: s11Connect(connect),
  };

  const sectionList = [
    sections.s0_constraints,
    sections.s1_summary,
    sections.s2_route,
    sections.s3_worker_contracts,
    sections.s4_loop_contract,
    sections.s5_safety,
    sections.s6_do_not_add,
    sections.s7_review_loopback,
    sections.s8_definition_of_done,
    sections.s9_observability,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n---\n\n");

  const artifact_package = buildArtifactPackage({
    goal: input.goal,
    route_status: input.route_status,
    recommended_route: input.recommended_route,
    safety_review: input.safety_review,
    automation_clearance: input.automation_clearance,
    enforced_approval_gates: input.enforced_approval_gates,
    untested_edges: input.untested_edges,
  });

  const brief_markdown =
    `# Build Brief — ${input.goal.slice(0, 80)}${input.goal.length > 80 ? "…" : ""}\n\n` +
    `> **Provenance:** All component IDs, edge relations, safety findings, and clearance ` +
    `levels are 🟢 **registry-grounded** (deterministic, no LLM calls). ` +
    `Agent elaborations are 🔵 **suggested** — do not present them as registry facts.\n\n` +
    sectionList +
    `\n\n---\n\n` +
    `**§10 Tier 2 artifact compiler** _(MAR-249 — deterministic, no writes)_\n\n` +
    `The structured \`artifact_package\` field contains the epic, milestones, ` +
    `build prompt, Linear issue templates, field order, directives, and few-shot ` +
    `example. OrchestrateMCP compiled these artifacts only; it did not write to ` +
    `Linear, Obsidian, or any external system.` +
    `\n\n---\n\n` +
    sections.s11_connect;

  const handoffs: BuildBriefOutput["handoffs"] = {};
  if (input.handoff_targets.includes("prompt")) {
    handoffs.prompt = buildPromptHandoff(input.goal, sections, artifact_package, connect);
  }
  if (input.handoff_targets.includes("linear")) {
    handoffs.linear = buildLinearHandoff(input.goal, sections, artifact_package);
  }
  if (input.handoff_targets.includes("obsidian")) {
    handoffs.obsidian = buildObsidianHandoff(
      input.goal,
      input.plan_source,
      input.route_status,
      routeComponents,
      sections,
    );
  }

  return {
    brief_markdown,
    sections,
    handoffs,
    artifact_package,
    agent_manifest,
    connect,
    provenance_tag: "registry-grounded",
    grounding_note:
      "OrchestrateMCP makes no LLM calls. Every component ID, edge relation, safety " +
      "finding, and clearance level in this brief is 🟢 computed deterministically from " +
      "registry YAML files. Treat all agent elaborations as 🔵 suggested, not grounded.",
  };
}

// ──────────────────────────── registration ────────────────────────────

export function registerExportBuildBrief(server: McpServer): void {
  server.registerTool(
    "export_build_brief",
    {
      title: "Export Build Brief",
      description:
        "Takes a plan_workflow result and emits a provenance-tagged Build Brief — " +
        "a self-contained handoff document (§0 Constraints → §9 Observability wiring) " +
        "ready to paste into an IDE agent prompt, a Linear issue, or an Obsidian note. " +
        "Also emits a deterministic agent.manifest.json (agent_manifest) for DASH " +
        "monitoring. Stateless: stores nothing, makes no network calls. " +
        "Call after plan_workflow to get the agent-ready build spec.",
      inputSchema: InputShape,
      outputSchema: ExportBuildBriefOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const result = exportBuildBrief({
          goal: input.goal,
          plan_source: input.plan_source,
          route_status: input.route_status,
          recommended_route: input.recommended_route,
          safety_review: input.safety_review,
          automation_clearance: input.automation_clearance,
          enforced_approval_gates: input.enforced_approval_gates,
          untested_edges: input.untested_edges as { id: string; severity: string }[],
          avoid_when_violations: input.avoid_when_violations as { edge?: string; reason?: string }[],
          evals_to_add: input.evals_to_add,
          design_notes: input.design_notes,
          worker_pipeline: input.worker_pipeline as { workers: z.infer<typeof WorkerShape>[]; feedback_loops: object[] } | undefined,
          loop_guidance: input.loop_guidance as { playbook_id: string; worker_sequence: string[]; loop_contract: z.infer<typeof LoopContractShape>; guardrail_checklist: string[] } | undefined,
          approval_gate_advisory: input.approval_gate_advisory as { gate: string; write_components: string[]; reason: string } | undefined,
          handoff_targets: input.handoff_targets,
          playbook_id: input.playbook_id,
          route_id: input.route_id,
          build_target: input.build_target,
          output_location: input.output_location,
          agent_name: input.agent_name,
        });

        logger.debug(
          `export_build_brief → ${result.sections ? "ok" : "error"} ` +
          `sections=${Object.keys(result.sections).length}`,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        logger.error("export_build_brief failed", err);
        return toErrorResult(err);
      }
    },
  );
}
