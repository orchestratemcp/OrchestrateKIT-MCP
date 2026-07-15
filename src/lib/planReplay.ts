import { createHash } from "node:crypto";

export type ReplayStatus = "pass" | "warning" | "fail";

export type ReplaySeverity = "info" | "warning" | "fail";

export type ReplayDriftChip = {
  kind:
    | "route_missing"
    | "route_unplanned"
    | "route_order"
    | "approval"
    | "forbidden_action"
    | "telemetry"
    | "target_mismatch"
    | "checklist_failed";
  severity: ReplaySeverity;
  message: string;
  expected?: string;
  observed?: string;
  component_id?: string;
  test_id?: string;
};

export type MissingReplayEvidence = {
  kind: "route_step" | "approval_gate" | "acceptance_test" | "telemetry" | "build_target";
  severity: "must" | "should";
  message: string;
  component_id?: string;
  test_id?: string;
  evidence_required: string[];
};

export type PlanReplayResult = {
  contract: "orchestratekit.plan_replay.v1";
  status: ReplayStatus;
  plan_contract_id: string;
  replay_fingerprint: string;
  summary_markdown: string;
  drift_chips: ReplayDriftChip[];
  missing_evidence: MissingReplayEvidence[];
  observed_route: string[];
  planned_route: string[];
  suggested_lab_rating: "verified" | "needs_evidence" | "failed";
  lab_evidence: {
    contract: "orchestratekit.lab_evidence.plan_replay.v1";
    source: "plan_replay";
    plan_contract_id: string;
    replay_fingerprint: string;
    evidence_status: "verified" | "needs_evidence" | "failed";
    route_components: string[];
    drift_count: number;
    missing_evidence_count: number;
  };
  corpus_contract_candidate: CorpusContractCandidate | null;
  linear_issue_candidate: LinearIssueCandidate | null;
  provenance_tag: "deterministic-replay";
  grounding_note: string;
};

export type CorpusContractCandidate = {
  contract: "orchestratekit.corpus_contract_candidate.v1";
  source: "plan_replay";
  human_gate: "required";
  goal: string;
  plan_contract_id: string;
  must_have: string[];
  forbidden: string[];
  regression_notes: string[];
};

export type LinearIssueCandidate = {
  title: string;
  labels: string[];
  description_markdown: string;
  human_gate: "required";
};

export type ReplayChecklistItem = {
  id: string;
  status: "pass" | "warning" | "fail" | "missing";
  evidence?: string[];
  notes?: string;
};

export type ReplayEvent = {
  type?: string;
  component_id?: string;
  action?: string;
  status?: string;
  approved?: boolean;
  approval_gate?: string;
  evidence?: string;
  notes?: string;
};

export type ObservedRun = {
  steps?: Array<string | { component_id: string; status?: string; evidence?: string[]; notes?: string }>;
  events?: ReplayEvent[];
  checklist?: ReplayChecklistItem[];
  actual?: {
    build_target?: string;
    hosting?: string;
    monitoring?: string;
  };
  notes?: string[];
};

export type ReplayPlanPassport = {
  contract: "orchestratekit.plan_passport.v1";
  contract_id: string;
  goal: string;
  locked_constraints?: {
    read_only?: boolean;
    draft_only?: boolean;
    no_outbound?: boolean;
  };
  route: {
    components: Array<{ step: number; component_id: string }>;
  };
  safety_gates?: {
    enforced_approval_gates?: string[];
  };
  acceptance_tests?: Array<{
    id: string;
    kind: string;
    assertion: string;
    evidence_required: string[];
    severity: "must" | "should";
  }>;
  build_handoff?: {
    target?: string;
  };
};

