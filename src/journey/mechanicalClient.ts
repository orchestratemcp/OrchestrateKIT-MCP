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
export type JourneyFixture = {
  name: string;
  goal: string;
  canned_answers: Record<string, string>;
  notes: string;
};

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
  route_status: string;
  coverage_label: string;
  route: string[];
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

function plan(goal: string, registry: RegistrySnapshot): PlanWorkflowOutput {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
    registry,
  );
}

function planStep(p: PlanWorkflowOutput, round: number): PlanJourneyStep {
  const click = p.goal_to_product_wizard.recommended_next_click;
  return {
    kind: "plan",
    round,
    plan_source: p.plan_source,
    route_status: p.route_status,
    coverage_label: p.coverage.coverage_label,
    route: p.recommended_route.map((s) => s.component_id),
    clarifying_question_ids: p.clarifying_questions.map((q) => q.id),
    recommended_next_click: { id: click.id, label: click.label, action: click.action },
  };
}

/**
 * Observe (never steer) the attended dry-run option. Asserts the E) option is
 * present and honestly worded on every plan the client acts on, and that the
 * walking-skeleton / `export_build_brief` disclosure appears exactly when the
 * plan says the agent must outlive the session — and NOT on a genuinely one-shot
 * goal (no nagging). Throws on any violation so a drift fails the journey with a
 * named step, not a mystery snapshot diff.
 */
function assertAttendedDryRun(p: PlanWorkflowOutput, fixture: string): DryRunJourneyStep {
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
function followBuildBrief(p: PlanWorkflowOutput, fixture: string): BuildBriefJourneyStep {
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

  return {
    kind: "terminal:build_brief",
    llm_provider: MECHANICAL_LLM_PROVIDER,
    sections_present: [...REQUIRED_BRIEF_SECTIONS],
    all_sections_non_empty: true,
    brief_markdown_non_empty: true,
  };
}

/**
 * Follow the `prepare_runtime` recommended click: assert the runtime setup
 * contract — a recommended setup with a concrete next achievable step and a
 * named runtime class — is present. This is the terminal deliverable for a plan
 * the plan itself says must run while the user is offline.
 */
function followPrepareRuntime(p: PlanWorkflowOutput, fixture: string): PrepareRuntimeJourneyStep {
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
function followLinearIssues(p: PlanWorkflowOutput, fixture: string): LinearIssuesTerminalStep {
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
  let current = plan(goal, registry);
  let round = 0;

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
    current = plan(goal, registry);
  }

  // ── The terminal plan the client acts on ──
  steps.push(planStep(current, round));
  steps.push(assertAttendedDryRun(current, fixture.name));

  const click = current.goal_to_product_wizard.recommended_next_click;
  const scopeSize = current.scope_assessment.size;
  let terminal: JourneyTerminal;
  if (click.id === "dry_run_in_chat") {
    // MAR-386: the scope-aware ⭐. Take the attended dry run as a traversal step…
    steps.push({
      kind: "dry_run",
      attended: true,
      nothing_persists: true,
      scope_size: scopeSize,
    });
    if (scopeSize === "small") {
      // …a genuinely small task: the dry run IS the deliverable. Offer save-as-routine.
      steps.push({ kind: "terminal:attended_dry_run", offer_save_as_routine: true });
      terminal = "attended_dry_run";
    } else {
      // …a medium task: after the dry run, the build deliverable follows —
      // prepare_runtime when the plan must outlive the session, else build_brief.
      if (isRuntimeFirst(current)) {
        steps.push(followPrepareRuntime(current, fixture.name));
        terminal = "prepare_runtime";
      } else {
        steps.push(followBuildBrief(current, fixture.name));
        terminal = "build_brief";
      }
    }
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
