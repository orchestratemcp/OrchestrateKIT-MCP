export type GraphToolStatus = "ok" | "not_found" | "low_confidence";

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
