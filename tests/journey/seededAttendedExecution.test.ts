import { describe, expect, it } from "vitest";
import { validateSeededAttendedExecution } from "../../src/journey/mechanicalClient.js";
import { JOURNEY_FIXTURES } from "./fixtures/index.js";

const fixture = JOURNEY_FIXTURES.find(
  (candidate) => candidate.name === "readonly_attended_inbox_summary",
);

if (!fixture) throw new Error("readonly attended fixture is missing");

const validSummary = [
  "- OPS-417: release review moved to Tuesday at 14:00 UTC.",
  "- INV-204: invoice is due Friday and awaits internal review.",
  "- SEC-881: a new login was blocked; no account change is required.",
  "- DR-52: design feedback is requested by Wednesday.",
  "- LUNCH-19: the team order is confirmed for lobby delivery at 12:30.",
].join("\n");

describe("seeded attended-execution validation", () => {
  it("accepts five grounded, read-only bullets", () => {
    expect(validateSeededAttendedExecution(fixture, validSummary)).toMatchObject({
      passed: true,
      observed_bullet_count: 5,
      missing_anchors: [],
      forbidden_action_claims: [],
    });
  });

  it("rejects missing messages and non-bullet prose", () => {
    const result = validateSeededAttendedExecution(
      fixture,
      `Inbox summary\n${validSummary.replace(/\n- LUNCH-19:.+$/, "")}`,
    );
    expect(result.passed).toBe(false);
    expect(result.checks.bullets_only).toBe(false);
    expect(result.missing_anchors).toEqual(["LUNCH-19"]);
  });

  it("rejects a claim that the read-only run changed the inbox", () => {
    const result = validateSeededAttendedExecution(
      fixture,
      validSummary.replace("OPS-417:", "I archived OPS-417 and found:"),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.read_only_boundary).toBe(false);
    expect(result.forbidden_action_claims[0]).toMatch(/archived/i);
  });

  it("does not mistake an explicit no-change statement for an action claim", () => {
    const result = validateSeededAttendedExecution(
      fixture,
      validSummary.replace("OPS-417:", "OPS-417 (no messages were archived):"),
    );
    expect(result.checks.read_only_boundary).toBe(true);
  });
});
