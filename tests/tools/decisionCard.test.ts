/**
 * MAR-398 (SCOPE-03) — Layer 1 is a decision card, not a report.
 *
 * Henrik, 2026-07-19: "Right now I really would love if the output is a
 * structured card + options. Not too much info."
 *
 * Measured before the change, at `brief` depth:
 *   refund goal        2713 chars / 42 lines / 6-option menu (A–F)
 *   email triage       2787 chars / 44 lines / 6-option menu
 *   competitor pricing 3411 chars / 45 lines / 6-option menu
 *
 * …and three defects the issue folds in, all reproduced:
 *   - every route step's structured `purpose` arrives pre-truncated at 80 chars
 *     with a mid-sentence "…", including on paste-ready surfaces;
 *   - `interaction_surface.recommended.appropriate_when` read "Review suggested
 *     times and approve the CALENDAR write" on the refund and email plans;
 *   - Option F ("build it in a no-code assistant") was offered even on
 *     durable/offline goals a Cowork assistant cannot host at all.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string, depth: "brief" | "standard" | "technical" = "brief") {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: depth },
    registry,
  );
}

const REFUND =
  "When I ask, look up an invoice in our billing system and issue the refund to the customer. I'll approve each one.";
const TRIAGE =
  "Every morning, read unread customer support emails, classify them by urgency, and draft replies for my approval — never send anything automatically. A human reviews every draft.";
const PRICING =
  "Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.";

/** Measured on master, at brief depth. The card must beat every one of these. */
const BASELINE_CHARS: Record<string, number> = {
  refund: 2713,
  triage: 2787,
  pricing: 3411,
};
const DOGFOOD: Array<[string, string]> = [
  ["refund", REFUND],
  ["triage", TRIAGE],
  ["pricing", PRICING],
];

