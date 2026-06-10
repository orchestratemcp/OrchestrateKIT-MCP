import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { RISK_LEVELS } from "../registry/sharedSchemas.js";
import { okResponse, toMcpContent } from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  risk_level: z.enum(RISK_LEVELS).optional().describe(
    "Filter routes by risk level",
  ),
  include_beta: z.boolean().default(false).describe(
    "Include beta/candidate routes. Default false.",
  ),
};

export function registerListKnownRoutes(server: McpServer): void {
  server.registerTool(
    "list_known_routes",
    {
      title: "List Known Routes",
      description:
        "Lists all known golden-path workflow routes in the registry. " +
        "Each route is a tested sequence of components and edges for a specific workflow pattern. " +
        "Use get_route to get full details and component/edge lists for a specific route.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: input.include_beta });
        let routes = registry.routes;

        if (input.risk_level !== undefined) {
          routes = routes.filter((r) => r.risk_level === input.risk_level);
        }

        const data = routes.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          risk_level: r.risk_level,
          confidence: r.confidence,
          summary: r.summary,
          component_count: r.components.length,
          edge_count: r.edges.length,
        }));

        const lines = [`**${data.length} route(s) in registry:**`];
        for (const r of data) {
          const conf = Math.round(r.confidence * 100);
          lines.push(
            `\n- **${r.id}** [risk: \`${r.risk_level}\`, confidence: ${conf}%] — ${r.summary.trim().replace(/\n/g, " ")}`,
          );
        }

        logger.debug(`list_known_routes → ${data.length} results`);
        return toMcpContent(
          okResponse(lines.join(""), data, [], [
            "get_route",
            "list_graph_components",
          ]),
        );
      } catch (err) {
        logger.error("list_known_routes failed", err);
        return toErrorResult(err);
      }
    },
  );
}
