import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryProvider.js";
import {
  okResponse,
  notFoundResponse,
  statusWarnings,
  toMcpContent,
} from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  edge_id: z.string().min(1).describe(
    "The id of the edge to retrieve (e.g. 'external_publish__requires__human_approval_gate')",
  ),
};

export function registerGetGraphEdge(server: McpServer): void {
  server.registerTool(
    "get_graph_edge",
    {
      title: "Get Graph Edge",
      description:
        "Returns full details for a single workflow graph edge by id. " +
        "Includes the relation type, severity, reason, notes and any conditions. " +
        "Use list_graph_edges to find edge ids.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });
        const edge = registry.edges.find((e) => e.id === input.edge_id);

        if (!edge) {
          logger.debug(`get_graph_edge → not_found: ${input.edge_id}`);
          return toMcpContent(notFoundResponse("edge", input.edge_id));
        }

        const warnings = statusWarnings(edge.status, "edge", edge.id);

        const data = {
          id: edge.id,
          from: edge.from,
          to: edge.to,
          relation: edge.relation,
          severity: edge.severity,
          status: edge.status,
          reason: edge.reason,
          condition: edge.condition,
          tested: edge.tested,
        };

        const lines = [
          `## Edge: \`${edge.from}\` → \`${edge.to}\``,
          ``,
          `**Relation:** \`${edge.relation}\` | **Severity:** \`${edge.severity}\` | **Status:** \`${edge.status}\``,
          ``,
          `**Why:** ${edge.reason}`,
        ];

        if (edge.condition) {
          lines.push(``, `**Condition:** ${edge.condition}`);
        }

        logger.debug(`get_graph_edge → ${edge.id}`);
        return toMcpContent(
          okResponse(lines.join("\n"), data, warnings, [
            "get_graph_component",
            "list_graph_edges",
          ]),
        );
      } catch (err) {
        logger.error("get_graph_edge failed", err);
        return toErrorResult(err);
      }
    },
  );
}
