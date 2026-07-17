/**
 * Constraint coverage (MAR-250 phase 2) — checkable goal commitments vs. route
 * structure. Pure function: goal + execution order + gated writes in, checks
 * out. The golden email/calendar goal is the primary fixture (review §8.5:
 * "coverage should validate constraints and effects, not merely nouns and
 * verbs").
 */
import { describe, it, expect } from "vitest";
import { computeConstraintCoverage } from "../../src/graph/constraintCoverage.js";

const GOLDEN_GOAL =
  "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
  "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
  "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
  "the email. I will be present for approval and I want visible run logs.";

const GOLDEN_ORDER = [
  "email_read",
  "calendar_lookup",
  "email_draft",
  "schema_validation",
  "human_approval_gate",
  "auth_failure_handler",
  "calendar_write",
  "gmail_draft_write",
  "audit_log",
];

describe("computeConstraintCoverage — golden email/calendar goal", () => {
  const cc = computeConstraintCoverage({
    goal: GOLDEN_GOAL,
    executionOrder: GOLDEN_ORDER,
    gatedWriteIds: ["calendar_write", "gmail_draft_write"],
  });
  const by = (cls: string) => cc.checks.filter((c) => c.constraint_class === cls);

  it("'Never send the email' is STRUCTURAL — send components are absent, not merely promised", () => {
    const prohibitions = by("prohibition");
    expect(prohibitions).toHaveLength(1);
    expect(prohibitions[0].status).toBe("structural");
    expect(prohibitions[0].goal_phrase).toBe("never send");
  });

  it("'only after I approve' is STRUCTURAL — proven by gate position in execution order", () => {
    const ordering = by("ordering");
    expect(ordering).toHaveLength(1);
    expect(ordering[0].status).toBe("structural");
    expect(ordering[0].goal_phrase).toBe("only after i approve");
    expect(ordering[0].representation).toContain("calendar_write");
    expect(ordering[0].representation).toContain("gmail_draft_write");
  });

  it("quantities are DELEGATED with acceptance criteria — the route cannot encode counts", () => {
    const quantities = by("quantity");
    const phrases = quantities.map((c) => c.goal_phrase.toLowerCase());
    expect(phrases).toContain("two available 30-minute slots");
    expect(phrases).toContain("one calendar event");
    expect(phrases).toContain("one gmail draft");
    for (const q of quantities) {
      expect(q.status).toBe("delegated");
      expect(q.acceptance_criterion).toBeTruthy();
    }
  });

  it("the 30-minute duration and the unread filter are DELEGATED", () => {
    expect(by("duration").map((c) => c.goal_phrase)).toContain("30-minute");
    expect(by("filter")).toHaveLength(1);
    expect(by("filter")[0].goal_phrase).toBe("unread");
    expect(by("filter")[0].status).toBe("delegated");
  });

  it("label is 'delegated' — no gaps, but not everything is structural", () => {
    expect(cc.problem_count).toBe(0);
    expect(cc.structural_count).toBeGreaterThanOrEqual(2);
    expect(cc.delegated_count).toBeGreaterThanOrEqual(4);
    expect(cc.constraint_label).toBe("delegated");
  });
});

describe("computeConstraintCoverage — problem detection", () => {
  it("a broad no-send goal with a surviving send component is VIOLATED", () => {
    const cc = computeConstraintCoverage({
      goal: "Summarize support tickets internally, never send anything",
      executionOrder: ["email_read", "slack_notification"],
      gatedWriteIds: [],
    });
    const prohibition = cc.checks.find((c) => c.constraint_class === "prohibition");
    expect(prohibition?.status).toBe("violated");
    expect(prohibition?.representation).toContain("slack_notification");
    expect(cc.constraint_label).toBe("gaps");
  });

  it("a read-only goal is structural without writes and violated with them", () => {
    const base = {
      goal: "Scan the PR diff for problems, read-only, never write anything",
      executionOrder: ["repo_read", "human_approval_gate"],
    };
    const clean = computeConstraintCoverage({ ...base, gatedWriteIds: [] });
    expect(
      clean.checks.find((c) => c.constraint_class === "prohibition")?.status,
    ).toBe("structural");

    const dirty = computeConstraintCoverage({
      goal: base.goal,
      executionOrder: ["repo_read", "crm_note_write"],
      gatedWriteIds: ["crm_note_write"],
    });
    expect(
      dirty.checks.find((c) => c.constraint_class === "prohibition")?.status,
    ).toBe("violated");
  });

  it("approval-before-write without a gate ahead of the writes is MISSING", () => {
    const cc = computeConstraintCoverage({
      goal: "Only after I approve, update the CRM record",
      executionOrder: ["email_read", "crm_note_write"],
      gatedWriteIds: ["crm_note_write"],
    });
    const ordering = cc.checks.find((c) => c.constraint_class === "ordering");
    expect(ordering?.status).toBe("missing");
    expect(cc.constraint_label).toBe("gaps");
  });

  it("a gate AFTER the write does not satisfy the ordering constraint", () => {
    const cc = computeConstraintCoverage({
      goal: "Only after I approve, update the CRM record",
      executionOrder: ["crm_note_write", "human_approval_gate"],
      gatedWriteIds: ["crm_note_write"],
    });
    expect(cc.checks.find((c) => c.constraint_class === "ordering")?.status).toBe("missing");
  });

  it("exactly-once needs state: MISSING without dedupe, STRUCTURAL with it", () => {
    const goal = "Process each incoming invoice exactly once and post a summary";
    const without = computeConstraintCoverage({
      goal,
      executionOrder: ["email_read", "slack_notification"],
      gatedWriteIds: [],
    });
    expect(
      without.checks.find((c) => c.constraint_class === "exactly_once")?.status,
    ).toBe("missing");

    const withDedupe = computeConstraintCoverage({
      goal,
      executionOrder: ["email_read", "deduplication", "slack_notification"],
      gatedWriteIds: [],
    });
    expect(
      withDedupe.checks.find((c) => c.constraint_class === "exactly_once")?.status,
    ).toBe("structural");
  });
});

describe("computeConstraintCoverage — quiet goals stay quiet", () => {
  it("a goal without checkable constraints produces zero checks", () => {
    const cc = computeConstraintCoverage({
      goal: "summarize hacker news for me and post the digest to Slack",
      executionOrder: ["web_scrape", "slack_notification"],
      gatedWriteIds: [],
    });
    expect(cc.checks).toEqual([]);
    expect(cc.constraint_label).toBe("structural");
  });

  it("counting words outside the artifact lexicon do not fire quantity checks", () => {
    const cc = computeConstraintCoverage({
      goal: "give me one of the best summaries and check two websites",
      executionOrder: ["web_scrape"],
      gatedWriteIds: [],
    });
    expect(cc.checks.filter((c) => c.constraint_class === "quantity")).toEqual([]);
  });
});
