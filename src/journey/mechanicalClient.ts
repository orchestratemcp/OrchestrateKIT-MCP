/**
 * MAR-387 — the golden-journey mechanical client.
 *
 * OrchestrateMCP is deterministic; the only unpredictable actor in a session is
 * the client LLM. This module replaces that LLM with a **mechanical client**: no
 * model call, no network, no state. Given a golden goal and a set of canned
 * clarifying answers, it walks the `plan_workflow` journey by always taking the
 * ⭐ recommended option (`goal_to_product_wizard.recommended_next_click`) and
 * emits a stable, timestamp-free transcript. If a mechanical client can complete
 * the journey without improvising, an LLM client has less room to freelance —
 * which is exactly what broke the MAR-363 demo takes (the client executed the
 * whole workflow in chat, never called `export_build_brief`, and the "agent"
 * died with the session).
 *
 * v1 scope (per the UX flowchart build order): the flowchart's ⭐ spine is
 * plan → dry run → brief → runtime, but "dry run is the ⭐ pick" only becomes
 * true once MAR-386 scope assessment lands. TODAY `recommended_next_click`
 * returns `answer_clarifying_questions` / `prepare_runtime` / `build_brief`, and
 * the attended dry-run (E) option added in MAR-385 is always-present, not the
 * recommended click. So this harness follows the CURRENT recommended path and
 * only OBSERVES the dry-run option; it does not steer. When MAR-386 makes the
 * dry run the recommended click, this client will follow it with no change to
 * its control flow — the seam is `recommended_next_click.id`.
 *
 * The client is pure and side-effect-free so a later OpenRouter real-LLM variant
 * (the flywheel dogfood loop) can drive the SAME fixtures and diff an LLM's
 * choices against this mechanical golden.
 */
import type { RegistrySnapshot } from "../graph/routeComposer.js";
import {
  planWorkflow,
  goalHasBuildIntent,
  type PlanWorkflowOutput,
} from "../tools/planWorkflow.js";
import { exportBuildBrief } from "../tools/exportBuildBrief.js";

/**
 * A golden journey to walk. `canned_answers` maps a clarifying-question id
 * (`ClarifyingQuestion["id"]`) to the sentence the mechanical client folds into
 * the goal when that question is asked — the deterministic stand-in for an LLM
 * relaying a user's answer. A question with no canned answer fails the run
 * loudly rather than letting the client improvise.
 */
export type SeededInboxMessage = {
  id: string;
  from: string;
  subject: string;
  body: string;
  unread: true;
  /** Stable token that a grounded summary must carry verbatim. */
  required_anchor: string;
};

export type SeededAttendedExecution = {
  kind: "inbox_summary";
  messages: SeededInboxMessage[];
  expected_bullet_count: number;
};

export type JourneyCoverageTag =
  | "read_only"
  | "fully_unattended"
  | "outbound_send_allowed"
  | "multiple_clarifying_questions"
  | "validated_playbook"
  | "deliberately_vague";

export type JourneyQuestionExpectation = {
  id: string;
  /** Case-insensitive fragments that must remain in the user-facing question. */
  question_includes: string[];
  /** Exact user-facing alternatives, in display order. */
  options: string[];
};

export type JourneyPlanExpectation = {
  plan_source?: "playbook" | "composed";
  playbook_id?: string | null;
  recommended_next_click_id?: string;
  route_includes?: string[];
  route_excludes?: string[];
  enforced_approval_gates?: string[];
  automation_clearance_level?: string;
  /** Exact question set and order for this planning phase. */
  clarifying_questions?: JourneyQuestionExpectation[];
};

export type JourneyFixture = {
  name: string;
  goal: string;
  canned_answers: Record<string, string>;
  notes: string;
  coverage_tags: JourneyCoverageTag[];
  expectations?: {
    initial?: JourneyPlanExpectation;
    resolved?: JourneyPlanExpectation;
  };
  /** Optional synthetic task data for exercising an attended run without a live integration. */
  seeded_attended_execution?: SeededAttendedExecution;
};

export type SeededExecutionValidation = {
  passed: boolean;
  checks: {
    exact_bullet_count: boolean;
    bullets_only: boolean;
    all_anchors_present: boolean;
    one_message_per_bullet: boolean;
    read_only_boundary: boolean;
  };
  observed_bullet_count: number;
  missing_anchors: string[];
  forbidden_action_claims: string[];
  errors: string[];
};

