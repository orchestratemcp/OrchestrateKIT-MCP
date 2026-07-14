import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";

/**
 * Category-based default position for components with no ordering edges.
 * Lower = earlier in the workflow.
 */
const CATEGORY_POSITION: Record<string, number> = {
  input: 0,
  integration: 1,
  processing: 2,
  tool: 3,
  eval: 4,
  output: 5,
  safety: 6,
  state: 7,
  orchestration: 8,
};

const ORDERING_RELATIONS = new Set([
  "produces_input_for",
  "must_run_before",
  "requires",
]);

function categoryPosition(component: Component): number {
  // Safety gates always go just before output/integration writes
  if (component.id === "human_approval_gate") return 5.5;
  // Audit log always last
  if (component.id === "audit_log") return 7.5;
  return CATEGORY_POSITION[component.category] ?? 3;
}

/**
 * Topologically sorts components using produces_input_for, must_run_before
 * and requires edges between the selected set. Uses Kahn's algorithm.
 * Ties are broken by category position.
 *
 * Returns the selected components array in execution order.
 */
export function orderComponents(
  components: Component[],
  allEdges: Edge[],
): Component[] {
  if (components.length <= 1) return [...components];

  const ids = new Set(components.map((c) => c.id));

  // Build adjacency (from → Set<to>) and in-degree for the selected subgraph
  const outgoing = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const c of components) {
    outgoing.set(c.id, new Set());
    inDegree.set(c.id, 0);
  }

  for (const edge of allEdges) {
    if (!ORDERING_RELATIONS.has(edge.relation)) continue;
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;

    const targets = outgoing.get(edge.from)!;
    if (!targets.has(edge.to)) {
      targets.add(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  // Kahn's algorithm with category-based tie-breaking
  const componentById = new Map<string, Component>(
    components.map((c) => [c.id, c]),
  );

  const ready = components
    .filter((c) => (inDegree.get(c.id) ?? 0) === 0)
    .sort((a, b) => categoryPosition(a) - categoryPosition(b));

  const result: Component[] = [];

  while (ready.length > 0) {
    // Take from front (already sorted by category position)
    const current = ready.shift()!;
    result.push(current);

    const targets = outgoing.get(current.id) ?? new Set();
    const newReady: Component[] = [];

    for (const targetId of targets) {
      const newDegree = (inDegree.get(targetId) ?? 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) {
        const comp = componentById.get(targetId);
        if (comp) newReady.push(comp);
      }
    }

    // Insert new ready nodes in sorted position
    newReady.sort((a, b) => categoryPosition(a) - categoryPosition(b));
    for (const c of newReady) {
      const insertAt = ready.findIndex(
        (r) => categoryPosition(r) > categoryPosition(c),
      );
      if (insertAt === -1) {
        ready.push(c);
      } else {
        ready.splice(insertAt, 0, c);
      }
    }
  }

  // If cycle detected (result.length < components.length), append remaining
  if (result.length < components.length) {
    const inResult = new Set(result.map((c) => c.id));
    const remaining = components
      .filter((c) => !inResult.has(c.id))
      .sort((a, b) => categoryPosition(a) - categoryPosition(b));
    result.push(...remaining);
  }

  return result;
}

/**
 * Returns the subset of allEdges that connect components within the
 * selected component set (used edges for output reporting).
 */
export function edgesWithinSet(
  componentIds: Set<string>,
  allEdges: Edge[],
): Edge[] {
  return allEdges.filter(
    (e) => componentIds.has(e.from) && componentIds.has(e.to),
  );
}

// ───────────────────────── MAR-90: execution ordering ─────────────────────────

/**
 * Irreversible external-write components. Human approval must always precede
 * these in execution order, and they must run after deterministic validation.
 *
 * MAR-252: the platform notification egresses belong here too — a posted Slack
 * message is as irreversible as a sent email. Their omission put the gate
 * AFTER slack_notification in execution_order (audit G2/G4: `… →
 * slack_notification → human_approval_gate → …`), an order in which the gate
 * physically cannot gate the send.
 */
const IRREVERSIBLE_WRITES = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  // Advancing a deal/pipeline stage is a consequential external CRM mutation,
  // exactly like crm_note_write. Adversarial-batch finding: with deal_stage_update
  // omitted here, computeExecutionOrder never moved human_approval_gate before it,
  // so an approval-gated "advance the deal stage, but check with me first" goal
  // ordered the write ahead of its own gate. Same class as the MAR-252 fix that
  // added the notification egresses below.
  "deal_stage_update",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
]);

/**
 * Relations that impose a real RUNTIME ordering (from runs before to).
 * `requires` is deliberately excluded: it expresses a presence/prerequisite
 * constraint whose runtime direction is ambiguous (e.g.
 * `external_publish requires human_approval_gate` must NOT order publish first,
 * and `research_synthesis requires citation_checker` runs the checker after
 * synthesis). Runtime safety ordering is enforced separately below.
 */
const EXECUTION_ORDER_RELATIONS = new Set(["produces_input_for", "must_run_before"]);

