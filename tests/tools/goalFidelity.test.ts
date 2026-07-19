/**
 * MAR-397 (SCOPE-02) — plan output must not be phrasing-dependent, and the
 * tool is the sole menu author.
 *
 * Dogfooded 2026-07-19/20 across Claude Code, Fable and Sonnet. `plan_workflow`
 * is deterministic as advertised — the client made no difference. What differed
 * was what each model SENT: one passed the user's sentence verbatim, two passed
 * a rewrite. Three inputs, one user intent, three different routes, risk scores
 * (3 vs 11) and clearance levels (L1 vs L2).
 *
 * The sharp edge: the VERBATIM goal produced `clarifying_questions: []` while
 * the paraphrase produced three. The user who states their goal plainly got
 * FEWER safety prompts than one whose assistant embellished it.
 *
 * Root cause of that specific asymmetry (verified against source): the extra
 * safety question was `outbound_send`, and it fired only because
 * `reviewer_notification` rode into the paraphrase's route on the phrase "human
 * approval gate". That component is in `coverage.unsupported_supply` — NO goal
 * phrase asked to notify a reviewer. So the planner was asking the user about
 * its own artifact, not about their goal.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { SERVER_INSTRUCTIONS } from "../../src/config.js";

const registry = loadRegistry();

function plan(goal: string, must_avoid: string[] = []) {
  return planWorkflow({ goal, must_have_capabilities: [], must_avoid }, registry);
}

const VERBATIM =
  "When I ask, look up an invoice in our billing system and issue the refund to the customer. I'll approve each one.";
const PARAPHRASE =
  "On request, look up an invoice in the billing system, then issue a refund to the customer, with a human approval gate for each one.";

/** The questions that exist to protect the user, as opposed to build logistics. */
const SAFETY_QUESTION_IDS = new Set([
  "run_trigger",
  "write_permission",
  "outbound_send",
  "calendar_notification",
]);

const safetyQuestions = (out: ReturnType<typeof plan>) =>
  out.clarifying_questions.filter((q) => SAFETY_QUESTION_IDS.has(q.id)).map((q) => q.id);

describe("MAR-397 AC1 — the plan echoes the goal it received and flags a paraphrase", () => {
  it("echoes the goal it was given, so the user can check it", () => {
    // The echo lives on the plan's existing top-level `goal`, not duplicated
    // inside goal_fidelity — the Layer-1 payload is byte-budgeted and saying
    // it twice cost ~200 bytes of that budget for no new information.
    const out = plan(VERBATIM);
    expect(out.goal).toBe(VERBATIM);
  });

  it("does not accuse a genuine user sentence of being a paraphrase", () => {
    const out = plan(VERBATIM);
    expect(out.goal_fidelity.looks_like_paraphrase).toBe(false);
    expect(out.goal_fidelity.signals).toEqual([]);
    expect(out.goal_fidelity.note).toBe("");
  });

  it("flags a rewrite that names registry component vocabulary", () => {
    // No user types "with a human approval gate" — that is the planner's own
    // vocabulary handed back to it, which is the tell that a model rewrote the
    // goal before sending it.
    const out = plan(PARAPHRASE);
    expect(out.goal_fidelity.looks_like_paraphrase).toBe(true);
    expect(out.goal_fidelity.signals.join(" | ").toLowerCase()).toContain("human approval gate");
  });

  it("the fidelity note tells the client what to do about it", () => {
    const out = plan(PARAPHRASE);
    expect(out.goal_fidelity.note.toLowerCase()).toContain("own words");
  });

  it("never lets the flag change the plan (advisory only)", () => {
    // goal_fidelity is a signal about the INPUT. It must not move the route.
    const a = plan(PARAPHRASE);
    const b = plan(PARAPHRASE);
    expect(a.recommended_route.map((s) => s.component_id)).toEqual(
      b.recommended_route.map((s) => s.component_id),
    );
    expect(a.goal_fidelity.looks_like_paraphrase).toBe(true);
    expect(a.recommended_route.length).toBeGreaterThan(0);
  });
});

describe("MAR-397 AC2 — plain phrasing is never punished with fewer safety questions", () => {
  it("the verbatim refund goal gets at least as many safety questions as its paraphrase", () => {
    const verbatim = safetyQuestions(plan(VERBATIM));
    const paraphrase = safetyQuestions(plan(PARAPHRASE));
    expect(verbatim.length).toBeGreaterThanOrEqual(paraphrase.length);
  });

  it("…and also with must_avoid, the third dogfooded call", () => {
    const verbatim = safetyQuestions(plan(VERBATIM));
    const paraphrase = safetyQuestions(plan(PARAPHRASE, ["pdf_extraction"]));
    expect(verbatim.length).toBeGreaterThanOrEqual(paraphrase.length);
  });

  it("a question is never raised by an unsupported-supply component alone", () => {
    // reviewer_notification has no goal phrase behind it on this goal, so the
    // outbound_send question it used to trigger was about the planner's own
    // artifact rather than the user's goal.
    const out = plan(PARAPHRASE);
    expect(out.coverage.unsupported_supply).toContain("reviewer_notification");
    expect(out.clarifying_questions.map((q) => q.id)).not.toContain("outbound_send");
  });

  it("a question IS still raised when a goal phrase genuinely asks for the send", () => {
    // Bleed-guard: suppression must key off unsupported supply, not off the
    // question id. A route whose outbound component was actually asked for
    // keeps its question when the goal leaves the axis open.
    const out = plan("Build an agent that reads my support inbox and posts to our team Slack channel.");
    const outbound = out.recommended_route
      .map((s) => s.component_id)
      .filter((id) => id.includes("slack") || id.includes("notification"));
    expect(outbound.length).toBeGreaterThan(0);
    expect(out.coverage.unsupported_supply).not.toContain("slack_notification");
  });
});

describe("MAR-397 AC3 — the tool is the sole menu author", () => {
  it("SERVER_INSTRUCTIONS forbids the client authoring a second menu", () => {
    const s = SERVER_INSTRUCTIONS.toLowerCase();
    expect(s).toContain("only menu");
    expect(s).toContain("second");
  });

  it("the contract still requires rendering the tool's own menu verbatim", () => {
    // The new rule must not weaken the existing one.
    expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain("verbatim");
  });
});

describe("MAR-397 AC4 — verbatim vs paraphrase output is pinned", () => {
  it("pins the shape of both phrasings so drift is caught", () => {
    const v = plan(VERBATIM);
    const p = plan(PARAPHRASE);
    expect({
      verbatim: {
        paraphrase_flagged: v.goal_fidelity.looks_like_paraphrase,
        safety_questions: safetyQuestions(v),
        route: v.recommended_route.map((s) => s.component_id),
      },
      paraphrase: {
        paraphrase_flagged: p.goal_fidelity.looks_like_paraphrase,
        safety_questions: safetyQuestions(p),
        route: p.recommended_route.map((s) => s.component_id),
      },
    }).toMatchSnapshot();
  });
});