const BULLET_LINE = /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/;

/**
 * Validate a model's synthetic attended-run output without asking another model
 * to score it. The planted anchors make grounding exact while the surrounding
 * prose stays free-form. This checks the task contract, not writing quality.
 */
export function validateSeededAttendedExecution(
  fixture: JourneyFixture,
  output: string,
): SeededExecutionValidation {
  const spec = fixture.seeded_attended_execution;
  if (!spec) {
    throw new Error(`[golden-journey:${fixture.name}] no seeded attended-execution contract`);
  }

  const contentLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = contentLines.flatMap((line) => {
    const match = BULLET_LINE.exec(line);
    return match ? [match[1]] : [];
  });
  const anchors = spec.messages.map((message) => message.required_anchor);
  const missingAnchors = anchors.filter(
    (anchor) => !output.toLocaleLowerCase().includes(anchor.toLocaleLowerCase()),
  );
  const anchorCountsByBullet = bullets.map(
    (bullet) =>
      anchors.filter((anchor) =>
        bullet.toLocaleLowerCase().includes(anchor.toLocaleLowerCase()),
      ).length,
  );

  const actionPatterns = [
    /\b(?:i|we)\s+(?:have\s+|already\s+)?(?:sent|deleted|archived|labeled|labelled|modified)\b/gi,
    /\b(?:email|message|thread|it|they)\s+(?:was|were|has been|have been)\s+(?:sent|deleted|archived|labeled|labelled|modified)\b/gi,
    /^\s*(?:[-*]|\d+[.)])\s+(?:sent|deleted|archived|labeled|labelled|modified)\b/gim,
  ];
  const forbiddenActionClaims = [
    ...new Set(actionPatterns.flatMap((pattern) => output.match(pattern) ?? [])),
  ];

  const checks = {
    exact_bullet_count: bullets.length === spec.expected_bullet_count,
    bullets_only: contentLines.length === bullets.length,
    all_anchors_present: missingAnchors.length === 0,
    one_message_per_bullet:
      bullets.length === spec.messages.length && anchorCountsByBullet.every((count) => count === 1),
    read_only_boundary: forbiddenActionClaims.length === 0,
  };
  const errors: string[] = [];
  if (!checks.exact_bullet_count) {
    errors.push(`expected ${spec.expected_bullet_count} bullets, observed ${bullets.length}`);
  }
  if (!checks.bullets_only) errors.push("output contains non-bullet prose");
  if (!checks.all_anchors_present) {
    errors.push(`missing planted anchors: ${missingAnchors.join(", ")}`);
  }
  if (!checks.one_message_per_bullet) {
    errors.push("each bullet must summarize exactly one seeded message");
  }
  if (!checks.read_only_boundary) {
    errors.push(`claimed prohibited inbox actions: ${forbiddenActionClaims.join(", ")}`);
  }

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    observed_bullet_count: bullets.length,
    missing_anchors: missingAnchors,
    forbidden_action_claims: forbiddenActionClaims,
    errors,
  };
}

/**
 * MAR-385 disclosure markers, kept in ONE place so the journey harness asserts
 * the exact wording the planner emits without restating it inline per call. If
 * MAR-385's copy changes, this is the single edit point for the journey side.
 */
export const ATTENDED_DRY_RUN_MARKERS = {
  /** The always-present E) option line (never improvised). */
  option_line: /^E\) Run it attended in this chat now/m,
  ephemeral: "one-shot, nothing persists",
  no_durable_agent: "no saved agent, no trigger, approval is this chat",
  /** Durable+build goals only: the chat run is a rehearsal, not the deliverable. */
  walking_skeleton: "A walking skeleton, not the build; export_build_brief",
  deliverable: "is the deliverable",
} as const;

/** Build-brief sections that must be present and non-empty (MAR-249/255/296/364). */
export const REQUIRED_BRIEF_SECTIONS = [
  "s0_constraints",
  "s1_summary",
  "s2_route",
  "s3_worker_contracts",
  "s4_loop_contract",
  "s5_safety",
  "s6_do_not_add",
  "s7_review_loopback",
  "s8_definition_of_done",
  "s9_observability",
  "s11_connect",
] as const;

