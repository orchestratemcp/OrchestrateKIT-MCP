import { describe, expect, it } from "vitest";
import {
  replayPlanPassport,
  type ObservedRun,
  type ReplayPlanPassport,
} from "../../src/lib/planReplay.js";

const PASSPORT: ReplayPlanPassport = {
  contract: "orchestratekit.plan_passport.v1",
  contract_id: "plan_passport:test1234",
  goal: "Read email, draft a reply, wait for approval, then send the approved draft.",
  route: {
    components: [
      { step: 1, component_id: "email_read" },
      { step: 2, component_id: "intent_classifier" },
      { step: 3, component_id: "email_draft" },
      { step: 4, component_id: "human_approval_gate" },
      { step: 5, component_id: "optional_email_send" },
      { step: 6, component_id: "audit_log" },
    ],
  },
  safety_gates: {
    enforced_approval_gates: ["human_approval_gate"],
  },
  acceptance_tests: [
    {
      id: "external-write-before-approval-forbidden",
      kind: "approval_gate",
      assertion: "External sends are blocked until approval is recorded.",
      evidence_required: ["approval denied fixture", "send call count is zero"],
      severity: "must",
    },
    {
      id: "observability-run-start-complete-failure",
      kind: "observability",
      assertion: "Run emits lifecycle evidence.",
      evidence_required: ["run-start event", "run-complete event", "run-failure event"],
      severity: "should",
    },
  ],
  build_handoff: {
    target: "code",
  },
};

const PASSING_RUN: ObservedRun = {
  steps: [
    "email_read",
    "intent_classifier",
    "email_draft",
    "human_approval_gate",
    "optional_email_send",
    "audit_log",
  ],
  events: [
    { type: "run-start", component_id: "email_read" },
    { type: "approval", component_id: "human_approval_gate", approved: true },
    { type: "send", component_id: "optional_email_send" },
    { type: "run-complete", component_id: "audit_log" },
  ],
  checklist: [
    { id: "external-write-before-approval-forbidden", status: "pass" },
    { id: "observability-run-start-complete-failure", status: "pass" },
  ],
  actual: { build_target: "code" },
};

describe("replayPlanPassport", () => {
  it("passes when route, approval, checklist, and build target evidence match", () => {
    const result = replayPlanPassport(PASSPORT, PASSING_RUN);

    expect(result.status).toBe("pass");
    expect(result.suggested_lab_rating).toBe("verified");
    expect(result.drift_chips).toEqual([]);
    expect(result.missing_evidence).toEqual([]);
    expect(result.lab_evidence.evidence_status).toBe("verified");
    expect(result.corpus_contract_candidate).toBeNull();
  });

  it("reports route drift and missing evidence distinctly from confirmed failure", () => {
    const result = replayPlanPassport(PASSPORT, {
      steps: ["email_read", "intent_classifier", "human_approval_gate", "optional_email_send"],
      events: [{ type: "approval", component_id: "human_approval_gate", approved: true }],
      checklist: [{ id: "external-write-before-approval-forbidden", status: "pass" }],
      actual: { build_target: "code" },
    });

    expect(result.status).toBe("warning");
    expect(result.drift_chips).toEqual([]);
    expect(result.missing_evidence.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["route_step", "telemetry"]),
    );
    expect(result.missing_evidence.some((item) => item.component_id === "email_draft")).toBe(true);
    expect(result.corpus_contract_candidate).toBeNull();
  });

  it("fails external writes observed before approval and emits human-gated candidates", () => {
    const result = replayPlanPassport(PASSPORT, {
      ...PASSING_RUN,
      events: [
        { type: "send", component_id: "optional_email_send" },
        { type: "approval", component_id: "human_approval_gate", approved: true },
      ],
    });

    expect(result.status).toBe("fail");
    expect(result.drift_chips).toContainEqual(
      expect.objectContaining({
        kind: "approval",
        severity: "fail",
        component_id: "optional_email_send",
      }),
    );
    expect(result.corpus_contract_candidate).toEqual(
      expect.objectContaining({ human_gate: "required" }),
    );
    expect(result.linear_issue_candidate).toEqual(
      expect.objectContaining({
        human_gate: "required",
        labels: expect.arrayContaining(["plan-replay", "human-gated"]),
      }),
    );
  });
});
