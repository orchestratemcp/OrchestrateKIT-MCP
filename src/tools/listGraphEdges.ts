import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { EDGE_RELATIONS } from "../registry/edgeSchema.js";
import { RISK_LEVELS } from "../registry/sharedSchemas.js";
import { okResponse, toMcpContent } from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  from_component_id: z.string().optional().describe(
    "Filter edges by source component id",
  ),
  to_component_id: z.string().optional().describe(
    "Filter edges by target component id",
  ),
  relation: z.enum(EDGE_RELATIONS).optional().describe(
    "Filter by relation type: produces_input_for | requires | safer_with | must_run_before | recommended_for | compatible_with | tested_with | avoid_when | conflicts_with | can_run_parallel",
  ),
  severity: z.enum(RISK_LEVELS).optional().describe(
    "Filter by severity level: low | medium | high | critical",
  ),
  include_beta: z.boolean().default(false).describe(
    "Include beta-status edges. Default false.",
  ),
  max_results: z.number().int().min(1).max(200).default(30).describe(
    "Maximum number of results to return. Default 30.",
  ),
};

export function registerListGraphEdges(server: McpServer): void {
  server.registerTool(
    "list_graph_edges",
    {
      title: "List Graph Edges",
      description:
        "Lists workflow graph edges (relations between components). " +
        "Filter by source/target component, relation type or severity. " +
        "Use this to understand what edges exist between components before designing a workflow.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: input.include_beta });
        let edges = registry.edges;

        if (input.from_component_id !== undefined) {
          edges = edges.filter((e) => e.from === input.from_component_id);
        }
        if (input.to_component_id !== undefined) {
          edges = edges.filter((e) => e.to === input.to_component_id);
        }
        if (input.relation !== undefined) {
          edges = edges.filter((e) => e.relation === input.relation);
        }
        if (input.severity !== undefined) {
          edges = edges.filter((e) => e.severity === input.severity);
        }

        const limited = edges.slice(0, input.max_results);

        const data = limited.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          relation: e.relation,
          severity: e.severity,
          reason: e.reason,
          condition: e.condition,
          status: e.status,
          tested: e.tested,
        }));

        const lines = [
          `**${data.length} edge(s) matched** (total in registry: ${registry.edges.length})`,
        ];
        for (const e of data) {
          lines.push(
            `\n- \`${e.from}\` **→** \`${e.to}\` [\`${e.relation}\`, severity: \`${e.severity}\`] — ${e.reason.split(".")[0]}.`,
          );
        }

        const warnings: string[] = [];
        if (edges.length > input.max_results) {
          warnings.push(
            `${edges.length - input.max_results} additional edges were truncated. Add filters or increase max_results.`,
          );
        }

        logger.debug(`list_graph_edges → ${data.length} results`);
        return toMcpContent(
          okResponse(lines.join(""), data, warnings, [
            "get_graph_edge",
            "get_graph_component",
          ]),
        );
      } catch (err) {
        logger.error("list_graph_edges failed", err);
        return toErrorResult(err);
      }
    },
  );
}
