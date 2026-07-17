/**
 * Constraint coverage (MAR-250, phase 2) — the scope compiler's honesty layer
 * for CONSTRAINTS, not steps.
 *
 * computeCoverage answers "which goal steps does the route carry?" — token
 * accounting. It cannot see that "two available 30-minute slots", "one
 * Calendar event", "unread" or "only after I approve" are commitments the plan
 * must either ENFORCE in its structure or explicitly hand to the build as
 * acceptance criteria. Before this module those constraints rode along inside
 * matched tokens and "full coverage" overclaimed what the plan actually
 * guarantees (state-of-project review 2026-07-16, §8.5 / P0.5).
 *
 * Deterministic string + route-structure logic — no registry, no LLM.
 *
 * Status vocabulary:
 *   structural — enforced by the route itself (send exclusion, gate ordering,
 *                dedupe/state components present)
 *   delegated  — checkable only in the implementation; emitted as an
 *                acceptance criterion the build brief / evals must carry
 *   missing    — SHOULD be structural but the route does not enforce it
 *   violated   — the route contradicts it
 */

import {
  detectConstraintSignals,
  outboundComponentsExcludedByConstraints,
} from "../lib/constraintSignals.js";

export type ConstraintClass =
  | "prohibition"
  | "ordering"
  | "quantity"
  | "duration"
  | "filter"
  | "exactly_once";

export type ConstraintStatus = "structural" | "delegated" | "missing" | "violated";

export type ConstraintCheck = {
  constraint_class: ConstraintClass;
  /** The goal phrase that carries the constraint — the compiler shows its work. */
  goal_phrase: string;
  status: ConstraintStatus;
  /** How the plan represents the constraint, or why it cannot. */
  representation: string;
  /** Non-null for delegated checks — the build must verify this. */
  acceptance_criterion: string | null;
};

export type ConstraintCoverageLabel = "structural" | "delegated" | "gaps";

export type ConstraintCoverage = {
  checks: ConstraintCheck[];
  structural_count: number;
  delegated_count: number;
  /** missing + violated. Anything above 0 forbids an unqualified "full coverage". */
  problem_count: number;
  // structural — every check is enforced by the route itself.
  // delegated  — no gaps, but some checks can only be verified at build time.
  // gaps       — at least one constraint is missing from or violated by the route.
  constraint_label: ConstraintCoverageLabel;
};

export type ConstraintCoverageInput = {
  goal: string;
  /** Final route component ids in execution order (post no-outbound filtering). */
  executionOrder: string[];
  /** Route components that always require a human gate (external writes). */
  gatedWriteIds: string[];
};

/**
 * Ordering phrases: an approval that must happen BEFORE the plan's writes.
 * Deliberately overlaps APPROVAL_REQUIRED_SIGNALS ("until approved") but adds
 * the "only after I approve" family the golden email/calendar goal actually
 * uses — gate ENFORCEMENT already fires on attended signals; this table only
 * decides whether an explicit before/after commitment exists to check.
 */
const ORDERING_SIGNALS = [
  "only after i approve",
  "only after approval",
  "after i approve",
  "after my approval",
  "after approval",
  "once approved",
  "once i approve",
  "until approved",
  "until i approve",
  "approve before",
  "approval before",
];

/** Filters the implementation must honor when selecting inputs. */
const FILTER_SIGNALS = ["unread", "starred", "flagged", "unresponded", "unanswered"];

/** Explicit exactly-once / no-duplicates language. */
const EXACTLY_ONCE_SIGNALS = [
  "exactly once",
  "only once",
  "no duplicate",
  "no duplicates",
  "without duplicates",
  "never duplicate",
  "idempotent",
];

/** Components whose presence structurally supports exactly-once behavior. */
const EXACTLY_ONCE_COMPONENTS = ["deduplication", "state_store"];

/**
 * Quantities are only extracted when the counted thing is a workflow artifact —
 * a fixed noun list, mirroring coverage.ts's demand lexicon, so "one of the
 * options" or "one click" never false-alarm.
 */
const QUANTITY_NOUNS =
  "(?:slots?|events?|drafts?|emails?|replies|reply|messages?|meetings?|invites?|" +
  "leads?|notes?|tasks?|posts?|pages?|times?|options?|entries|entry|rows?|records?|alerts?)";

const QUANTITY_RE = new RegExp(
  `\\b(?:exactly one|a single|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)` +
    `(?:\\s+\\S+){0,3}?\\s+${QUANTITY_NOUNS}\\b`,
  "gi",
);

const DURATION_RE = /\b\d+[-\s]?(?:minutes?|mins?|hours?|hrs?|days?)\b/gi;

function firstMatch(goalLower: string, phrases: string[]): string | null {
  for (const p of phrases) if (goalLower.includes(p)) return p;
  return null;
}

