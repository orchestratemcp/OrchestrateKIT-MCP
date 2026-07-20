/**
 * MAR-387 — the menu is machine-readable.
 *
 * A client is supposed to WALK THE MENU rather than improvise (the MAR-363
 * failure). That contract only holds if the menu the planner renders can
 * actually be read back as a set of discrete, identifiable options. This suite
 * asserts exactly that, against the same `summary_markdown` a real client sees.
 *
 * Deterministic and offline, like everything else in this repo: no LLM, no
 * network, no key. Grading a *client's* behaviour against these options is the
 * Lab's job (it owns the model gateway and the run history); the MCP's job is
 * only to guarantee the surface is parseable in the first place.
 */
import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { planForJourney } from "../../src/journey/mechanicalClient.js";
import { parseMenu, clickIdToMenuAction, optionForLetter } from "../../src/journey/menu.js";
import { JOURNEY_FIXTURES } from "./fixtures/index.js";

const registry = loadRegistry();

const fixtureByName = (name: string) => {
  const f = JOURNEY_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture ${name} not found`);
  return f;
};

describe("MAR-387 — the rendered menu is machine-readable", () => {
  for (const fixture of JOURNEY_FIXTURES) {
    it(`${fixture.name}: every rendered option resolves to a known action`, () => {
      const plan = planForJourney(fixture.goal, registry);
      const menu = parseMenu(plan.summary_markdown);
      expect(menu.length).toBeGreaterThan(0);
      for (const option of menu) {
        // An "unknown" here means the menu wording drifted away from what a
        // client can classify — loud, rather than a client silently guessing.
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

  it("every fixture's ⭐ click id maps onto a known action", () => {
    for (const fixture of JOURNEY_FIXTURES) {
      const plan = planForJourney(fixture.goal, registry);
      const action = clickIdToMenuAction(plan.goal_to_product_wizard.recommended_next_click.id);
      expect(action, `fixture ${fixture.name}`).not.toBe("unknown");
    }
  });

  // MAR-395 / MAR-388 regression: a new ⭐ click id that is not added to
  // clickIdToMenuAction grades as "unknown" SILENTLY, which misgrades the whole
  // golden-journey harness. Pin the mapping explicitly rather than relying on
  // the fixture sweep above, which only covers ids the fixtures happen to hit.
  it("maps the no-code assistant-surface click onto its menu action", () => {
    expect(clickIdToMenuAction("build_in_assistant")).toBe("assistant_surface");
  });

  it("a small goal renders the assistant surface as a parseable, starred option", () => {
    const plan = planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry);
    const menu = parseMenu(plan.summary_markdown);
    const assistant = menu.find((o) => o.action_id === "assistant_surface");
    expect(assistant, "assistant-surface option is offered").toBeDefined();
    expect(assistant?.marked_recommended).toBe(true);
    // …and the dry run is still OFFERED, just no longer starred.
    const dryRun = menu.find((o) => o.action_id === "attended_dry_run");
    expect(dryRun, "attended dry run is still offered").toBeDefined();
    expect(dryRun?.marked_recommended).toBe(false);
  });

  it("returns no options when there is no menu block", () => {
    expect(parseMenu("## Just a plan\n\nNo menu here.")).toEqual([]);
  });

  it("resolves letters case-insensitively and rejects absent ones", () => {
    const plan = planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry);
    const menu = parseMenu(plan.summary_markdown);
    // MAR-398: the menu is four options now, so which action sits at "C" is
    // layout. What this test is actually about is case-insensitive resolution,
    // so assert that directly instead of pinning an incidental letter->action.
    expect(optionForLetter(menu, "c")).toEqual(optionForLetter(menu, "C"));
    expect(optionForLetter(menu, "c")?.action_id).not.toBe("unknown");
    expect(optionForLetter(menu, "Z")).toBeUndefined();
  });

  it("the rendered Recommended option matches the machine-readable click", () => {
    for (const fixture of JOURNEY_FIXTURES) {
      const plan = planForJourney(fixture.goal, registry);
      const expected = clickIdToMenuAction(plan.goal_to_product_wizard.recommended_next_click.id);
      const recommended = parseMenu(plan.summary_markdown).filter((o) => o.marked_recommended);

      if (expected === "answer_clarifying_questions") {
        expect(recommended, `fixture ${fixture.name}`).toHaveLength(0);
      } else {
        expect(recommended, `fixture ${fixture.name}`).toHaveLength(1);
        expect(recommended[0].action_id, `fixture ${fixture.name}`).toBe(expected);
      }
    }
  });
});
