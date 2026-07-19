/**
 * MAR-396 (SCOPE-01) — unrecognized action clauses must fail loud.
 *
 * The MAR-250 keystone answers "which goal steps did nothing claim?", but it
 * could only answer it for clauses whose vocabulary it already knew. A clause
 * with no DEMAND_VERB and no DEMAND_NOUN hit a bare `continue` in
 * computeCoverage — it was judged NOT A DEMAND rather than judged uncovered,
 * so it vanished before `clauseIsUncovered` ever saw it.
 *
 * The live consequence (dogfooded 2026-07-19/20): "issue the refund to the
 * customer" produced a route with NO refund step, `unmatched_demand: []`, L1
 * clearance, SMALL scope and a ⭐ pointing at "build it in a no-code
 * assistant" — every downstream verdict computed over a truncated route and
 * reading falsely reassuring. The `human_approval_gate` in that route was
 * gating a read.
 *
 * These fixtures pin the four phrasings from the issue. They fail on master
 * (all four report `unmatched_demand: []` or flag only the invoice lookup) and
 * pass on the branch.
 *
 * The fix under test is STRUCTURAL, not lexical: extending the demand lexicon
 * with money vocabulary would fix these four strings and leave the next unknown
 * verb with the identical failure mode. The "unknown verb outside the money
 * domain" cases below are the guard against a lexicon-only regression.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string, must_avoid: string[] = []) {
  return planWorkflow({ goal, must_have_capabilities: [], must_avoid }, registry);
}

// The four phrasings from MAR-396. The user typed the same sentence in every
// session; what differed was what the calling model actually sent (see MAR-397).
const VERBATIM =
  "When I ask, look up an invoice in our billing system and issue the refund to the customer. I'll approve each one.";
const PARAPHRASE =
  "On request, look up an invoice in the billing system, then issue a refund to the customer, with a human approval gate for each one.";
const PLAIN = "Look up the invoice and issue the refund to the customer.";

const PHRASINGS: Array<{ name: string; goal: string; must_avoid: string[] }> = [
  { name: "verbatim", goal: VERBATIM, must_avoid: [] },
  { name: "paraphrase", goal: PARAPHRASE, must_avoid: [] },
  { name: "paraphrase + must_avoid:[pdf_extraction]", goal: PARAPHRASE, must_avoid: ["pdf_extraction"] },
  { name: "plain imperative", goal: PLAIN, must_avoid: [] },
];

describe("MAR-396 — the refund clause reaches unmatched_demand at every phrasing", () => {
  for (const { name, goal, must_avoid } of PHRASINGS) {
    it(`surfaces the money-moving step (${name})`, () => {
      const out = plan(goal, must_avoid);

      // The registry has no payment-write component at all — only
      // stripe_data_read. The refund step is therefore demand nothing carries.
      expect(out.recommended_route.map((s) => s.component_id)).not.toContain("stripe_refund");

      expect(out.coverage.unmatched_demand.length).toBeGreaterThan(0);
      expect(out.coverage.unmatched_demand.join(" | ").toLowerCase()).toContain("refund");
    });

    it(`keeps unrecognized clauses a subset of unmatched ones (${name})`, () => {
      // A caller reading only the established field must still hear about
      // anything the parser could not understand.
      const out = plan(goal, must_avoid);
      for (const clause of out.coverage.unrecognized_demand) {
        expect(out.coverage.unmatched_demand).toContain(clause);
      }
    });

    it(`does not size an unbuildable goal SMALL or star a no-code assistant (${name})`, () => {
      // AC3: the delivery mechanism for this bug was scope SMALL → ⭐ "small
      // enough to one-shot in Cowork". A goal naming an action the registry
      // cannot perform is not one-shottable anywhere.
      const out = plan(goal, must_avoid);
      expect(out.scope_assessment.size).not.toBe("small");
      expect(out.goal_to_product_wizard.recommended_next_click.id).not.toBe("build_in_assistant");
    });
  }
});

/**
 * The load-bearing half. MAR-396 AC5 also asks for money vocabulary in the
 * lexicon, and that landed — which means the refund phrasings above are now
 * parsed LEXICALLY and no longer prove anything about the structural detector.
 *
 * These cases do. Every verb and noun below is deliberately absent from
 * DEMAND_VERBS / DEMAND_NOUNS, so they exercise exactly the path the silent
 * `continue` used to swallow. If someone later "fixes" a bug by adding a word
 * to the lexicon and reverts the shape detection, these fail.
 */