export function computeConstraintCoverage(input: ConstraintCoverageInput): ConstraintCoverage {
  const { goal, executionOrder, gatedWriteIds } = input;
  const goalLower = goal.toLowerCase();
  const routeIds = new Set(executionOrder);
  const checks: ConstraintCheck[] = [];

  // ── prohibition: no-send / draft-only (structural via P0-02 exclusion) ──
  const signals = detectConstraintSignals(goal);
  if (signals.no_outbound.detected || signals.draft_only.detected) {
    const excluded = outboundComponentsExcludedByConstraints(goal);
    const leaked = executionOrder.filter((id) => excluded.has(id));
    const phrase = signals.no_outbound.trigger ?? signals.draft_only.trigger ?? "no outbound sending";
    checks.push(
      leaked.length > 0
        ? {
            constraint_class: "prohibition",
            goal_phrase: phrase,
            status: "violated",
            representation: `route still contains send component(s): ${leaked.join(", ")}`,
            acceptance_criterion: null,
          }
        : {
            constraint_class: "prohibition",
            goal_phrase: phrase,
            status: "structural",
            representation: `send components structurally absent (${[...excluded].sort().join(", ")})`,
            acceptance_criterion: null,
          },
    );
  }

  // ── prohibition: read-only (uses the §0 read_only class, never no-send) ──
  if (signals.read_only.detected) {
    const phrase = signals.read_only.trigger ?? "read-only";
    checks.push(
      gatedWriteIds.length > 0
        ? {
            constraint_class: "prohibition",
            goal_phrase: phrase,
            status: "violated",
            representation: `route performs external writes: ${gatedWriteIds.join(", ")}`,
            acceptance_criterion: null,
          }
        : {
            constraint_class: "prohibition",
            goal_phrase: phrase,
            status: "structural",
            representation: "route contains no external-write components",
            acceptance_criterion: null,
          },
    );
  }

  // ── ordering: approval must precede the writes ──
  const orderingTrigger =
    firstMatch(goalLower, ORDERING_SIGNALS) ??
    (signals.attended_required.detected ? signals.attended_required.trigger : null);
  if (orderingTrigger && gatedWriteIds.length > 0) {
    const gateIdx = executionOrder.indexOf("human_approval_gate");
    const ordered =
      gateIdx >= 0 && gatedWriteIds.every((id) => executionOrder.indexOf(id) > gateIdx);
    checks.push(
      ordered
        ? {
            constraint_class: "ordering",
            goal_phrase: orderingTrigger,
            status: "structural",
            representation: `human_approval_gate precedes ${gatedWriteIds.join(", ")} in execution order`,
            acceptance_criterion: null,
          }
        : {
            constraint_class: "ordering",
            goal_phrase: orderingTrigger,
            status: "missing",
            representation:
              `goal requires approval before the writes, but the route does not order ` +
              `human_approval_gate before: ${gatedWriteIds.join(", ")}`,
            acceptance_criterion: null,
          },
    );
  }

  // ── quantity: counted artifacts the route cannot encode — delegated ──
  for (const m of goal.match(QUANTITY_RE) ?? []) {
    const phrase = m.trim();
    checks.push({
      constraint_class: "quantity",
      goal_phrase: phrase,
      status: "delegated",
      representation: "counts are not representable in route structure — verify in the implementation",
      acceptance_criterion: `Produce exactly "${phrase}" — no more, no fewer.`,
    });
  }

  // ── duration: "30-minute" and friends — delegated ──
  for (const m of goal.match(DURATION_RE) ?? []) {
    const phrase = m.trim();
    checks.push({
      constraint_class: "duration",
      goal_phrase: phrase,
      status: "delegated",
      representation: "durations are not representable in route structure — verify in the implementation",
      acceptance_criterion: `Honor the "${phrase}" duration exactly.`,
    });
  }

  // ── filter: input-selection constraints ("unread") — delegated ──
  const filterHit = firstMatch(goalLower, FILTER_SIGNALS);
  if (filterHit) {
    checks.push({
      constraint_class: "filter",
      goal_phrase: filterHit,
      status: "delegated",
      representation: "input filters are not representable in route structure — verify in the implementation",
      acceptance_criterion: `Process only inputs matching the "${filterHit}" filter.`,
    });
  }

  // ── exactly-once: needs state — structural only with dedupe/state components ──
  const onceHit = firstMatch(goalLower, EXACTLY_ONCE_SIGNALS);
  if (onceHit) {
    const present = EXACTLY_ONCE_COMPONENTS.filter((id) => routeIds.has(id));
    checks.push(
      present.length > 0
        ? {
            constraint_class: "exactly_once",
            goal_phrase: onceHit,
            status: "structural",
            representation: `route carries ${present.join(" + ")} for exactly-once behavior`,
            acceptance_criterion: null,
          }
        : {
            constraint_class: "exactly_once",
            goal_phrase: onceHit,
            status: "missing",
            representation:
              "exactly-once requires persistent state — add deduplication and/or state_store to the route",
            acceptance_criterion: null,
          },
    );
  }

  const structural_count = checks.filter((c) => c.status === "structural").length;
  const delegated_count = checks.filter((c) => c.status === "delegated").length;
  const problem_count = checks.length - structural_count - delegated_count;
  const constraint_label: ConstraintCoverageLabel =
    problem_count > 0 ? "gaps" : delegated_count > 0 ? "delegated" : "structural";

  return { checks, structural_count, delegated_count, problem_count, constraint_label };
}
