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

  it("returns no options when there is no menu block", () => {
    expect(parseMenu("## Just a plan\n\nNo menu here.")).toEqual([]);
  });

  it("resolves letters case-insensitively and rejects absent ones", () => {
    const plan = planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry);
    const menu = parseMenu(plan.summary_markdown);
    expect(optionForLetter(menu, "c")?.action_id).toBe("build_brief");
    expect(optionForLetter(menu, "Z")).toBeUndefined();
  });

  it("marks the option the menu itself labels Recommended", () => {
    const plan = planForJourney(fixtureByName("one_shot_inbox_summary").goal, registry);
    const menu = parseMenu(plan.summary_markdown);
    const recommended = menu.filter((o) => o.marked_recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].action_id).toBe("build_brief");
  });
});
