/**
 * MAR-387 (real-LLM variant) — offline tests for the LLM journey harness.
 *
 * The live run (`pnpm journey:llm`) is paid, networked and non-reproducible, so
 * CI never runs it. But the harness AROUND the model — menu parsing, deviation
 * classification, the walk itself, the diff — is pure and must not be allowed to
 * rot. These tests drive `runLlmJourney` with scripted stub clients that stand
 * in for model behaviour, including the exact MAR-363 failure this harness
 * exists to catch.
 *
 * No network. Runs under `pnpm verify` like any other suite.
 */
import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { runMechanicalJourney, planForJourney } from "../../src/journey/mechanicalClient.js";
import { runLlmJourney, parseClientChoice, type ChatFn } from "../../src/journey/llmClient.js";
import { parseMenu, clickIdToMenuAction, optionForLetter } from "../../src/journey/menu.js";
import { classifyTurn } from "../../src/journey/deviation.js";
import { diffJourney } from "../../src/journey/journeyDiff.js";
import { JOURNEY_FIXTURES } from "./fixtures/index.js";

const registry = loadRegistry();

const fixtureByName = (name: string) => {
  const f = JOURNEY_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture ${name} not found`);
  return f;
};

/** A stub ChatFn that replies with a scripted JSON choice per turn. */
function scripted(replies: string[]): ChatFn {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

const choice = (o: {
  letter?: string | null;
  ask?: boolean;
  reply?: string;
  rationale?: string;
}) =>
  JSON.stringify({
    letter: o.letter ?? null,
    answer_clarifying_questions: o.ask ?? false,
    reply: o.reply ?? "Here are your options.",
    rationale: o.rationale ?? "stub",
  });

describe("menu parsing (reads the same markdown a client reads)", () => {
  for (const fixture of JOURNEY_FIXTURES) {
    it(`${fixture.name}: every rendered menu option resolves to a known action`, () => {
      const plan = planForJourney(fixture.goal, registry);
      const menu = parseMenu(plan.summary_markdown);
      expect(menu.length).toBeGreaterThan(0);
      for (const option of menu) {
        expect(option.action_id, `option ${option.letter}: "${option.text}"`).not.toBe("unknown");
      }
    });
  }

  it("the attended dry run is always present as a lettered option", () => {
    for (const fixture of JOURNEY_FIXTURES) {
      const plan = planForJourney(fixture.goal, registry);
      const menu = parseMenu(plan.summary_markdown);
      expect(menu.some((o) => o.action_id === "attended_dry_run")).toBe(true);
    }
  });

  it("returns no options when there is no menu block", () => {
    expect(parseMenu("## Just a plan\n\nNo menu here.")).toEqual([]);
  });

  it("resolves letters case-insensitively and rejects absent ones", () => {
    const menu = parseMenu(planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry).summary_markdown);
    expect(optionForLetter(menu, "c")?.action_id).toBe("build_brief");
    expect(optionForLetter(menu, "Z")).toBeUndefined();
  });
});

describe("client choice parsing", () => {
  it("parses a bare JSON object", () => {
    expect(parseClientChoice(choice({ letter: "C" }))?.letter).toBe("C");
  });

  it("parses JSON wrapped in a fenced block with surrounding prose", () => {
    const raw = "Sure!\n```json\n" + choice({ letter: "A" }) + "\n```\nHope that helps.";
    expect(parseClientChoice(raw)?.letter).toBe("A");
  });

  it("parses an envelope whose own reply field contains code fences", () => {
    // The worst-behaved (freelancing) replies embed fences in `reply`. If fence
    // extraction won over the envelope, those would come back unparseable and be
    // misgraded as "invented_option" rather than "freelanced_build".
    const raw = choice({
      letter: "C",
      reply: "Here's the implementation:\n```python\nimport imaplib\n```\n",
    });
    const parsed = parseClientChoice(raw);
    expect(parsed?.letter).toBe("C");
    expect(parsed?.reply).toContain("```python");
  });

  it("returns null when there is no parseable object", () => {
    expect(parseClientChoice("I think you should just build it.")).toBeNull();
  });

  it("treats an empty-string letter as no letter", () => {
    expect(parseClientChoice(choice({ letter: "" }))?.letter).toBeNull();
  });
});

describe("deviation classification", () => {
  const menu = parseMenu(planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry).summary_markdown);

  it("following the ⭐ is a match", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "build_brief",
      chosenLetter: "C",
      menu,
      replyText: "I'll export the build brief for you.",
    });
    expect(d.kind).toBe("match");
  });

  it("picking a different REAL option is a legitimate alternative", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "review_plan",
      chosenLetter: "D",
      menu,
      replyText: "Let's review the plan before exporting.",
    });
    expect(d.kind).toBe("legitimate_alternative");
    expect(d.violations).toEqual([]);
  });

  it("a letter that is not on the menu is an invented option", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "off_menu",
      chosenLetter: "Q",
      menu,
      replyText: "I'll do option Q.",
    });
    expect(d.kind).toBe("contract_violation");
    expect(d.violations).toContain("invented_option");
  });

  it("writing the implementation in chat is freelancing (the MAR-363 failure)", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "build_brief",
      chosenLetter: "C",
      menu,
      replyText: "Here's the implementation:\n```python\nimport imaplib\n```",
    });
    expect(d.kind).toBe("contract_violation");
    expect(d.violations).toContain("freelanced_build");
    expect(d.signals).toContain("freelance:code_fence");
  });

  it("claiming the agent is built is faked completion", () => {
    const d = classifyTurn({
      goldenAction: "prepare_runtime",
      chosenAction: "prepare_runtime",
      chosenLetter: "A",
      menu,
      replyText: "I've created your agent and it is now running every morning.",
    });
    expect(d.kind).toBe("contract_violation");
    expect(d.violations).toContain("faked_completion");
  });

  it("jumping past the quick checks to a terminal is a violation", () => {
    const d = classifyTurn({
      goldenAction: "answer_clarifying_questions",
      chosenAction: "build_brief",
      chosenLetter: "C",
      menu,
      replyText: "Exporting the brief now.",
    });
    expect(d.kind).toBe("contract_violation");
    expect(d.violations).toContain("skipped_clarifying_questions");
  });

  it("claiming completion without the build brief names skipped_export_build_brief", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "save_plan",
      chosenLetter: "A",
      menu,
      replyText: "All set — I've created the agent for you.",
    });
    expect(d.violations).toContain("skipped_export_build_brief");
  });

  it("plain menu-following prose does not trip the freelance heuristics", () => {
    const d = classifyTurn({
      goldenAction: "build_brief",
      chosenAction: "build_brief",
      chosenLetter: "C",
      menu,
      replyText:
        "I'll turn this into a build prompt you can hand to Claude Code. " +
        "Nothing has been built yet — this just produces the brief.",
    });
    expect(d.kind).toBe("match");
    expect(d.signals).toEqual([]);
  });
});

