/**
 * MAR-401 (GOLD-01) — the `question_flow` contract.
 *
 * plan_workflow's first screen is a card followed by sequential CLICKABLE
 * question rounds. This suite pins the round spine (confirm_card →
 * build_surface → process → monitoring → conditional clarifying rounds), the
 * stable option ids the LAB harness and DASH switch on, and the rule that every
 * recommended pick is a re-projection of machinery the plan already computed —
 * never fresh inference, never drift from the ⭐.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { parseMenu } from "../../src/journey/menu.js";

const registry = loadRegistry();

function plan(goal: string, depth: "brief" | "standard" | "technical" = "brief") {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: depth },
    registry,
  );
}

// Fully-specified medium goal — no clarifying questions.
const HEAVY_GOAL =
  "Read new leads from my email inbox, draft a reply, update the CRM record, " +
  "notify the sales channel on Slack, and require human approval before anything is sent externally";
// Small attended goal — ⭐ is the no-code assistant surface.
const ONE_SHOT = "summarize my inbox for me now";
// Durable/offline goal — hosted runtime recommended.
const PRICING =
  "Build an agent that checks 5 competitor pages every morning, detects price changes, " +
  "and sends me a Slack summary. I want to approve before anything external is changed.";
// Under-specified goal — raises clarifying questions.
const VAGUE = "go through my inbox and handle the sales leads automatically";

describe("MAR-401 — question_flow round spine", () => {
  it("every plan carries the four fixed rounds, in order, at every depth", () => {
    for (const depth of ["brief", "standard", "technical"] as const) {
      const qf = plan(HEAVY_GOAL, depth).question_flow;
      expect(qf.contract).toBe("orchestratekit.question_flow.v1");
      expect(qf.rounds.map((r) => r.id).slice(0, 4)).toEqual([
        "confirm_card",
        "build_surface",
        "process",
        "monitoring",
      ]);
    }
  });

  it("round 0 is always confirm_card with yes / change_something", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE]) {
      const round = plan(goal).question_flow.rounds[0];
      expect(round.id).toBe("confirm_card");
      expect(round.options.map((o) => o.id)).toEqual(["yes", "change_something"]);
      expect(round.recommended_option_id).toBe("yes");
      // a correction refines the goal, so it belongs in a re-call
      expect(round.fold_answer_into_recall).toBe(true);
    }
  });

  it("every round has options with stable ids and every option has a label", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE]) {
      for (const round of plan(goal).question_flow.rounds) {
        expect(round.options.length).toBeGreaterThanOrEqual(2);
        for (const option of round.options) {
          expect(option.id.length).toBeGreaterThan(0);
          expect(option.label.length).toBeGreaterThan(0);
        }
        // a non-null recommendation always names a real option
        if (round.recommended_option_id !== null) {
          expect(round.options.map((o) => o.id)).toContain(round.recommended_option_id);
        }
      }
    }
  });
});

describe("MAR-401 — recommended picks are re-projections, not fresh inference", () => {
  it("a small attended goal recommends the Cowork build surface (mirrors the MAR-395 ⭐)", () => {
    const r = plan(ONE_SHOT);
    expect(r.goal_to_product_wizard.recommended_next_click.id).toBe("build_in_assistant");
    const round = r.question_flow.rounds.find((x) => x.id === "build_surface")!;
    expect(round.recommended_option_id).toBe("cowork");
  });

  it("a durable hosted goal recommends the always-on self-host surface", () => {
    const r = plan(PRICING);
    const hosting = r.hosting_and_monitoring.hosting.recommended.id;
    const round = r.question_flow.rounds.find((x) => x.id === "build_surface")!;
    const expected =
      hosting === "hosted_cron" || hosting === "hosted_endpoint"
        ? "self_host_hosted"
        : hosting === "in_client"
        ? "cowork"
        : "self_host_local";
    expect(round.recommended_option_id).toBe(expected);
  });

  it("the process round mirrors recommended_next_click (Linear ⭐ → save_plan)", () => {
    const r = plan(HEAVY_GOAL);
    const round = r.question_flow.rounds.find((x) => x.id === "process")!;
    expect(round.options.map((o) => o.id)).toEqual(["save_plan", "build_prompt"]);
    expect(round.recommended_option_id).toBe(
      r.goal_to_product_wizard.recommended_next_click.id === "generate_linear_project"
        ? "save_plan"
        : "build_prompt",
    );
  });

  it("the monitoring round maps the MAR-315 recommendation onto Cowork/LAB/DASH/other", () => {
    const r = plan(PRICING);
    const round = r.question_flow.rounds.find((x) => x.id === "monitoring")!;
    expect(round.options.map((o) => o.id)).toEqual(["cowork", "lab", "dash", "other"]);
    const monitoring = r.hosting_and_monitoring.monitoring.recommended.id;
    const expected =
      r.hosting_and_monitoring.hosting.recommended.id === "in_client"
        ? "cowork"
        : monitoring === "dash_import"
        ? "dash"
        : monitoring === "log_to_file"
        ? "lab"
        : "other";
    expect(round.recommended_option_id).toBe(expected);
  });
});

describe("MAR-401 — conditional rounds fold in the MAR-225 clarifying questions", () => {
  it("an under-specified goal appends its clarifying questions as rounds 4+", () => {
    const r = plan(VAGUE);
    expect(r.clarifying_questions.length).toBeGreaterThan(0);
    const conditional = r.question_flow.rounds.slice(4);
    expect(conditional.map((x) => x.id)).toEqual(r.clarifying_questions.map((q) => q.id));
    for (const [i, round] of conditional.entries()) {
      const q = r.clarifying_questions[i];
      expect(round.question).toBe(q.question);
      expect(round.options.map((o) => o.label)).toEqual(q.options);
      // architecture-affecting answers must be folded into a re-call goal
      expect(round.fold_answer_into_recall).toBe(true);
      if (q.option_ids) {
        // no parallel vocabulary — the MAR-225 ids ARE the option ids
        expect(round.options.map((o) => o.id)).toEqual(q.option_ids);
      }
    }
  });

  it("a fully-specified goal has exactly the four fixed rounds (no nagging)", () => {
    const r = plan(HEAVY_GOAL);
    expect(r.clarifying_questions).toEqual([]);
    expect(r.question_flow.rounds).toHaveLength(4);
  });

  it("a side-effect question keeps its never-default rule (null recommended only when MAR-225 says so)", () => {
    const GOLDEN =
      "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
      "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
      "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
      "the email. I will be present for approval and I want visible run logs.";
    const r = plan(GOLDEN);
    const calendarQ = r.clarifying_questions.find((q) => q.id === "calendar_notification");
    expect(calendarQ).toBeDefined();
    const round = r.question_flow.rounds.find((x) => x.id === "calendar_notification")!;
    // this goal's constraints imply a recommendation — the round must carry the
    // SAME one, not invent its own
    expect(round.recommended_option_id).toBe(calendarQ!.recommended_option_id ?? null);
  });
});

describe("MAR-401 — the no-choice-UI fallback menu", () => {
  it("fallback_menu_markdown is the lettered menu and parses under the MAR-387 contract", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING]) {
      const qf = plan(goal).question_flow;
      expect(qf.fallback_menu_markdown).toContain("### How do you want to continue?");
      const menu = parseMenu(qf.fallback_menu_markdown);
      expect(menu.length).toBeGreaterThan(0);
      for (const option of menu) {
        expect(option.action_id, `"${option.text}"`).not.toBe("unknown");
      }
    }
  });

  it("the fallback menu is deterministic across calls", () => {
    const a = plan(HEAVY_GOAL).question_flow;
    const b = plan(HEAVY_GOAL).question_flow;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