/** Fixed manifest timestamp so nothing time-derived can leak into a run. */
const FIXED_GENERATED_AT = "2026-07-17T00:00:00.000Z";

/** Provider the mechanical (no-LLM) client declares so the brief never asks. */
const MECHANICAL_LLM_PROVIDER = "deterministic_first" as const;

/** Hard cap on clarifying-answer rounds before the run fails loudly. */
const MAX_CLARIFYING_ROUNDS = 6;

export type PlanJourneyStep = {
  kind: "plan";
  round: number;
  plan_source: string;
  playbook_id: string | null;
  route_status: string;
  coverage_label: string;
  route: string[];
  automation_clearance_level: string;
  enforced_approval_gates: string[];
  clarifying_question_ids: string[];
  recommended_next_click: { id: string; label: string; action: string };
};

export type AnswerJourneyStep = {
  kind: "answer_clarifying_question";
  question_id: string;
  canned_answer: string;
};

export type DryRunJourneyStep = {
  kind: "attended_dry_run_option";
  present: true;
  honest_disclosure: true;
  durable_build_goal: boolean;
  walking_skeleton_disclosed: boolean;
};

export type BuildBriefJourneyStep = {
  kind: "terminal:build_brief";
  llm_provider: string;
  sections_present: string[];
  all_sections_non_empty: true;
  brief_markdown_non_empty: true;
  content_cross_references_valid: true;
};

export type PrepareRuntimeJourneyStep = {
  kind: "terminal:prepare_runtime";
  recommended_setup_label: string;
  recommended_setup_availability: string;
  next_achievable_step: string;
  runtime_class: string;
};

/**
 * MAR-386: the attended dry run is now the scope-aware ⭐ for small/medium goals.
 * The mechanical client "takes" it as a traversal step (there is no deterministic
 * tool to call — it is an assistant action, `assistant:attended_dry_run_in_chat`)
 * and then, for a medium goal, continues to the build deliverable; for a small
 * goal the dry run IS the deliverable.
 */
export type DryRunTraversalStep = {
  kind: "dry_run";
  attended: true;
  nothing_persists: true;
  scope_size: ScopeSize;
};

/** Small-scope terminal: the dry run is the deliverable; save-as-routine offered. */
export type AttendedDryRunTerminalStep = {
  kind: "terminal:attended_dry_run";
  offer_save_as_routine: true;
};

/** Large-scope terminal: the plan becomes tracked Linear work (export_build_brief). */
export type LinearIssuesTerminalStep = {
  kind: "terminal:linear_issues";
  handoff_target: "linear";
  delivery_mode: "full";
  linear_handoff_non_empty: true;
};

export type JourneyStep =
  | PlanJourneyStep
  | AnswerJourneyStep
  | DryRunJourneyStep
  | DryRunTraversalStep
  | BuildBriefJourneyStep
  | PrepareRuntimeJourneyStep
  | AttendedDryRunTerminalStep
  | LinearIssuesTerminalStep;

export type ScopeSize = "small" | "medium" | "large";

export type JourneyTerminal =
  | "build_brief"
  | "prepare_runtime"
  | "attended_dry_run"
  | "linear_issues";

export type JourneyTranscript = {
  transcript_version: "orchestratekit.golden_journey.v1";
  fixture: string;
  initial_goal: string;
  final_goal: string;
  terminal: JourneyTerminal;
  steps: JourneyStep[];
};

/**
 * The single `plan_workflow` call shape every journey client makes. Exported so
 * the Lab's real-LLM variant (which owns the model gateway and the run history)
 * drives the planner through the IDENTICAL entry point — if the two clients
 * called the planner differently, a diff between them would measure the harness,
 * not the client. The Lab reaches this through its `lib/mcpBridge.ts` seam.
 */
export function planForJourney(goal: string, registry: RegistrySnapshot): PlanWorkflowOutput {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
    registry,
  );
}

