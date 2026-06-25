/**
 * automation_clearance — L0–L4 safety levels (MAR-168).
 *
 * Answers "when is it safe to run this without a human hand?" HONESTLY: a level
 * EARNED by evidence, never auto-executed. OrchestrateMCP ADVISES "safe
 * unattended"; it never drops the gate itself.
 *
 * The level is the highest blast-radius ACTION CLASS across the route's
 * components (from ChatGPT's review — tied to blast radius, not generic risk):
 *
 *   L0  read-only, no external side effects        → no human needed
 *   L1  internal write, reversible, idempotent      → usually no
 *   L2  external notification, low-risk, rate-limited→ maybe no AFTER tests
 *   L3  external write to a business system          → human by default
 *   L4  money / legal / health / deletion / publish  → ALWAYS human
 *
 * Hard rule: a gate may only be dropped when the workflow has bounded
 * permissions, dry-run, test coverage, idempotency, rollback, audit log and a
 * kill switch. We compute the controls we can SEE in the design (audit_log,
 * rollback/saga, tested edges) and LIST the ones a stateless advisor cannot
 * verify (dry-run, idempotency, kill switch, scoped creds) — never claiming an
 * L3/L4 gate-drop is safe on faith. The score rises as routes earn `validated`
 * status from logged ships (the flywheel), which raises L2 autonomy.
 */
import type { Component } from "../registry/componentSchema.js";
import type { RegistrySnapshot, UntestedEdge } from "./routeComposer.js";

export type ClearanceLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type AutomationClearance = {
  level: ClearanceLevel;
  autonomous_allowed: boolean;
  reason: string;
  required_controls: string[];
  /** Components that drove the level (the highest action class present). */
  highest_action_components: string[];
};

/**
 * L4 — money / legal / health / irreversible deletion / public publish. The set
 * grows as such components are added; today only public publishing qualifies.
 */
const L4_COMPONENTS = new Set<string>(["external_publish"]);

/**
 * L2 — notifications (low-risk, rate-limited). Overrides the generic
 * external-write rule so a Slack ping or a reviewer alert is treated as a
 * notification, not an L3 business-system write — its blast radius is a message,
 * not a record change.
 */
const NOTIFICATION_COMPONENTS = new Set<string>([
  "slack_notification",
  "reviewer_notification",
]);

/** The blast-radius action class (0–4) of a single component. */
export function componentActionClass(c: Component): 0 | 1 | 2 | 3 | 4 {
  if (L4_COMPONENTS.has(c.id)) return 4;
  if (NOTIFICATION_COMPONENTS.has(c.id)) return 2;
  const writesExternal =
    c.permissions.write.length > 0 &&
    (c.category === "integration" || c.category === "output");
  if (writesExternal) return 3;
  // High-risk orchestration components that coordinate external writes should
  // be L3, not L1. The canonical case is saga_compensation: it triggers
  // external undo calls (API deletes, refunds, record reversals) that are
  // irreversible if compensation itself fails. The `orchestration` category
  // doesn't match the integration/output check above, but risk_level:"high"
  // is the registry's explicit signal that this component's blast radius
  // extends outside the system boundary.
  if (c.risk_level === "high" && c.permissions.write.length > 0) return 3;
  // internal write: a state component, or anything declaring a write that is
  // not an external integration (reversible/internal).
  if (c.category === "state" || c.permissions.write.length > 0) return 1;
  return 0;
}

const LEVELS: ClearanceLevel[] = ["L0", "L1", "L2", "L3", "L4"];

/**
 * Compute the automation clearance for a route. Deterministic, registry-driven.
 * `untestedEdges` is the route's untested-edge set (test-coverage signal).
 */
export function computeAutomationClearance(
  routeComponentIds: string[],
  registry: RegistrySnapshot,
  untestedEdges: UntestedEdge[],
): AutomationClearance {
  const byId = new Map(registry.components.map((c) => [c.id, c]));
  const classed = routeComponentIds
    .map((id) => byId.get(id))
    .filter((c): c is Component => c !== undefined)
    .map((c) => ({ id: c.id, cls: componentActionClass(c) }));

  let maxClsN = 0;
  for (const c of classed) maxClsN = Math.max(maxClsN, c.cls);
  const maxCls = maxClsN as 0 | 1 | 2 | 3 | 4;
  const level = LEVELS[maxCls];
  const highest_action_components = classed
    .filter((c) => c.cls === maxCls)
    .map((c) => c.id);

  const hasAudit = routeComponentIds.includes("audit_log");
  const hasRollback = routeComponentIds.includes("saga_compensation");
  const testCovered = untestedEdges.length === 0;

  // ── unverifiable-by-a-stateless-advisor controls (the builder must confirm) ──
  const RUNTIME_CONTROLS = [
    "bounded permissions (least-privilege scopes)",
    "dry-run / preview before any live action",
    "idempotency (safe to retry)",
    "kill switch (operator can halt the run)",
  ];

  const designControl = (present: boolean, label: string, fix: string): string =>
    present ? `${label} — present` : `${label} — MISSING, ${fix}`;

  let autonomous_allowed = false;
  let reason = "";
  let required_controls: string[] = [];

  switch (maxCls) {
    case 0:
      autonomous_allowed = true;
      reason = "Read-only with no external side effects — safe to run unattended.";
      break;
    case 1:
      autonomous_allowed = true;
      reason =
        "Internal, reversible writes only — safe to run unattended; keep the audit log on.";
      required_controls = [designControl(hasAudit, "audit log", "add audit_log")];
      break;
    case 2:
      autonomous_allowed = hasAudit && testCovered;
      reason = autonomous_allowed
        ? "External notification only, with audit logging and tested edges — may run unattended after review."
        : "External notification — may run unattended only AFTER tests pass and audit logging is in place.";
      required_controls = [
        designControl(hasAudit, "audit log", "add audit_log"),
        testCovered
          ? "test coverage — all in-route edges tested"
          : `test coverage — ${untestedEdges.length} untested edge(s) in route, validate them first`,
      ];
      break;
    case 3:
      autonomous_allowed = false;
      reason =
        "External write to a business system — human approval by default. Drop the gate " +
        "only after ALL controls below are in place AND the route has earned validated " +
        "status from logged ships; a stateless advisor cannot confirm that for you.";
      required_controls = [
        designControl(hasAudit, "audit log", "add audit_log"),
        designControl(hasRollback, "rollback / compensation", "add saga_compensation"),
        testCovered
          ? "test coverage — all in-route edges tested"
          : `test coverage — ${untestedEdges.length} untested edge(s) in route`,
        ...RUNTIME_CONTROLS,
      ];
      break;
    case 4:
      autonomous_allowed = false;
      reason =
        "Money / legal / health / deletion / public publish — ALWAYS requires a human. " +
        "This gate is never droppable, regardless of controls or history.";
      required_controls = [
        "human approval is mandatory and non-droppable for this action class",
        designControl(hasAudit, "audit log", "add audit_log"),
        designControl(hasRollback, "rollback / compensation", "add saga_compensation"),
      ];
      break;
  }

  return { level, autonomous_allowed, reason, required_controls, highest_action_components };
}
