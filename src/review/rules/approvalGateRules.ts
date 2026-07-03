import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";
import { isNegatedInContext } from "../../graph/capabilityMatcher.js";

// ---------------------------------------------------------------------------
// External write keywords in integrations / goal / architecture text
// ---------------------------------------------------------------------------

const EXTERNAL_WRITE_KEYWORDS = [
  "publish",
  "send email",
  "send_email",
  "email",
  "calendar",
  "calendar_write",
  "slack",
  "post to",
  "tweet",
  "notify",
  "webhook",
  "sms",
];

/**
 * MAR-252: negation-aware. "No emails, no social posts" is a CONSTRAINT, not a
 * write — the negation-blind scan made a read-only news-digest goal fail the
 * safety review for an "ungated external write" while automation_clearance
 * simultaneously said "L0 — may run unattended" (audit G3, the three-way
 * front-matter contradiction). A keyword only counts when it is not negated.
 */
function mentionsExternalWrite(text: string): boolean {
  const lower = text.toLowerCase();
  return EXTERNAL_WRITE_KEYWORDS.some(
    (kw) => lower.includes(kw) && !isNegatedInContext(lower, kw),
  );
}

// ---------------------------------------------------------------------------
// Rule 1: External write integration without approval gate
// ---------------------------------------------------------------------------

const externalWriteWithoutApprovalGate: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  const triggeredByIntegration = ctx.integrations.some((i) =>
    EXTERNAL_WRITE_KEYWORDS.some((kw) => i.toLowerCase().includes(kw)),
  );
  const triggeredByComponent = ctx.hasExternalWrite;
  const triggeredByGoal = mentionsExternalWrite(ctx.goal);
  const triggeredByArch = ctx.proposedArchitecture
    ? mentionsExternalWrite(ctx.proposedArchitecture)
    : false;
  const triggeredByTools = ctx.userTools.some(
    (t) =>
      (t.side_effects ?? []).some((s) => mentionsExternalWrite(s)) ||
      mentionsExternalWrite(t.name),
  );

  const triggered =
    triggeredByIntegration ||
    triggeredByComponent ||
    triggeredByGoal ||
    triggeredByArch ||
    triggeredByTools;

  if (!triggered) return [];

  const alreadyHasGate =
    ctx.hasHumanApprovalGate ||
    ctx.humanApprovalRequired ||
    (ctx.humanApprovalDeclared &&
      (ctx.humanApprovalRequired !== false));

  if (alreadyHasGate) return [];

  return [
    {
      severity: "critical",
      category: "approval_gate",
      message:
        "External write/send/publish action detected without a human approval gate.",
      reason:
        "Publishing, sending emails, writing to calendars or posting to external services are irreversible. " +
        "Automated workflows must require explicit human sign-off before executing these actions.",
      recommended_fix:
        "Add `human_approval_gate` before any external_publish, optional_email_send or calendar_write step. " +
        "Set human_approval.required=true and list the approval_points explicitly.",
      entity_ref: ctx.hasExternalWrite
        ? {
            entity_type: "component" as const,
            entity_id:
              ctx.resolvedComponents.find((c) =>
                ["external_publish", "optional_email_send", "calendar_write"].includes(c.id),
              )?.id ?? "external_publish",
          }
        : undefined,
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 2: human_approval.required=false but has external write components
// ---------------------------------------------------------------------------

const approvalExplicitlyDisabledWithWrite: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (!ctx.humanApprovalDeclared) return [];
  if (ctx.humanApprovalRequired !== false) return [];

  const hasWrite =
    ctx.hasExternalWrite ||
    ctx.integrations.some((i) =>
      EXTERNAL_WRITE_KEYWORDS.some((kw) => i.toLowerCase().includes(kw)),
    );

  if (!hasWrite) return [];

  return [
    {
      severity: "critical",
      category: "approval_gate",
      message:
        "human_approval.required is explicitly set to false, but the workflow includes external write actions.",
      reason:
        "Disabling human approval for irreversible external actions is a critical safety gap. " +
        "A bug or hallucination in any upstream step could trigger unintended publishes or sends.",
      recommended_fix:
        "Set human_approval.required=true and add approval_points for every external write action. " +
        "If speed is a requirement, implement a dry-run mode first and approve the output before live execution.",
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 3: High/critical risk level but no approval gate
// ---------------------------------------------------------------------------

const highRiskWithoutApprovalGate: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  if (ctx.riskLevel !== "high" && ctx.riskLevel !== "critical") return [];

  const alreadyHasGate =
    ctx.hasHumanApprovalGate || ctx.humanApprovalRequired;

  if (alreadyHasGate) return [];

  return [
    {
      severity: "high",
      category: "approval_gate",
      message: `Risk level is \`${ctx.riskLevel}\` but no human approval gate is declared.`,
      reason:
        "High and critical risk workflows must include at least one human review checkpoint " +
        "before any action that cannot be undone.",
      recommended_fix:
        "Add human_approval_gate as a component and set human_approval.required=true. " +
        "Define at least one approval_point describing what the reviewer should check.",
    },
  ];
};

export const approvalGateRules: ReviewRule[] = [
  externalWriteWithoutApprovalGate,
  approvalExplicitlyDisabledWithWrite,
  highRiskWithoutApprovalGate,
];
