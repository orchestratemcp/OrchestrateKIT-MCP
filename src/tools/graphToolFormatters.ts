import type { Edge } from "../registry/edgeSchema.js";

export type GraphToolStatus = "ok" | "not_found" | "low_confidence";

/**
 * Inline edge evidence object (MAR-92).
 * Included directly in compose/get_route/get_playbook responses so models
 * never need to fetch a separate edge lookup to assess whether an edge is
 * tested, critical, or has a suggested test action.
 */
export type InlineEdgeSummary = {
  edge_id: string;
  from: string;
  to: string;
  relation: string;
  severity: string;
  tested: boolean;
  test_refs: string[];
  condition: string;
  /**
   * Suggested next action.  Empty string when the edge is already tested.
   * For untested critical edges the string begins with "CRITICAL —".
   */
  test_action: string;
};

function generateTestAction(edge: Edge): string {
  const prefix =
    edge.severity === "critical" ? "CRITICAL — Add regression test" : "Add integration test";
  const condSuffix = edge.condition ? ` (condition: ${edge.condition})` : "";
  return `${prefix} for \`${edge.from}\` ${edge.relation} \`${edge.to}\`${condSuffix}`;
}

/** Map a full edge registry object to an inline evidence summary. */
export function toInlineEdgeSummary(edge: Edge): InlineEdgeSummary {
  return {
    edge_id: edge.id,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    severity: edge.severity,
    tested: edge.tested,
    test_refs: edge.test_refs,
    condition: edge.condition,
    test_action: edge.tested ? "" : generateTestAction(edge),
  };
}

/**
 * Render a numbered markdown checklist of untested edges, critical ones first.
 * Returns an empty string when there are no untested edges.
 */
export function criticalUntestedChecklist(edges: InlineEdgeSummary[]): string {
  const untested = edges.filter((e) => !e.tested);
  if (untested.length === 0) return "";

  const critical = untested.filter((e) => e.severity === "critical");
  const rest = untested.filter((e) => e.severity !== "critical");
  const ordered = [...critical, ...rest];

  const lines = ["", `### ⚠️ Untested edges — action required (${untested.length})`];
  ordered.forEach((e, i) => {
    lines.push(`${i + 1}. **\`${e.edge_id}\`** [\`${e.severity}\`] — ${e.test_action}`);
  });
  return lines.join("\n");
}

export type GraphToolResponse = {
  status: GraphToolStatus;
  summary_markdown: string;
  data: unknown;
  warnings: string[];
  next_recommended_tools: string[];
};

export function okResponse(
  summary_markdown: string,
  data: unknown,
  warnings: string[] = [],
  next_recommended_tools: string[] = [],
): GraphToolResponse {
  return { status: "ok", summary_markdown, data, warnings, next_recommended_tools };
}

export function notFoundResponse(
  entityType: string,
  id: string,
): GraphToolResponse {
  return {
    status: "not_found",
    summary_markdown: `**${entityType} not found:** \`${id}\` does not exist in the published registry.`,
    data: {},
    warnings: [`No ${entityType} with id "${id}" found in the published/validated registry.`],
    next_recommended_tools: [`list_graph_components`, `list_graph_edges`, `list_known_routes`],
  };
}

export function toMcpContent(response: GraphToolResponse): {
  content: [{ type: "text"; text: string }];
} {
  return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
}

/** Collect status warnings for beta/deprecated entities. */
export function statusWarnings(status: string, entityType: string, id: string): string[] {
  if (status === "deprecated") {
    return [`⚠️  ${entityType} "${id}" is deprecated. Avoid using it in new workflows.`];
  }
  if (status === "beta") {
    return [`⚠️  ${entityType} "${id}" is beta. Behaviour may change. Test thoroughly before relying on it.`];
  }
  return [];
}