/** Runtime role rank by category (lower = earlier). */
const EXECUTION_RANK_BY_CATEGORY: Record<string, number> = {
  input: 10,
  integration: 15, // read-side integrations (email_read, calendar_lookup)
  orchestration: 25,
  processing: 30,
  tool: 35,
  eval: 40,
  output: 50,
  state: 60,
  safety: 64,
};

/**
 * Runtime rank for a component. Irreversible writes sit just after the safety
 * gate; audit_log is always last; user_goal_intake always first.
 */
function executionRank(component: Component): number {
  if (component.id === "user_goal_intake") return 0;
  if (component.id === "audit_log") return 100;
  if (component.id === "human_approval_gate") return 64;
  if (IRREVERSIBLE_WRITES.has(component.id)) return 70;
  return EXECUTION_RANK_BY_CATEGORY[component.category] ?? 30;
}

/**
 * Computes a RUNTIME-correct execution order (MAR-90), distinct from the
 * topological `planning_order` produced by `orderComponents`.
 *
 * Algorithm:
 * 1. Topological sort over produces_input_for + must_run_before only, with the
 *    runtime role rank as the tie-breaker for ready nodes.
 * 2. Post-pass safety invariants (defensive, independent of edge coverage):
 *    - human_approval_gate is moved to immediately before the earliest
 *      irreversible write, if not already before it.
 *    - audit_log is forced to the very end.
 */
export function computeExecutionOrder(
  components: Component[],
  allEdges: Edge[],
): Component[] {
  if (components.length <= 1) return [...components];

  const ids = new Set(components.map((c) => c.id));
  const outgoing = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const c of components) {
    outgoing.set(c.id, new Set());
    inDegree.set(c.id, 0);
  }

  for (const edge of allEdges) {
    if (!EXECUTION_ORDER_RELATIONS.has(edge.relation)) continue;
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const targets = outgoing.get(edge.from)!;
    if (!targets.has(edge.to)) {
      targets.add(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const componentById = new Map<string, Component>(components.map((c) => [c.id, c]));
  const byRank = (a: Component, b: Component) =>
    executionRank(a) - executionRank(b);

  const ready = components
    .filter((c) => (inDegree.get(c.id) ?? 0) === 0)
    .sort(byRank);

  let result: Component[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    result.push(current);

    const newReady: Component[] = [];
    for (const targetId of outgoing.get(current.id) ?? new Set<string>()) {
      const newDegree = (inDegree.get(targetId) ?? 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) {
        const comp = componentById.get(targetId);
        if (comp) newReady.push(comp);
      }
    }

    newReady.sort(byRank);
    for (const c of newReady) {
      const insertAt = ready.findIndex((r) => executionRank(r) > executionRank(c));
      if (insertAt === -1) ready.push(c);
      else ready.splice(insertAt, 0, c);
    }
  }

  // Cycle fallback: append any remaining components by rank.
  if (result.length < components.length) {
    const inResult = new Set(result.map((c) => c.id));
    result.push(...components.filter((c) => !inResult.has(c.id)).sort(byRank));
  }

  // ── Post-pass invariant 1: approval before earliest irreversible write ──
  const gateIdx = result.findIndex((c) => c.id === "human_approval_gate");
  if (gateIdx !== -1) {
    const firstWriteIdx = result.findIndex((c) => IRREVERSIBLE_WRITES.has(c.id));
    if (firstWriteIdx !== -1 && gateIdx > firstWriteIdx) {
      const [gate] = result.splice(gateIdx, 1);
      result.splice(firstWriteIdx, 0, gate!);
    }
  }

  // ── Post-pass invariant 2: audit_log always last ──
  const auditIdx = result.findIndex((c) => c.id === "audit_log");
  if (auditIdx !== -1 && auditIdx !== result.length - 1) {
    const [audit] = result.splice(auditIdx, 1);
    result.push(audit!);
  }

  return result;
}

export type AvoidViolation = {
  edge_id: string;
  from: string;
  to: string;
  severity: string;
  reason: string;
};

/**
 * Detects `avoid_when` edges whose BOTH endpoints are present in the route
 * (MAR-90). A critical violation should drive the route to `blocked_candidate`.
 *
 * Edges with `bypass_when_all_present` are skipped when ALL listed component IDs
 * are present in the route — this encodes "avoid unless safety guards are in
 * place" (e.g. research_synthesis→external_publish is safe when both
 * citation_checker and human_approval_gate are present).
 */
export function detectAvoidViolations(
  componentIds: Set<string>,
  allEdges: Edge[],
): AvoidViolation[] {
  const violations: AvoidViolation[] = [];
  for (const edge of allEdges) {
    if (edge.relation !== "avoid_when") continue;
    if (!componentIds.has(edge.from) || !componentIds.has(edge.to)) continue;

    // bypass_when_all_present: skip the violation if every listed guard is present
    if (
      edge.bypass_when_all_present.length > 0 &&
      edge.bypass_when_all_present.every((id) => componentIds.has(id))
    ) {
      continue;
    }

    violations.push({
      edge_id: edge.id,
      from: edge.from,
      to: edge.to,
      severity: edge.severity,
      reason: edge.reason,
    });
  }
  return violations;
}