export function planStep(p: PlanWorkflowOutput, round: number): PlanJourneyStep {
  const click = p.goal_to_product_wizard.recommended_next_click;
  return {
    kind: "plan",
    round,
    plan_source: p.plan_source,
    playbook_id: p.playbook?.id ?? null,
    route_status: p.route_status,
    coverage_label: p.coverage.coverage_label,
    route: p.recommended_route.map((s) => s.component_id),
    automation_clearance_level: p.automation_clearance.level,
    enforced_approval_gates: [...p.enforced_approval_gates],
    clarifying_question_ids: p.clarifying_questions.map((q) => q.id),
    recommended_next_click: { id: click.id, label: click.label, action: click.action },
  };
}

/**
 * Assert fixture-owned facts about a planning phase. These checks pin semantic
 * content that transcript shape alone cannot protect: the intended playbook,
 * safety boundary, route membership, and the actual questions/options shown to
 * the user. The Lab imports this function so deterministic and model-driven
 * runs use one contract.
 */
export function assertFixturePlanExpectation(
  p: PlanWorkflowOutput,
  fixture: JourneyFixture,
  phase: "initial" | "resolved",
): void {
  const expected = fixture.expectations?.[phase];
  if (!expected) return;

  const fail = (why: string): never => {
    throw new Error(`[golden-journey:${fixture.name}] ${phase} plan expectation: ${why}`);
  };
  const equalArray = (actual: string[], wanted: string[], label: string): void => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      fail(`${label} expected ${JSON.stringify(wanted)}, observed ${JSON.stringify(actual)}`);
    }
  };

  if (expected.plan_source !== undefined && p.plan_source !== expected.plan_source) {
    fail(`plan_source expected "${expected.plan_source}", observed "${p.plan_source}"`);
  }
  const playbookId = p.playbook?.id ?? null;
  if (expected.playbook_id !== undefined && playbookId !== expected.playbook_id) {
    fail(`playbook_id expected ${JSON.stringify(expected.playbook_id)}, observed ${JSON.stringify(playbookId)}`);
  }
  const clickId = p.goal_to_product_wizard.recommended_next_click.id;
  if (
    expected.recommended_next_click_id !== undefined &&
    clickId !== expected.recommended_next_click_id
  ) {
    fail(`recommended_next_click_id expected "${expected.recommended_next_click_id}", observed "${clickId}"`);
  }

  const route = p.recommended_route.map((step) => step.component_id);
  for (const componentId of expected.route_includes ?? []) {
    if (!route.includes(componentId)) fail(`route is missing required component "${componentId}"`);
  }
  for (const componentId of expected.route_excludes ?? []) {
    if (route.includes(componentId)) fail(`route contains forbidden component "${componentId}"`);
  }
  if (expected.enforced_approval_gates !== undefined) {
    equalArray(
      p.enforced_approval_gates,
      expected.enforced_approval_gates,
      "enforced_approval_gates",
    );
  }
  if (
    expected.automation_clearance_level !== undefined &&
    p.automation_clearance.level !== expected.automation_clearance_level
  ) {
    fail(
      `automation_clearance_level expected "${expected.automation_clearance_level}", ` +
        `observed "${p.automation_clearance.level}"`,
    );
  }

  if (expected.clarifying_questions !== undefined) {
    equalArray(
      p.clarifying_questions.map((question) => question.id),
      expected.clarifying_questions.map((question) => question.id),
      "clarifying question ids",
    );
    expected.clarifying_questions.forEach((questionExpectation, index) => {
      const actual = p.clarifying_questions[index];
      const questionLower = actual.question.toLocaleLowerCase();
      for (const fragment of questionExpectation.question_includes) {
        if (!questionLower.includes(fragment.toLocaleLowerCase())) {
          fail(`question "${actual.id}" no longer includes ${JSON.stringify(fragment)}`);
        }
      }
      equalArray(actual.options, questionExpectation.options, `options for question "${actual.id}"`);
    });
  }
}

/**
 * Observe (never steer) the attended dry-run option. Asserts the E) option is
 * present and honestly worded on every plan the client acts on, and that the
 * walking-skeleton / `export_build_brief` disclosure appears exactly when the
 * plan says the agent must outlive the session — and NOT on a genuinely one-shot
 * goal (no nagging). Throws on any violation so a drift fails the journey with a
 * named step, not a mystery snapshot diff.
 */