const EXTERNAL_WRITE_HINTS = [
  "send",
  "sent",
  "publish",
  "published",
  "post",
  "posted",
  "notify",
  "notification",
  "write",
  "wrote",
  "update",
  "updated",
  "commit",
  "push",
  "merge",
  "delete",
  "calendar_write",
  "crm_note_write",
  "deal_stage_update",
  "external_publish",
  "optional_email_send",
  "slack_notification",
  "teams_notification",
  "telegram_notification",
  "discord_notification",
  "file_storage",
  "vector_store",
  "code_editing",
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function normalizeToken(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function isExternalWriteToken(value: unknown): boolean {
  const token = normalizeToken(value);
  return EXTERNAL_WRITE_HINTS.some((hint) => token.includes(hint));
}

function eventIsApproval(event: ReplayEvent): boolean {
  const haystack = [event.type, event.action, event.component_id, event.approval_gate]
    .map(normalizeToken)
    .join(" ");
  if (event.approved === true) return true;
  return haystack.includes("approval") && !haystack.includes("denied") && event.status !== "fail";
}

function eventIsExternalWrite(event: ReplayEvent): boolean {
  return [event.type, event.action, event.component_id].some(isExternalWriteToken);
}

function componentFromStep(
  step: string | { component_id: string; status?: string; evidence?: string[]; notes?: string },
): string {
  return typeof step === "string" ? step : step.component_id;
}

function observedComponents(observed: ObservedRun): string[] {
  const ids: string[] = [];
  for (const step of observed.steps ?? []) {
    const id = componentFromStep(step);
    if (id) ids.push(id);
  }
  for (const event of observed.events ?? []) {
    if (event.component_id) ids.push(event.component_id);
  }
  return [...new Set(ids)];
}

function routeOrder(observed: ObservedRun): string[] {
  const ids: string[] = [];
  for (const step of observed.steps ?? []) {
    const id = componentFromStep(step);
    if (id) ids.push(id);
  }
  for (const event of observed.events ?? []) {
    if (event.component_id && !ids.includes(event.component_id)) ids.push(event.component_id);
  }
  return ids;
}

function hasEvidenceForTest(testId: string, observed: ObservedRun): ReplayChecklistItem | undefined {
  return (observed.checklist ?? []).find((item) => item.id === testId);
}

function buildSummary(result: {
  status: ReplayStatus;
  chips: ReplayDriftChip[];
  missing: MissingReplayEvidence[];
  planId: string;
}): string {
  const headline =
    result.status === "pass"
      ? "Plan Replay passed."
      : result.status === "fail"
      ? "Plan Replay failed."
      : "Plan Replay needs evidence.";
  const details = [
    `${result.chips.length} drift chip${result.chips.length === 1 ? "" : "s"}`,
    `${result.missing.length} missing evidence item${result.missing.length === 1 ? "" : "s"}`,
  ].join(", ");
  return `**${headline}** Contract \`${result.planId}\`: ${details}.`;
}

function candidateFromFailure(input: {
  passport: ReplayPlanPassport;
  chips: ReplayDriftChip[];
}): { corpus: CorpusContractCandidate; issue: LinearIssueCandidate } {
  const forbidden = input.chips
    .filter((chip) => chip.severity === "fail")
    .map((chip) => chip.message);
  const route = input.passport.route.components
    .sort((left, right) => left.step - right.step)
    .map((step) => step.component_id);
  const regressionNotes = input.chips
    .filter((chip) => chip.severity === "fail")
    .map((chip) => `- ${chip.message}`);
  return {
    corpus: {
      contract: "orchestratekit.corpus_contract_candidate.v1",
      source: "plan_replay",
      human_gate: "required",
      goal: input.passport.goal,
      plan_contract_id: input.passport.contract_id,
      must_have: route,
      forbidden,
      regression_notes: regressionNotes,
    },
    issue: {
      title: `Plan Replay failure: ${input.passport.goal.slice(0, 72)}`,
      labels: ["plan-replay", "human-gated", "mcp-server"],
      human_gate: "required",
      description_markdown: [
        "## Source",
        `Plan Replay for \`${input.passport.contract_id}\` failed deterministically.`,
        "",
        "## Failing evidence",
        ...regressionNotes,
        "",
        "## Human gate",
        "Review this candidate before creating any Linear issue or corpus fixture.",
      ].join("\n"),
    },
  };
}

export function replayPlanPassport(
  passport: ReplayPlanPassport,
  observed: ObservedRun,
): PlanReplayResult {
  const planned = [...passport.route.components]
    .sort((left, right) => left.step - right.step)
    .map((step) => step.component_id);
  const observedIds = observedComponents(observed);
  const observedOrder = routeOrder(observed);
  const chips: ReplayDriftChip[] = [];
  const missing: MissingReplayEvidence[] = [];

  for (const componentId of planned) {
    if (!observedIds.includes(componentId)) {
      missing.push({
        kind: "route_step",
        severity: "should",
        component_id: componentId,
        message: `No observed evidence for planned route component \`${componentId}\`.`,
        evidence_required: [`observed step or event for ${componentId}`],
      });
    }
  }

  for (const componentId of observedIds) {
    if (!planned.includes(componentId)) {
      chips.push({
        kind: "route_unplanned",
        severity: isExternalWriteToken(componentId) ? "fail" : "warning",
        component_id: componentId,
        expected: planned.join(" -> "),
        observed: componentId,
        message: `Observed unplanned component \`${componentId}\`.`,
      });
    }
  }

  let previousPlannedIndex = -1;
  for (const componentId of observedOrder) {
    const plannedIndex = planned.indexOf(componentId);
    if (plannedIndex < 0) continue;
    if (plannedIndex < previousPlannedIndex) {
      chips.push({
        kind: "route_order",
        severity: "warning",
        component_id: componentId,
        expected: planned.join(" -> "),
        observed: observedOrder.join(" -> "),
        message: `Observed \`${componentId}\` out of planned order.`,
      });
      break;
    }
    previousPlannedIndex = plannedIndex;
  }

  const enforcedGates = passport.safety_gates?.enforced_approval_gates ?? [];
  for (const gate of enforcedGates) {
    const gateObserved =
      observedIds.includes(gate) ||
      (observed.events ?? []).some((event) => eventIsApproval(event) && (!event.approval_gate || event.approval_gate === gate)) ||
      (observed.checklist ?? []).some((item) => item.id === gate || item.id === `approval:${gate}`);
    if (!gateObserved) {
      missing.push({
        kind: "approval_gate",
        severity: "must",
        component_id: gate,
        message: `Required approval gate \`${gate}\` has no observed checkpoint.`,
        evidence_required: [`approval event or checklist item for ${gate}`],
      });
    }
  }

  const needsApprovalBeforeWrite =
    enforcedGates.length > 0 || planned.includes("human_approval_gate");
  let approvalSeen = false;
  for (const event of observed.events ?? []) {
    if (eventIsApproval(event)) approvalSeen = true;
    if (needsApprovalBeforeWrite && eventIsExternalWrite(event) && !approvalSeen) {
      chips.push({
        kind: "approval",
        severity: "fail",
        component_id: event.component_id,
        observed: event.action ?? event.type ?? event.component_id,
        message: `External write \`${event.component_id ?? event.action ?? event.type}\` occurred before approval evidence.`,
      });
    }
  }

  if (passport.locked_constraints?.read_only || passport.locked_constraints?.no_outbound) {
    for (const event of observed.events ?? []) {
      if (eventIsExternalWrite(event)) {
        chips.push({
          kind: "forbidden_action",
          severity: "fail",
          component_id: event.component_id,
          observed: event.action ?? event.type ?? event.component_id,
          message: `Observed external action under read-only/no-outbound constraint.`,
        });
      }
    }
  }

  for (const test of passport.acceptance_tests ?? []) {
    const checklist = hasEvidenceForTest(test.id, observed);
    if (!checklist) {
      missing.push({
        kind: test.kind === "observability" ? "telemetry" : "acceptance_test",
        severity: test.severity,
        test_id: test.id,
        message: `No observed evidence for acceptance test \`${test.id}\`.`,
        evidence_required: test.evidence_required,
      });
      continue;
    }
    if (checklist.status === "missing") {
      missing.push({
        kind: test.kind === "observability" ? "telemetry" : "acceptance_test",
        severity: test.severity,
        test_id: test.id,
        message: `Acceptance test \`${test.id}\` is marked missing.`,
        evidence_required: test.evidence_required,
      });
    } else if (checklist.status === "fail") {
      chips.push({
        kind: "checklist_failed",
        severity: test.severity === "must" ? "fail" : "warning",
        test_id: test.id,
        message: `Acceptance test \`${test.id}\` failed: ${checklist.notes ?? test.assertion}`,
      });
    } else if (checklist.status === "warning") {
      chips.push({
        kind: "checklist_failed",
        severity: "warning",
        test_id: test.id,
        message: `Acceptance test \`${test.id}\` has warning evidence: ${checklist.notes ?? test.assertion}`,
      });
    }
  }

  if (passport.build_handoff?.target && observed.actual?.build_target) {
    if (passport.build_handoff.target !== observed.actual.build_target) {
      chips.push({
        kind: "target_mismatch",
        severity: "warning",
        expected: passport.build_handoff.target,
        observed: observed.actual.build_target,
        message: `Observed build target \`${observed.actual.build_target}\` differs from passport target \`${passport.build_handoff.target}\`.`,
      });
    }
  } else if (passport.build_handoff?.target) {
    missing.push({
      kind: "build_target",
      severity: "should",
      message: `No observed build target evidence for passport target \`${passport.build_handoff.target}\`.`,
      evidence_required: ["observed.actual.build_target"],
    });
  }

  const status: ReplayStatus = chips.some((chip) => chip.severity === "fail")
    ? "fail"
    : chips.some((chip) => chip.severity === "warning") || missing.length > 0
    ? "warning"
    : "pass";

  const replay_fingerprint = fingerprint({
    plan_contract_id: passport.contract_id,
    observed,
    chips,
    missing,
  });
  const rating =
    status === "pass" ? "verified" : status === "fail" ? "failed" : "needs_evidence";
  const candidates = status === "fail" ? candidateFromFailure({ passport, chips }) : null;

  return {
    contract: "orchestratekit.plan_replay.v1",
    status,
    plan_contract_id: passport.contract_id,
    replay_fingerprint,
    summary_markdown: buildSummary({
      status,
      chips,
      missing,
      planId: passport.contract_id,
    }),
    drift_chips: chips,
    missing_evidence: missing,
    observed_route: observedOrder,
    planned_route: planned,
    suggested_lab_rating: rating,
    lab_evidence: {
      contract: "orchestratekit.lab_evidence.plan_replay.v1",
      source: "plan_replay",
      plan_contract_id: passport.contract_id,
      replay_fingerprint,
      evidence_status: rating,
      route_components: planned,
      drift_count: chips.length,
      missing_evidence_count: missing.length,
    },
    corpus_contract_candidate: candidates?.corpus ?? null,
    linear_issue_candidate: candidates?.issue ?? null,
    provenance_tag: "deterministic-replay",
    grounding_note:
      "Plan Replay compares a Plan Passport against caller-supplied local event/checklist evidence only. It stores nothing, sends nothing, and uses no LLM.",
  };
}