describe("MAR-396 — the fix is structural, not a lexicon patch", () => {
  const UNKNOWN_VERB_GOALS: Array<[string, string, string]> = [
    ["evict", "Look up the tenant record and evict the stale lease entry.", "evict the stale lease entry"],
    ["quarantine", "When I ask, quarantine the flagged shipment pallet.", "quarantine the flagged shipment pallet"],
    ["rescind", "When I ask, rescind the tenant's parking permit.", "rescind the tenant's parking permit"],
    ["reassign", "Read the roster and reassign the night shift.", "reassign the night shift"],
  ];

  for (const [verb, goal, clause] of UNKNOWN_VERB_GOALS) {
    it(`flags "${verb}" — a verb no lexicon entry covers`, () => {
      const out = plan(goal);
      expect(out.coverage.unrecognized_demand).toContain(clause);
      // …and it reaches the established field too, so existing readers see it.
      expect(out.coverage.unmatched_demand).toContain(clause);
    });

    it(`does not size the "${verb}" goal SMALL`, () => {
      // The scope floor keys off unmatched_demand, so it must hold for clauses
      // that arrived there via the structural path too.
      const out = plan(goal);
      expect(out.scope_assessment.size).not.toBe("small");
      expect(out.goal_to_product_wizard.recommended_next_click.id).not.toBe("build_in_assistant");
    });
  }
});

/**
 * KNOWN LIMITATION, pinned deliberately rather than left as folklore.
 *
 * The unrecognized-clause path clears a clause when any route component already
 * claims one of its words. That check is what stops the honesty layer crying
 * wolf on validated playbooks — but it inherits the matcher's fuzzy claims, so a
 * component can clear a clause it does not actually perform.
 *
 * Live example: `auth_failure_handler` matches the token "credential", which
 * clears "revoke the contractor's badge credential" even though nothing in the
 * registry revokes anything. This is the same over-crediting family as MAR-303
 * (a component riding a route on word overlap), it predates MAR-396 — the clause
 * was silently dropped on master too — and closing it needs claim provenance
 * (hint/segment vs fuzzy) plumbed into `Coverage.matched`, which is a larger
 * change than this issue.
 *
 * This test documents the CURRENT behaviour. If someone lands claim provenance
 * and this starts flagging, that is an improvement: flip the assertion.
 */
describe("MAR-396 — known limitation: fuzzy token claims can still clear a clause", () => {
  it("a fuzzily-claimed word suppresses an otherwise unrecognized action", () => {
    const out = plan("When I ask, revoke the contractor's badge credential.");
    expect(out.coverage.matched.map((m) => m.component_id)).toContain("auth_failure_handler");
    expect(out.coverage.unrecognized_demand).toEqual([]);
  });
});

describe("MAR-396 — bleed-guards: honest silence stays silent", () => {
  it("a constraint clause is never unrecognized demand", () => {
    // "never send anything" is a prohibition, not a step. Flagging it would
    // invert the safety meaning of the goal.
    const out = plan(
      "Every morning, read unread customer support emails, classify them by urgency, and draft replies for my approval — never send anything automatically. A human reviews every draft.",
    );
    const joined = out.coverage.unrecognized_demand.join(" | ").toLowerCase();
    expect(joined).not.toContain("send");
    expect(out.coverage.unmatched_demand).toEqual([]);
  });

  it("delivering output to the user in-channel is not unrecognized demand", () => {
    // "give me a summary in this chat" is satisfied by the assistant itself.
    const out = plan(
      "Read my unread inbox now and give me a concise five-bullet summary in this chat. " +
        "This is read-only and attended: do not send, delete, archive, label, or modify any email; " +
        "do not create a scheduled or persistent agent.",
    );
    expect(out.coverage.unrecognized_demand).toEqual([]);
  });

  it("a trigger clause is not a step", () => {
    const out = plan("When I ask, summarize my inbox.");
    expect(out.coverage.unrecognized_demand.join(" | ").toLowerCase()).not.toContain("when i ask");
  });

  it("the validated competitor-price playbook stays clean", () => {
    const out = plan(
      "Build an agent that checks 5 competitor pages every morning, detects price changes, " +
        "and sends me a Slack summary. I want to approve before anything external is changed.",
    );
    expect(out.coverage.unrecognized_demand).toEqual([]);
  });
});
