import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";

const SAFETY_GATE_ID = "human_approval_gate";
const AUDIT_LOG_ID = "audit_log";
const SCHEMA_VALIDATION_ID = "schema_validation";
const AUTH_FAILURE_HANDLER_ID = "auth_failure_handler";

/**
 * External-integration components that authenticate with an expirable credential
 * (token / API key / OAuth scope). When any is present the route should carry a
 * credential-failure path so it degrades gracefully instead of dying silently
 * (MAR-117). Includes data_scraper — a read-side pull that still uses credentials.
 */
const NEEDS_AUTH_FAILURE_HANDLER = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  "data_scraper",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
  "webhook_trigger",
  "chat_trigger",
  "airtable_lookup",
  "stripe_data_read",
]);

/** External-write components that always require human_approval_gate. */
export const ALWAYS_REQUIRES_GATE = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
]);

/** External-write components that always require audit_log. */
const ALWAYS_RECOMMEND_AUDIT = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
  "reviewer_notification",
  // saga_compensation executes undo calls against external systems — the compensation
  // audit trail is the only record of what was reversed and whether it succeeded.
  "saga_compensation",
]);

/**
 * External-write components that must always be preceded by schema_validation
 * (MAR-89). This is a policy rule; schema_validation__before__external_publish
 * also codifies it as a registry edge (must_run_before), but the policy rule
 * ensures the other two components are covered even without an explicit edge.
 */
const ALWAYS_REQUIRES_VALIDATION = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
]);

export type AugmentResult = {
  components: Component[];
  added_gates: string[];
  added_audit: boolean;
  /** true when schema_validation was injected because an external-write component is present. */
  added_validation: boolean;
  /** true when auth_failure_handler was injected for an external-integration component (MAR-117). */
  added_auth_handler: boolean;
  /**
   * IDs of components added by the prerequisite chain walk (requires /
   * must_run_before edges on augmenter-added components).
   */
  added_by_chain: string[];
};

/**
 * Adds human_approval_gate, schema_validation and audit_log to the component
 * list when the selected set includes high-risk external-write actions, and
 * walks the requires / must_run_before chains of any augmenter-added component
 * to ensure transitive prerequisites are satisfied (MAR-89).
 *
 * Rules:
 * 1. If any component is in ALWAYS_REQUIRES_GATE → add human_approval_gate.
 * 2. Any requires edge from a selected component to human_approval_gate → add gate.
 * 3. Any high/critical risk component without a gate → add gate.
 * 4. If any component is in ALWAYS_REQUIRES_VALIDATION → add schema_validation.
 * 5. If any component is in ALWAYS_RECOMMEND_AUDIT → add audit_log.
 * 6. Walk requires + must_run_before chains for all augmenter-added components
 *    (worklist) until stable.
 */
export function augmentWithSafety(
  selected: Component[],
  edges: Edge[],
  allComponents: Component[],
  mustAvoid: Set<string> = new Set(),
): AugmentResult {
  const selectedIds = new Set(selected.map((c) => c.id));
  const added_gates: string[] = [];
  let added_audit = false;
  let added_validation = false;
  let added_auth_handler = false;
  const added_by_chain: string[] = [];

  const findComponent = (id: string): Component | undefined =>
    allComponents.find((c) => c.id === id);

  /** Add a component (by ID) to the working set if not already present. */
  const inject = (id: string): boolean => {
    if (selectedIds.has(id) || mustAvoid.has(id)) return false;
    const comp = findComponent(id);
    if (!comp) return false;
    selected = [...selected, comp];
    selectedIds.add(id);
    return true;
  };

  // ── Rule 1: always add gate for dangerous external write components ──
  let needsGate = selected.some((c) => ALWAYS_REQUIRES_GATE.has(c.id));

  // ── Rule 2: requires edges → human_approval_gate ──
  if (!needsGate) {
    needsGate = edges.some(
      (e) =>
        selectedIds.has(e.from) &&
        e.to === SAFETY_GATE_ID &&
        (e.relation === "requires" || e.relation === "safer_with"),
    );
  }

  // ── Rule 3: any high/critical risk component without a gate ──
  if (!needsGate) {
    needsGate = selected.some(
      (c) => c.risk_level === "high" || c.risk_level === "critical",
    );
  }

  if (needsGate && inject(SAFETY_GATE_ID)) {
    added_gates.push(SAFETY_GATE_ID);
  }

  // ── Rule 4: always add schema_validation for external-write components ──
  const needsValidation = selected.some((c) => ALWAYS_REQUIRES_VALIDATION.has(c.id));
  if (needsValidation && inject(SCHEMA_VALIDATION_ID)) {
    added_validation = true;
  }

  // ── Rule 5: add audit_log for external actions ──
  const needsAudit = selected.some((c) => ALWAYS_RECOMMEND_AUDIT.has(c.id));
  if (needsAudit && inject(AUDIT_LOG_ID)) {
    added_audit = true;
  }

  // ── Rule 5b: add auth_failure_handler for external-integration components (MAR-117) ──
  const needsAuthHandler = selected.some((c) => NEEDS_AUTH_FAILURE_HANDLER.has(c.id));
  if (needsAuthHandler && inject(AUTH_FAILURE_HANDLER_ID)) {
    added_auth_handler = true;
  }

  // ── Rule 6: prerequisite chain walk for augmenter-added components ──
  //
  // Walk requires edges (comp → dep: comp needs dep) and reverse
  // must_run_before edges (dep must_run_before comp: comp needs dep as
  // prerequisite) for every component added above. Repeat until stable
  // (worklist BFS). This ensures transitive safety dependencies are satisfied
  // and catches any future must_run_before patterns beyond schema_validation.
  //
  // Scope: ONLY augmenter-added components are the seeds. The composer's
  // Step 3 already walked requires for the matcher-selected set before calling
  // us, so we avoid redundant expansion of the business-logic components.

  const augmenterAddedIds = new Set<string>([
    ...(added_gates.length > 0 ? [SAFETY_GATE_ID] : []),
    ...(added_validation ? [SCHEMA_VALIDATION_ID] : []),
    ...(added_audit ? [AUDIT_LOG_ID] : []),
    ...(added_auth_handler ? [AUTH_FAILURE_HANDLER_ID] : []),
  ]);

  const worklist = [...augmenterAddedIds];
  const chainVisited = new Set<string>(augmenterAddedIds);

  while (worklist.length > 0) {
    const currentId = worklist.shift()!;

    for (const edge of edges) {
      let prereqId: string | null = null;

      // Forward requires: currentId requires some dep
      if (edge.relation === "requires" && edge.from === currentId) {
        prereqId = edge.to;
      }

      // Backward must_run_before: some dep must_run_before currentId
      if (edge.relation === "must_run_before" && edge.to === currentId) {
        prereqId = edge.from;
      }

      if (!prereqId || chainVisited.has(prereqId) || mustAvoid.has(prereqId)) {
        continue;
      }

      chainVisited.add(prereqId);

      if (inject(prereqId)) {
        added_by_chain.push(prereqId);
        worklist.push(prereqId);
      }
    }
  }

  return { components: selected, added_gates, added_audit, added_validation, added_auth_handler, added_by_chain };
}
