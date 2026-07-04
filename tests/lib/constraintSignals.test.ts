/**
 * constraintSignals (MAR-255 / BRIEF-03) — the shared goal-constraint
 * detection used by plan_workflow's gate logic AND export_build_brief's §0.
 * Six fixture goals covering every constraint class, plus negation and the
 * conflicting case. The G1 goal is VERBATIM from the 2026-07-01 audit — the
 * one the brief previously answered with "No explicit … constraint detected".
 */
import { describe, it, expect } from "vitest";
import {
  detectConstraintSignals,
  hasWriteConstraint,
  hasUnattendedWaiver,
  hasExplicitApprovalRequirement,
  occursUnnegated,
} from "../../src/lib/constraintSignals.js";

const G1_EMAIL =
  "Every morning, read unread customer support emails, classify them by urgency, and draft " +
  "replies for my approval — never send anything automatically. A human reviews every draft.";

describe("detectConstraintSignals (MAR-255)", () => {
  it("G1 audit goal → draft-only + attended, with trigger phrases", () => {
    const s = detectConstraintSignals(G1_EMAIL);
    expect(s.draft_only.detected).toBe(true);
    expect(s.draft_only.trigger).toBe("never send anything automatically");
    expect(s.attended_required.detected).toBe(true);
    expect(s.attended_required.trigger).toBe("for my approval");
    expect(s.read_only.detected).toBe(false);
    expect(s.conflict).toBe(false);
  });

  it("read-only goal → read_only with trigger", () => {
    const s = detectConstraintSignals(
      "Scan the pull request diff for problems, read-only, never write anything",
    );
    expect(s.read_only.detected).toBe(true);
    expect(s.read_only.trigger).toBe("read-only");
  });

  it("unattended goal → unattended, no attended", () => {
    const s = detectConstraintSignals(
      "Watch our API uptime and alert on Slack, fully unattended, no human in the loop",
    );
    expect(s.unattended.detected).toBe(true);
    expect(s.unattended.trigger).toBe("unattended");
    expect(s.attended_required.detected).toBe(false);
    expect(s.conflict).toBe(false);
  });

  it("no-outbound goal → no_outbound with trigger", () => {
    const s = detectConstraintSignals(
      "Summarize industry news into an internal digest, no emails sent to anyone",
    );
    expect(s.no_outbound.detected).toBe(true);
    expect(s.no_outbound.trigger).toBe("no emails sent");
  });

  it("goal with no constraints → nothing detected", () => {
    const s = detectConstraintSignals("read emails and draft a CRM note for each lead");
    expect(s.read_only.detected).toBe(false);
    expect(s.unattended.detected).toBe(false);
    expect(s.attended_required.detected).toBe(false);
    expect(s.draft_only.detected).toBe(false);
    expect(s.no_outbound.detected).toBe(false);
    expect(s.conflict).toBe(false);
  });

  it("conflicting goal (waiver + human review) → both detected + conflict flag", () => {
    const s = detectConstraintSignals(
      "Runs unattended on a schedule, but a human reviews every draft before it goes out",
    );
    expect(s.attended_required.detected).toBe(true);
    expect(s.unattended.detected).toBe(true);
    expect(s.conflict).toBe(true);
  });

  it("negated waiver phrases do not count (MAR-229/140 lineage)", () => {
    const s = detectConstraintSignals("This is not unattended — I check the output daily");
    expect(s.unattended.detected).toBe(false);
    expect(s.conflict).toBe(false);
  });
});

describe("planner predicates re-exported unchanged (pure refactor)", () => {
  it("hasWriteConstraint fires on the MAR-142 phrase table", () => {
    expect(hasWriteConstraint("read-only on all external sites")).toBe(true);
    expect(hasWriteConstraint("post the summary to Slack")).toBe(false);
  });

  it("hasUnattendedWaiver yields to an explicit approval requirement (MAR-229)", () => {
    expect(hasUnattendedWaiver("fully automated, no gate")).toBe(true);
    expect(hasUnattendedWaiver("fully automated, but a human must approve each send")).toBe(false);
    expect(hasExplicitApprovalRequirement("a human must approve each send")).toBe(true);
  });

  it("occursUnnegated respects the negation window", () => {
    expect(occursUnnegated("must review before sending", "must review", true)).toBe(true);
    // negation word directly precedes the phrase → negated
    expect(occursUnnegated("do not review before sending", "review before", true)).toBe(false);
  });
});