describe("MAR-398 AC1 — brief renders a card, measurably shorter on all three dogfood goals", () => {
  for (const [name, goal] of DOGFOOD) {
    it(`${name} is shorter than the pre-card baseline`, () => {
      const md = plan(goal).summary_markdown;
      expect(md.length).toBeLessThan(BASELINE_CHARS[name]);
    });

    it(`${name} drops the report-shaped blocks from Layer 1`, () => {
      const md = plan(goal).summary_markdown;
      expect(md).not.toContain("**How it works**");
      expect(md).not.toContain("**Build controls:**");
      // The full operating bundle (7 bullets, ~900 chars) stays at standard.
      expect(md).not.toContain("**Recommended runtime setup**");
      expect(md).not.toContain("**Control surface:**");
      expect(md).not.toContain("**Interaction surface:**");
    });

    it(`${name} keeps the four golden-card sections (MAR-402)`, () => {
      const out = plan(goal);
      const md = out.summary_markdown;
      expect(md).toContain("**What you'll get:**");
      expect(md).toContain("**Route:**");
      expect(md).toContain("**Risks & safeguards:**");
      expect(md).toContain("**Connections:**");
      expect(md).toContain("**Recommended setup:** ⭐");
      // The lettered menu left the card — it lives on as the no-choice-UI
      // fallback (MAR-402), and the clickable rounds replace it (MAR-401).
      expect(md).not.toContain("### How do you want to continue?");
      expect(out.question_flow.fallback_menu_markdown).toContain(
        "### How do you want to continue?",
      );
    });

    it(`${name} states what is missing, explicitly, either way`, () => {
      const out = plan(goal);
      const md = out.summary_markdown;
      // "or explicitly nothing" — silence is the failure mode this card exists
      // to remove, so the block is never simply absent.
      expect(md).toMatch(/\*\*(What's missing|Not covered by the registry|Gaps):\*\*/);
    });
  }
});

/**
 * The runtime split — MAR-378 vs MAR-398, decided on evidence.
 *
 * MAR-378 put the whole operating bundle in Layer 1; MAR-398 said move it behind
 * `standard`. Rendering it on the dogfood goals showed the right cut is by
 * RUNTIME, not by depth:
 *
 *   - Durable goal → the bundle is the best content in the plan. "Where does it
 *     live when my laptop is shut, and what starts it?" is the decision.
 *   - Attended goal → it CONTRADICTS itself. The refund plan says "stops when
 *     the client/session closes; that is correct for explicitly attended work",
 *     then recommends a control surface to "persist approvals while the user is
 *     offline". "summarize my inbox for me now" is told to "manage schedule,
 *     secrets, status, retries" — there is no schedule.
 *
 * So the card carries runtime + trigger only when the plan must outlive the
 * session. This is the half of MAR-378 that was load-bearing, kept.
 */
describe("MAR-398 — runtime facts appear on the card only when they are a live question", () => {
  it("a durable goal is told where it runs and what wakes it", () => {
    const out = plan(PRICING);
    expect(out.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline).toBe(true);
    // MAR-402: the two runtime facts now live on the one ⭐ Recommended-setup line.
    expect(out.summary_markdown).toContain("**Recommended setup:** ⭐");
    expect(out.summary_markdown).toContain("wakes on:");
    expect(out.summary_markdown).toContain(
      out.goal_to_product_wizard.runtime_recommendation.label,
    );
  });

  it("an attended goal is not told to build durable infrastructure", () => {
    // The refund goal explicitly runs only when asked. Offering it an offline
    // approval inbox is not verbosity, it is a wrong recommendation.
    const out = plan(REFUND);
    expect(out.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline).toBe(false);
    expect(out.summary_markdown).not.toContain("**Runs on:**");
    expect(out.summary_markdown).not.toContain("persist approvals while the user is offline");
  });

  it("a one-shot goal is never told to manage a schedule it does not have", () => {
    const md = plan("summarize my inbox for me now").summary_markdown;
    expect(md).not.toContain("**Runs on:**");
    expect(md.toLowerCase()).not.toContain("manage schedule");
  });

  it("the full bundle is still reachable at standard for every runtime", () => {
    for (const goal of [PRICING, REFUND]) {
      expect(plan(goal, "standard").summary_markdown).toContain("**Recommended runtime setup**");
    }
  });
});

describe("MAR-398 AC2 — demoted content is moved, not deleted", () => {
  for (const [name, goal] of DOGFOOD) {
    it(`${name} still exposes the demoted blocks at standard depth`, () => {
      const md = plan(goal, "standard").summary_markdown;
      expect(md).toContain("**How it works**");
      expect(md).toContain("**Build controls:**");
    });

    it(`${name} keeps every structured field intact at brief depth`, () => {
      // Nothing is removed from the JSON — only from the Layer-1 prose.
      const out = plan(goal);
      expect(out.goal_to_product_wizard.runtime_requirements).toBeDefined();
      expect(out.goal_to_product_wizard.interaction_surface).toBeDefined();
      expect(out.hosting_and_monitoring).toBeDefined();
      expect(out.recommended_route.length).toBeGreaterThan(0);
      expect(out.next_action_menu.length).toBeGreaterThan(0);
    });
  }
});

describe("MAR-398 AC3 — the fallback menu is at most four options with one recommendation", () => {
  // MAR-402: the lettered menu renders by default only in the no-choice-UI
  // fallback surface, so the AC3 bounds are asserted there.
  for (const [name, goal] of DOGFOOD) {
    it(`${name} offers at most four lettered options`, () => {
      const md = plan(goal).question_flow.fallback_menu_markdown;
      const letters = md.match(/^[A-Z]\) /gm) ?? [];
      expect(letters.length).toBeGreaterThan(0);
      expect(letters.length).toBeLessThanOrEqual(4);
      // Letters are contiguous from A — no gaps left by a filtered option.
      expect(letters).toEqual(["A) ", "B) ", "C) ", "D) "].slice(0, letters.length));
    });

    it(`${name} marks exactly one option recommended`, () => {
      const out = plan(goal);
      const marks = out.question_flow.fallback_menu_markdown.match(/— Recommended$/gm) ?? [];
      // While a clarifying question is pending, answering it is the recommended
      // action (a question_flow round now), so no menu line is marked.
      const expected = out.clarifying_questions.length > 0 ? 0 : 1;
      expect(marks.length).toBe(expected);
    });
  }

  it("never drops the starred option from the shortened menu", () => {
    for (const [, goal] of DOGFOOD) {
      const out = plan(goal);
      if (out.clarifying_questions.length > 0) continue;
      const starred = out.goal_to_product_wizard.recommended_next_click.id;
      if (starred === "answer_clarifying_questions") continue;
      expect(out.question_flow.fallback_menu_markdown).toMatch(/— Recommended$/m);
    }
  });
});

describe("MAR-398 AC4 — no truncated sentences in the card, full text in the fields", () => {
  for (const [name, goal] of DOGFOOD) {
    it(`${name} keeps full step purposes in the structured field`, () => {
      // componentPurpose used to truncate at 80 chars BEFORE the value reached
      // RouteStep.purpose, so paste-ready surfaces shipped "…" mid-sentence.
      const out = plan(goal, "technical");
      for (const step of out.recommended_route) {
        expect(step.purpose, `${step.component_id} purpose is pre-truncated`).not.toContain("…");
      }
    });

    it(`${name} renders no mid-sentence ellipsis in the card`, () => {
      const md = plan(goal).summary_markdown;
      expect(md).not.toContain("…");
    });

    it(`${name} keeps full labels in the wizard steps`, () => {
      const out = plan(goal);
      for (const step of out.goal_to_product_wizard.steps) {
        expect(step.label).not.toContain("…");
      }
    });
  }
});

describe("MAR-398 AC5 — no calendar copy on non-calendar routes", () => {
  it("the refund plan never mentions a calendar write", () => {
    const out = plan(REFUND, "technical");
    expect(out.recommended_route.map((s) => s.component_id)).not.toContain("calendar_write");
    const appropriate = out.goal_to_product_wizard.interaction_surface.recommended.appropriate_when;
    expect(appropriate.toLowerCase()).not.toContain("calendar");
    expect(appropriate.toLowerCase()).not.toContain("suggested times");
  });

  it("the email-triage plan never mentions a calendar write", () => {
    const out = plan(TRIAGE, "technical");
    const appropriate = out.goal_to_product_wizard.interaction_surface.recommended.appropriate_when;
    expect(appropriate.toLowerCase()).not.toContain("calendar");
  });

  it("a genuine calendar route may still say calendar", () => {
    // Bleed-guard: the fix must be route-conditional, not a blanket string ban.
    const out = plan(
      "Build an assistant that reads unread Gmail meeting requests, checks my Google Calendar, " +
        "and after I approve creates one Calendar event. Never send the email.",
      "technical",
    );
    expect(out.recommended_route.map((s) => s.component_id)).toContain("calendar_write");
  });
});

describe("MAR-398 — Option F is not offered where it cannot work", () => {
  it("a durable/offline goal is not told to build it in a no-code assistant", () => {
    // A Cowork assistant cannot host something that must keep running while the
    // user is offline, so offering it there is an option that cannot be taken.
    const out = plan(PRICING);
    expect(out.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline).toBe(true);
    expect(out.summary_markdown).not.toContain("no-code assistant");
    expect(out.question_flow.fallback_menu_markdown).not.toContain("no-code assistant");
  });

  it("a small attended goal still gets the assistant surface", () => {
    // Bleed-guard for MAR-395: the option must survive where it does work —
    // starred in the fallback menu, and the ⭐ build surface round agrees.
    const out = plan("summarize my inbox for me now");
    expect(out.goal_to_product_wizard.recommended_next_click.id).toBe("build_in_assistant");
    expect(out.question_flow.fallback_menu_markdown).toContain("no-code assistant");
    const buildSurface = out.question_flow.rounds.find((r) => r.id === "build_surface");
    expect(buildSurface?.recommended_option_id).toBe("cowork");
  });
});
