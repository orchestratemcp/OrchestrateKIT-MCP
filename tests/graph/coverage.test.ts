/**
 * Coverage accounting (MAR-250) — acceptance tests.
 *
 * Locks the keystone honesty layer against the two live failure classes from
 * the 2026-07-01 audit:
 *   - unmatched demand: "save a digest note into my Notion workspace" produced a
 *     route with no write component while claiming "nothing external";
 *     "pull … from our Postgres database, generate a PDF summary report" had
 *     neither a db-read nor a report component and said nothing.
 *   - unsupported supply: crm_note_write rode into the Postgres→PDF→Slack goal
 *     on fuzzy word overlap ("sales", "human") with no goal phrase asking for it.
 *
 * These are vitest contracts rather than node-probes because they assert on the
 * `coverage` output field, not on route membership (which this feature never
 * changes — flag-only by design).
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string) {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [] },
    registry,
  );
}

// The audit goals, verbatim (Lab sessions 2026-06-18 / audit 2026-07-01).
const G1_EMAIL_TRIAGE =
  "Every morning, read unread customer support emails, classify them by urgency, and draft replies for my approval — never send anything automatically. A human reviews every draft.";
const G3_NOTION =
  "Every morning, gather the top AI industry news from a handful of trusted sources and save a short digest note into my Notion workspace. No emails, no social posts.";
const G4_PG_REPORT =
  "Every Monday at 8am, pull last week's sales numbers from our Postgres database, generate a PDF summary report, and post it to our team Slack channel. Fully unattended, no human in the loop.";
// A goal naming systems the registry genuinely does not cover (Zendesk, SMS) —
// the standing "poor coverage" fixture now that MAR-254 covers the Postgres one.
const ZENDESK_SMS =
  "Every Monday morning, pull last week's support tickets from Zendesk and text me a summary via SMS.";

describe("MAR-250 — unmatched demand (goal steps the registry cannot carry)", () => {
  it("the audit G4 scheduled-report goal is now fully demand-covered (MAR-254 closed the gap)", () => {
    // Pre-MAR-254 this goal flagged the Postgres and report clauses. db_read +
    // report_generation now claim them — coverage proves the fix end-to-end,
    // including the compound-noun rule ("Postgres database" is ONE demand unit;
    // db_read claiming `postgres` covers it even though no phrase says "database").
    const out = plan(G4_PG_REPORT);
    expect(out.coverage.unmatched_demand).toEqual([]);
    const ids = out.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("db_read");
    expect(ids).toContain("report_generation");
  });

  it("flags both steps of a goal naming registry-unknown systems (Zendesk, SMS)", () => {
    const out = plan(ZENDESK_SMS);
    const unmatched = out.coverage.unmatched_demand.join(" | ").toLowerCase();
    expect(unmatched).toContain("zendesk");
    expect(unmatched).toContain("sms");
    expect(out.coverage.coverage_label).toBe("poor");
  });

  it("flags the Notion save step on the news-digest goal", () => {
    const out = plan(G3_NOTION);
    const unmatched = out.coverage.unmatched_demand.join(" | ").toLowerCase();
    expect(unmatched).toContain("notion");
  });

  it("clean goal has zero unmatched demand (bleed-guard)", () => {
    const out = plan(G1_EMAIL_TRIAGE);
    expect(out.coverage.unmatched_demand).toEqual([]);
  });

  it("negated / constraint phrases are never demand", () => {
    // "never send", "no Slack posts" are constraints — a route without a send
    // or Slack step must NOT report them as uncovered demand.
    const out = plan(
      "Read my support inbox and draft replies for review. Never send anything, no Slack posts.",
    );
    const unmatched = out.coverage.unmatched_demand.join(" | ").toLowerCase();
    expect(unmatched).not.toContain("send");
    expect(unmatched).not.toContain("slack");
  });
});

describe("MAR-250 — unsupported supply (components with no goal phrase behind them)", () => {
  it("flags crm_note_write on the Postgres→PDF→Slack goal (the audit's hallucinated write)", () => {
    const out = plan(G4_PG_REPORT);
    expect(out.coverage.unsupported_supply).toContain("crm_note_write");
  });

  it("never flags safety infrastructure the augmenter would inject anyway", () => {
    for (const goal of [G1_EMAIL_TRIAGE, G4_PG_REPORT]) {
      const flagged = plan(goal).coverage.unsupported_supply;
      for (const infra of [
        "audit_log",
        "schema_validation",
        "auth_failure_handler",
        "human_approval_gate",
      ]) {
        expect(flagged, `${infra} must not be flagged on "${goal.slice(0, 40)}…"`).not.toContain(
          infra,
        );
      }
    }
  });

  it("hint/segment-supported components are never flagged (bleed-guard)", () => {
    const out = plan(G1_EMAIL_TRIAGE);
    for (const supported of ["email_read", "email_draft", "scheduled_trigger", "intent_classifier"]) {
      expect(out.coverage.unsupported_supply).not.toContain(supported);
    }
  });
});

describe("MAR-250 — coverage verdict and provenance", () => {
  it("coverage label degrades honestly: uncovered-systems goal poor, G1 not poor", () => {
    expect(plan(ZENDESK_SMS).coverage.coverage_label).toBe("poor");
    expect(plan(G1_EMAIL_TRIAGE).coverage.coverage_label).not.toBe("poor");
    // G4 post-MAR-254: demand covered; only unsupported extras remain → partial.
    expect(plan(G4_PG_REPORT).coverage.coverage_label).toBe("partial");
  });

  it("coverage is tagged computed in provenance", () => {
    expect(plan(G1_EMAIL_TRIAGE).provenance.field_tags["coverage"]).toBe("computed");
  });

  it("matched pairs name the claiming component with its tokens", () => {
    const out = plan(G1_EMAIL_TRIAGE);
    const emailRead = out.coverage.matched.find((m) => m.component_id === "email_read");
    expect(emailRead).toBeDefined();
    expect(emailRead!.tokens.length).toBeGreaterThan(0);
  });

  it("flag-only: coverage never changes route membership (crm_note_write stays, flagged not dropped)", () => {
    const ids = plan(G4_PG_REPORT).recommended_route.map((s) => s.component_id);
    expect(ids).toContain("crm_note_write");
  });

  it("playbook plans compute unmatched demand but skip unsupported-supply accounting", () => {
    // A goal that reliably matches the email_calendar_assistant playbook.
    const out = plan(
      "Read emails, look up calendar availability, and draft meeting invites for confirmation.",
    );
    if (out.plan_source === "playbook") {
      expect(out.coverage.unsupported_supply).toEqual([]);
    }
    expect(out.coverage).toBeDefined();
  });

  it("compose_workflow_route carries the same coverage field", () => {
    const composed = composeRoute(
      { goal: G4_PG_REPORT, must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(composed.coverage.unsupported_supply).toContain("crm_note_write");
    expect(composed.coverage.coverage_label).toBe("partial");
  });
});