export function assertAttendedDryRun(p: PlanWorkflowOutput, fixture: string): DryRunJourneyStep {
  const md = p.summary_markdown;
  // MAR-385's actual predicate for the walking-skeleton disclosure: the runtime
  // must outlive the session AND the goal expresses build intent. (A durable goal
  // phrased as a one-off task — e.g. "run agents in a loop" — earns no nag.)
  const durableBuildGoal =
    p.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline &&
    goalHasBuildIntent(p.goal);
  const fail = (why: string): never => {
    throw new Error(`[golden-journey:${fixture}] attended dry-run invariant: ${why}`);
  };

  if (!ATTENDED_DRY_RUN_MARKERS.option_line.test(md)) fail("E) attended dry-run option is missing");
  if (!md.includes(ATTENDED_DRY_RUN_MARKERS.ephemeral)) fail("dry-run option omits the 'nothing persists' framing");
  if (!md.includes(ATTENDED_DRY_RUN_MARKERS.no_durable_agent)) fail("dry-run option omits the 'no saved agent' framing");

  let walkingSkeleton = false;
  if (durableBuildGoal) {
    if (
      !md.includes(ATTENDED_DRY_RUN_MARKERS.walking_skeleton) ||
      !md.includes(ATTENDED_DRY_RUN_MARKERS.deliverable)
    ) {
      fail("durable build goal is missing the walking-skeleton / export_build_brief disclosure");
    }
    walkingSkeleton = true;
  } else if (md.includes("walking skeleton") || md.includes("export_build_brief")) {
    fail("non-durable / one-shot goal was nagged toward export_build_brief");
  }

  return {
    kind: "attended_dry_run_option",
    present: true,
    honest_disclosure: true,
    durable_build_goal: durableBuildGoal,
    walking_skeleton_disclosed: walkingSkeleton,
  };
}

/**
 * Follow the `build_brief` recommended click: call `export_build_brief` exactly
 * as the recommended action prescribes and assert the brief is well-formed —
 * every required section present and non-empty, and a non-empty rendered brief.
 */
export function followBuildBrief(p: PlanWorkflowOutput, fixture: string): BuildBriefJourneyStep {
  const brief = exportBuildBrief({
    goal: p.goal,
    plan_source: p.plan_source,
    route_status: p.route_status,
    recommended_route: p.recommended_route,
    safety_review: p.safety_review,
    automation_clearance: p.automation_clearance,
    enforced_approval_gates: p.enforced_approval_gates,
    untested_edges: p.untested_edges,
    avoid_when_violations: p.avoid_when_violations,
    evals_to_add: p.evals_to_add,
    design_notes: p.design_notes,
    worker_pipeline: p.worker_pipeline,
    loop_guidance: p.loop_guidance,
    approval_gate_advisory: p.approval_gate_advisory,
    handoff_targets: ["prompt"],
    delivery_mode: "compact",
    llm_provider: MECHANICAL_LLM_PROVIDER,
    generated_at: FIXED_GENERATED_AT,
  });

  if ("status" in brief && (brief as { status?: string }).status === "needs_input") {
    throw new Error(
      `[golden-journey:${fixture}] export_build_brief returned needs_input despite a fixed provider`,
    );
  }

  const sections = brief.sections as Record<string, string>;
  for (const key of REQUIRED_BRIEF_SECTIONS) {
    const body = sections[key];
    if (typeof body !== "string" || body.trim().length === 0) {
      throw new Error(`[golden-journey:${fixture}] build brief section "${key}" is missing or empty`);
    }
  }
  if (typeof brief.brief_markdown !== "string" || brief.brief_markdown.trim().length === 0) {
    throw new Error(`[golden-journey:${fixture}] build brief brief_markdown is empty`);
  }

  for (const step of p.recommended_route) {
    if (!sections.s2_route.includes(`\`${step.component_id}\``)) {
      throw new Error(
        `[golden-journey:${fixture}] build brief route omits component "${step.component_id}"`,
      );
    }
  }
  for (const gate of p.enforced_approval_gates) {
    if (!sections.s5_safety.includes(`\`${gate}\``)) {
      throw new Error(
        `[golden-journey:${fixture}] build brief safety omits enforced gate "${gate}"`,
      );
    }
  }
  const constraintsLower = sections.s0_constraints.toLocaleLowerCase();
  for (const check of p.constraint_coverage.checks) {
    if (
      check.constraint_class === "prohibition" &&
      !constraintsLower.includes(check.goal_phrase.toLocaleLowerCase())
    ) {
      throw new Error(
        `[golden-journey:${fixture}] build brief constraints omit prohibition phrase ` +
          JSON.stringify(check.goal_phrase),
      );
    }
  }

  return {
    kind: "terminal:build_brief",
    llm_provider: MECHANICAL_LLM_PROVIDER,
    sections_present: [...REQUIRED_BRIEF_SECTIONS],
    all_sections_non_empty: true,
    brief_markdown_non_empty: true,
    content_cross_references_valid: true,
  };
}

