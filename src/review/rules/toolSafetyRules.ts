import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";

// ---------------------------------------------------------------------------
// Rule 1: Vague tool descriptions
// ---------------------------------------------------------------------------

const vagueToolDescriptions: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];

  for (const tool of ctx.userTools) {
    const desc = tool.description ?? "";
    const isTooShort = desc.trim().length < 20;
    const isMissing = desc.trim().length === 0;

    if (isMissing) {
      findings.push({
        severity: "low",
        category: "tool_safety",
        message: `Tool "${tool.name}" has no description.`,
        reason:
          "Tools without descriptions are hard to reason about during review and " +
          "make it difficult to verify that the tool is being used correctly.",
        recommended_fix: `Add a clear description to "${tool.name}" explaining what it does, what it accesses and what its side effects are.`,
      });
    } else if (isTooShort) {
      findings.push({
        severity: "low",
        category: "tool_safety",
        message: `Tool "${tool.name}" has a very short description (${desc.trim().length} chars).`,
        reason:
          "Short descriptions do not convey enough information to evaluate risk or correctness.",
        recommended_fix: `Expand the description for "${tool.name}" to at least 20 characters. Include what data it accesses and any side effects.`,
      });
    }
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Rule 2: Write side-effects without declared permissions
// ---------------------------------------------------------------------------

const writeToolWithoutPermissions: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];

  const WRITE_KEYWORDS = ["write", "send", "publish", "create", "update", "delete", "post", "push"];

  for (const tool of ctx.userTools) {
    const sideEffects = tool.side_effects ?? [];
    const hasWriteSideEffect = sideEffects.some((s) =>
      WRITE_KEYWORDS.some((kw) => s.toLowerCase().includes(kw)),
    );
    const nameImpliesWrite = WRITE_KEYWORDS.some((kw) =>
      tool.name.toLowerCase().includes(kw),
    );

    if (hasWriteSideEffect || nameImpliesWrite) {
      const hasPermissions = (tool.permissions ?? []).length > 0;

      if (!hasPermissions) {
        findings.push({
          severity: "medium",
          category: "tool_safety",
          message: `Tool "${tool.name}" has write/send side effects but no permissions declared.`,
          reason:
            "Write tools without explicit permission scopes risk over-broad access. " +
            "Undeclared permissions make security review impossible.",
          recommended_fix: `Add a permissions list to "${tool.name}" (e.g. ["write:email", "write:calendar"]). Use the minimum scope required.`,
        });
      }
    }
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Rule 3: Missing idempotency note for tools that call external APIs
// ---------------------------------------------------------------------------

const missingIdempotencyForApiTools: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];

  const API_KEYWORDS = ["api", "http", "request", "fetch", "call", "webhook"];

  for (const tool of ctx.userTools) {
    const desc = (tool.description ?? "").toLowerCase();
    const isApiTool = API_KEYWORDS.some((kw) => desc.includes(kw) || tool.name.toLowerCase().includes(kw));

    if (!isApiTool) continue;

    const hasIdempotencyNote =
      desc.includes("idempotent") ||
      desc.includes("retry") ||
      desc.includes("deduplicate") ||
      (tool.side_effects ?? []).some((s) => s.toLowerCase().includes("idempotent"));

    if (!hasIdempotencyNote) {
      findings.push({
        severity: "low",
        category: "tool_safety",
        message: `Tool "${tool.name}" calls an external API but has no idempotency/retry guidance.`,
        reason:
          "External API calls that are retried without idempotency keys can cause duplicate actions " +
          "(duplicate payments, duplicate emails, duplicate records).",
        recommended_fix: `Document whether "${tool.name}" is idempotent. If not, add an idempotency key strategy or deduplicate on the consumer side.`,
      });
    }
  }

  return findings;
};

export const toolSafetyRules: ReviewRule[] = [
  vagueToolDescriptions,
  writeToolWithoutPermissions,
  missingIdempotencyForApiTools,
];
