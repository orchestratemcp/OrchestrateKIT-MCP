import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";

// ---------------------------------------------------------------------------
// Rule 1: Multi-step workflow without persistent state
// ---------------------------------------------------------------------------

const multiStepWithoutPersistentState: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (!ctx.isMultiStep) return [];
  if (ctx.hasPersistentState) return [];

  // Skip if the workflow is clearly ephemeral (no long-running or async operations)
  const goalLower = ctx.goal.toLowerCase();
  const isEphemeral =
    goalLower.includes("one-shot") ||
    goalLower.includes("single request") ||
    goalLower.includes("stateless");

  if (isEphemeral) return [];

  return [
    {
      severity: "medium",
      category: "state",
      message:
        "Multi-step workflow has no persistent state store declared.",
      reason:
        "Workflows with more than 3 steps or 2 agents need a state store to track progress, " +
        "enable resumption after failures and avoid reprocessing already-completed steps.",
      recommended_fix:
        "Add `state_store` component (SQLite for local, Supabase/Postgres for hosted). " +
        "Save a checkpoint after each step so the workflow can resume from the last successful stage.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: "state_store",
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 2: Missing retry policy for workflows with external calls
// ---------------------------------------------------------------------------

const missingRetryForExternalCalls: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const hasExternalDependency =
    ctx.hasExternalWrite ||
    ctx.hasDataScraper ||
    ctx.integrations.length > 0 ||
    ctx.userTools.some((t) =>
      (t.permissions ?? []).some((p) =>
        p.toLowerCase().includes("external") ||
        p.toLowerCase().includes("http") ||
        p.toLowerCase().includes("api"),
      ),
    );

  if (!hasExternalDependency) return [];

  const hasRetry = ctx.hasRetryPolicy;
  if (hasRetry) return [];

  return [
    {
      severity: "medium",
      category: "state",
      message: "External API/network calls present without a retry policy.",
      reason:
        "External HTTP calls fail transiently (rate limits, timeouts, network blips). " +
        "Without exponential backoff and a max-retry limit, a single failure will halt the whole workflow.",
      recommended_fix:
        "Add `retry_policy` component with exponential backoff (base 1s, max 30s, max 3 attempts). " +
        "For scraping workloads, respect HTTP 429 Retry-After headers.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: "retry_policy",
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 3: Missing audit log for sensitive actions
// ---------------------------------------------------------------------------

const missingSensitiveActionAuditLog: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const isSensitive =
    ctx.hasExternalWrite ||
    ctx.integrations.length > 0 ||
    ctx.riskLevel === "high" ||
    ctx.riskLevel === "critical";

  if (!isSensitive) return [];
  if (ctx.hasAuditLog) return [];

  return [
    {
      severity: "low",
      category: "state",
      message: "No audit log declared for a workflow with external actions or high risk.",
      reason:
        "External actions and high-risk workflows should produce an immutable audit trail " +
        "for debugging, compliance and incident response.",
      recommended_fix:
        "Add `audit_log` component. Write a structured JSON entry after each external action " +
        "containing: action type, payload summary, actor, timestamp and outcome.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: "audit_log",
      },
    },
  ];
};

export const stateRules: ReviewRule[] = [
  multiStepWithoutPersistentState,
  missingRetryForExternalCalls,
  missingSensitiveActionAuditLog,
];