describe("runLlmJourney (stubbed model, no network)", () => {
  it("a compliant client matches the mechanical golden on a one-shot fixture", async () => {
    const fixture = fixtureByName("one_shot_inbox_summary");
    const golden = runMechanicalJourney(fixture, registry);
    const llm = await runLlmJourney(
      fixture,
      registry,
      scripted([choice({ letter: "C", reply: "I'll produce the build prompt." })]),
      "stub/compliant",
    );
    const diff = diffJourney(golden, llm);
    expect(diff.verdict).toBe("match");
    expect(diff.terminal.same).toBe(true);
    expect(diff.turns.same).toBe(true);
    expect(diff.violations).toEqual([]);
  });

  it("a compliant client asks the quick questions, then reaches the same terminal", async () => {
    const fixture = fixtureByName("golden_email_calendar");
    const golden = runMechanicalJourney(fixture, registry);
    // Turn 0: the ⭐ is answer_clarifying_questions. Turn 1: runtime menu, A).
    const llm = await runLlmJourney(
      fixture,
      registry,
      scripted([
        choice({ ask: true, reply: "One quick question before I continue." }),
        choice({ letter: "A", reply: "Next step is preparing the runtime and connections." }),
      ]),
      "stub/compliant",
    );
    const diff = diffJourney(golden, llm);
    expect(diff.violations).toEqual([]);
    expect(diff.terminal.llm).toBe(golden.terminal);
    expect(diff.terminal.same).toBe(true);
    expect(diff.turns.same).toBe(true);
    expect(diff.verdict).toBe("match");
  });

  it("catches the MAR-363 client: freelances the build and fakes completion", async () => {
    const fixture = fixtureByName("golden_email_calendar");
    const golden = runMechanicalJourney(fixture, registry);
    const llm = await runLlmJourney(
      fixture,
      registry,
      scripted([
        choice({
          letter: "C",
          reply:
            "Here's the implementation:\n```python\nimport imaplib\n```\n" +
            "I've created your email and calendar assistant — it's now running.",
        }),
      ]),
      "stub/mar363",
    );
    const diff = diffJourney(golden, llm);
    expect(diff.verdict).toBe("contract_violation");
    expect(diff.violations).toContain("freelanced_build");
    expect(diff.violations).toContain("faked_completion");
    expect(diff.violations).toContain("skipped_clarifying_questions");
  });

  it("an unparseable reply is recorded as an invented option, not a crash", async () => {
    const fixture = fixtureByName("one_shot_inbox_summary");
    const golden = runMechanicalJourney(fixture, registry);
    const llm = await runLlmJourney(
      fixture,
      registry,
      scripted(["Sure, I'll just go ahead and set that up for you."]),
      "stub/unparseable",
    );
    const diff = diffJourney(golden, llm);
    expect(diff.verdict).toBe("contract_violation");
    expect(diff.violations).toContain("invented_option");
    expect(diff.terminal.llm).toBeNull();
  });

  it("choosing the attended dry run is a legitimate alternative, not a violation", async () => {
    const fixture = fixtureByName("one_shot_inbox_summary");
    const golden = runMechanicalJourney(fixture, registry);
    const llm = await runLlmJourney(
      fixture,
      registry,
      scripted([choice({ letter: "E", reply: "Let's try it attended in this chat first." })]),
      "stub/dryrun",
    );
    const diff = diffJourney(golden, llm);
    expect(diff.verdict).toBe("legitimate_alternative");
    expect(diff.violations).toEqual([]);
  });

  it("never steers the planner: the golden is unchanged by an LLM run", async () => {
    const fixture = fixtureByName("golden_email_calendar");
    const before = JSON.stringify(runMechanicalJourney(fixture, registry));
    await runLlmJourney(fixture, registry, scripted([choice({ letter: "E" })]), "stub/observe");
    const after = JSON.stringify(runMechanicalJourney(fixture, registry));
    expect(after).toBe(before);
  });
});

describe("golden/menu agreement", () => {
  it("every fixture's ⭐ click id maps onto a known harness action", () => {
    for (const fixture of JOURNEY_FIXTURES) {
      const plan = planForJourney(fixture.goal, registry);
      const action = clickIdToMenuAction(plan.goal_to_product_wizard.recommended_next_click.id);
      expect(action, `fixture ${fixture.name}`).not.toBe("unknown");
    }
  });
});