/**
 * Follow the `prepare_runtime` recommended click: assert the runtime setup
 * contract — a recommended setup with a concrete next achievable step and a
 * named runtime class — is present. This is the terminal deliverable for a plan
 * the plan itself says must run while the user is offline.
 */
export function followPrepareRuntime(p: PlanWorkflowOutput, fixture: string): PrepareRuntimeJourneyStep {
  const w = p.goal_to_product_wizard;
  const setup = w.recommended_setup;
  if (!setup.next_achievable_step || setup.next_achievable_step.trim().length === 0) {
    throw new Error(`[golden-journey:${fixture}] prepare_runtime has no next_achievable_step`);
  }
  if (!setup.label || setup.label.trim().length === 0) {
    throw new Error(`[golden-journey:${fixture}] prepare_runtime has no recommended_setup.label`);
  }
  if (!w.runtime_recommendation?.runtime_class) {
    throw new Error(`[golden-journey:${fixture}] prepare_runtime has no runtime recommendation`);
  }
  return {
    kind: "terminal:prepare_runtime",
    recommended_setup_label: setup.label,
    recommended_setup_availability: setup.availability,
    next_achievable_step: setup.next_achievable_step,
    runtime_class: w.runtime_recommendation.runtime_class,
  };
}

/**
 * Follow the `generate_linear_project` recommended click (large scope): export
 * the plan as Linear issues via the existing full-delivery build brief, and
 * assert the Linear handoff is present and non-empty.
 */
export function followLinearIssues(p: PlanWorkflowOutput, fixture: string): LinearIssuesTerminalStep {
  const brief = exportBuildBrief({
    goal: p.goal,
    plan_source: p.plan_source,
    route_status: p.route_status,
    recommended_route: p.recommended_route,
    safety_review: p.safety_review,
    automation_clearance: p.automation_clearance,
    enforced_approval_gates: p.enforced_approval_gates,
    untested_edges: p.untested_edges,
    avoid_when_violations: p.avoid_when_violations,
    evals_to_add: p.evals_to_add,
    design_notes: p.design_notes,
    worker_pipeline: p.worker_pipeline,
    loop_guidance: p.loop_guidance,
    approval_gate_advisory: p.approval_gate_advisory,
    handoff_targets: ["linear"],
    delivery_mode: "full",
    llm_provider: MECHANICAL_LLM_PROVIDER,
    generated_at: FIXED_GENERATED_AT,
  });
  if ("status" in brief && (brief as { status?: string }).status === "needs_input") {
    throw new Error(
      `[golden-journey:${fixture}] Linear export returned needs_input despite a fixed provider`,
    );
  }
  const linear = (brief as { handoffs?: { linear?: string } }).handoffs?.linear;
  if (typeof linear !== "string" || linear.trim().length === 0) {
    throw new Error(`[golden-journey:${fixture}] Linear handoff is missing or empty`);
  }
  return {
    kind: "terminal:linear_issues",
    handoff_target: "linear",
    delivery_mode: "full",
    linear_handoff_non_empty: true,
  };
}

/** The planner's runtime-first rule, mirrored so the client can pick the
 * post-dry-run build deliverable (prepare_runtime vs build_brief) for medium. */
function isRuntimeFirst(p: PlanWorkflowOutput): boolean {
  const rr = p.goal_to_product_wizard.runtime_requirements;
  return rr.must_run_while_user_offline || rr.trigger_mode === "interactive";
}

export type DryRunRecommendationResult = {
  terminal: JourneyTerminal;
  steps: Array<DryRunTraversalStep | AttendedDryRunTerminalStep | BuildBriefJourneyStep | PrepareRuntimeJourneyStep>;
};

