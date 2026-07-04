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
 *
 * STATELESS CONTRACT: stores nothing, makes no network calls. The brief is the
 * paste-ready artifact; the human takes it to their IDE or Lab.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { detectConstraintSignals } from "../lib/constraintSignals.js";

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

const InputShape = {
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
    .optional()
    .describe("plan_workflow.worker_pipeline — build team (optional)."),
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
  };
  handoffs: {
    prompt?: string;
    linear?: string;
    obsidian?: string;
  };
  provenance_tag: "registry-grounded";
  grounding_note: string;
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
    "- [ ] Credentials scoped to least-privilege (bounded permissions)",
    "- [ ] Dry-run / preview tested before any live action",
    "- [ ] Idempotency verified (safe to retry)",
    "- [ ] Kill switch reachable (operator can halt the run)",
    "- [ ] Audit log wired and producing entries",
  );

  return lines.join("\n");
}

// ─────────────────────────── handoff formatters ───────────────────────────

function buildPromptHandoff(goal: string, sections: BuildBriefOutput["sections"]): string {
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
    `Work through §8 Definition of Done before shipping. When done, call ` +
    `\`record_session_feedback\` with the completed route and ratings.`
  );
}

function buildLinearHandoff(goal: string, sections: BuildBriefOutput["sections"]): string {
  return (
    `## Build brief\n\n` +
    `**Goal:** ${goal}\n\n` +
    `${sections.s1_summary}\n\n` +
    `${sections.s2_route}\n\n` +
    `${sections.s5_safety}\n\n` +
    `${sections.s8_definition_of_done}\n\n` +
    `---\n_Generated by OrchestrateMCP export_build_brief (MAR-205). ` +
    `Registry-grounded; no LLM-generated content._`
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
}): BuildBriefOutput {
  const routeComponents = input.recommended_route.map((s) => s.component_id);

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
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n---\n\n");

  const brief_markdown =
    `# Build Brief — ${input.goal.slice(0, 80)}${input.goal.length > 80 ? "…" : ""}\n\n` +
    `> **Provenance:** All component IDs, edge relations, safety findings, and clearance ` +
    `levels are 🟢 **registry-grounded** (deterministic, no LLM calls). ` +
    `Agent elaborations are 🔵 **suggested** — do not present them as registry facts.\n\n` +
    sectionList;

  const handoffs: BuildBriefOutput["handoffs"] = {};
  if (input.handoff_targets.includes("prompt")) {
    handoffs.prompt = buildPromptHandoff(input.goal, sections);
  }
  if (input.handoff_targets.includes("linear")) {
    handoffs.linear = buildLinearHandoff(input.goal, sections);
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
        "a self-contained handoff document (§0 Constraints → §8 Definition of Done) " +
        "ready to paste into an IDE agent prompt, a Linear issue, or an Obsidian note. " +
        "Stateless: stores nothing, makes no network calls. " +
        "Call after plan_workflow to get the agent-ready build spec.",
      inputSchema: InputShape,
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
        });

        logger.debug(
          `export_build_brief → ${result.sections ? "ok" : "error"} ` +
          `sections=${Object.keys(result.sections).length}`,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        logger.error("export_build_brief failed", err);
        return toErrorResult(err);
      }
    },
  );
}