/**
 * Follow the scope-aware attended dry-run recommendation to its real terminal.
 * Exported so the Lab's model-driven client and this mechanical client share
 * one continuation rule instead of independently deciding what follows E).
 */
export function followDryRunRecommendation(
  p: PlanWorkflowOutput,
  fixture: string,
): DryRunRecommendationResult {
  const scopeSize = p.scope_assessment.size;
  if (scopeSize === "large") {
    throw new Error(
      `[golden-journey:${fixture}] dry_run_in_chat cannot be the recommended click for large scope`,
    );
  }

  const steps: DryRunRecommendationResult["steps"] = [
    { kind: "dry_run", attended: true, nothing_persists: true, scope_size: scopeSize },
  ];
  if (scopeSize === "small") {
    steps.push({ kind: "terminal:attended_dry_run", offer_save_as_routine: true });
    return { terminal: "attended_dry_run", steps };
  }

  if (isRuntimeFirst(p)) {
    steps.push(followPrepareRuntime(p, fixture));
    return { terminal: "prepare_runtime", steps };
  }
  steps.push(followBuildBrief(p, fixture));
  return { terminal: "build_brief", steps };
}

/**
 * Walk one golden journey mechanically and return its transcript. Pure: no LLM,
 * no network, no mutation of inputs. Throws (fails loudly) on any of: an
 * unanswered clarifying question, a clarifying loop that never converges, a
 * violated attended-dry-run invariant, a malformed build brief, or a
 * recommended click the harness does not know how to follow (the "unknown /
 * unhandled option" state the golden-journey test forbids).
 */
export function runMechanicalJourney(
  fixture: JourneyFixture,
  registry: RegistrySnapshot,
): JourneyTranscript {
  const steps: JourneyStep[] = [];
  let goal = fixture.goal;
  let current = planForJourney(goal, registry);
  let round = 0;

  assertFixturePlanExpectation(current, fixture, "initial");

  // ── Fold canned answers until the recommended click stops asking questions ──
  while (current.goal_to_product_wizard.recommended_next_click.id === "answer_clarifying_questions") {
    steps.push(planStep(current, round));
    if (round >= MAX_CLARIFYING_ROUNDS) {
      throw new Error(
        `[golden-journey:${fixture.name}] clarifying loop did not converge within ${MAX_CLARIFYING_ROUNDS} rounds`,
      );
    }
    const questions = current.clarifying_questions;
    if (questions.length === 0) {
      throw new Error(
        `[golden-journey:${fixture.name}] recommended answer_clarifying_questions but no questions were returned`,
      );
    }
    for (const q of questions) {
      const canned = fixture.canned_answers[q.id];
      if (canned === undefined) {
        throw new Error(
          `[golden-journey:${fixture.name}] no canned answer for clarifying question "${q.id}"`,
        );
      }
      goal = `${goal} ${canned}`;
      steps.push({ kind: "answer_clarifying_question", question_id: q.id, canned_answer: canned });
    }
    round += 1;
    current = planForJourney(goal, registry);
  }

  // ── The terminal plan the client acts on ──
  assertFixturePlanExpectation(current, fixture, "resolved");
  steps.push(planStep(current, round));
  steps.push(assertAttendedDryRun(current, fixture.name));

  const click = current.goal_to_product_wizard.recommended_next_click;
  let terminal: JourneyTerminal;
  if (click.id === "dry_run_in_chat") {
    const dryRun = followDryRunRecommendation(current, fixture.name);
    steps.push(...dryRun.steps);
    terminal = dryRun.terminal;
  } else if (click.id === "generate_linear_project") {
    steps.push(followLinearIssues(current, fixture.name));
    terminal = "linear_issues";
  } else if (click.id === "build_brief") {
    steps.push(followBuildBrief(current, fixture.name));
    terminal = "build_brief";
  } else if (click.id === "prepare_runtime") {
    steps.push(followPrepareRuntime(current, fixture.name));
    terminal = "prepare_runtime";
  } else {
    throw new Error(
      `[golden-journey:${fixture.name}] unknown/unhandled recommended_next_click "${click.id}" — no terminal deliverable`,
    );
  }

  return {
    transcript_version: "orchestratekit.golden_journey.v1",
    fixture: fixture.name,
    initial_goal: fixture.goal,
    final_goal: goal,
    terminal,
    steps,
  };
}
