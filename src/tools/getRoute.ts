import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import {
  okResponse,
  notFoundResponse,
  statusWarnings,
  toMcpContent,
  toInlineEdgeSummary,
  criticalUntestedChecklist,
  type InlineEdgeSummary,
} from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  route_id: z.string().min(1).describe(
    "The id of the route to retrieve (e.g. 'research_route_v1')",
  ),
  include_component_details: z.boolean().default(false).describe(
    "If true, include full component summaries for each component in the route.",
  ),
};

export function registerGetRoute(server: McpServer): void {
  server.registerTool(
    "get_route",
    {
      title: "Get Route",
      description:
        "Returns full details for a single golden-path workflow route by id. " +
        "Includes the component list, edge list, confidence score, risk level and failure modes. " +
        "Use list_known_routes to discover available route ids.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });
        const route = registry.routes.find((r) => r.id === input.route_id);

        if (!route) {
          logger.debug(`get_route → not_found: ${input.route_id}`);
          return toMcpContent(notFoundResponse("route", input.route_id));
        }

        const warnings = [
          ...statusWarnings(route.status, "route", route.id),
          ...route.warnings,
        ];

        // Resolve inline edge objects for the route (MAR-92)
        const edgeMap = new Map(registry.edges.map((e) => [e.id, e]));
        const inlineEdges: InlineEdgeSummary[] = route.edges
          .map((eid) => edgeMap.get(eid))
          .filter((e): e is NonNullable<typeof e> => e !== undefined)
          .map(toInlineEdgeSummary);

        type RouteData = {
          id: string;
          name: string;
          status: string;
          summary: string;
          risk_level: string;
          confidence: number;
          components: string[];
          edges: InlineEdgeSummary[];
          required_evals: string[];
          untested_edges: string[];
          warnings: string[];
          component_details?: Array<{ id: string; name: string; category: string; summary: string }>;
        };

        const data: RouteData = {
          id: route.id,
          name: route.name,
          status: route.status,
          summary: route.summary,
          risk_level: route.risk_level,
          confidence: route.confidence,
          components: route.components,
          edges: inlineEdges,
          required_evals: route.required_evals,
          untested_edges: route.untested_edges,
          warnings: route.warnings,
        };

        if (input.include_component_details) {
          data.component_details = route.components
            .map((cid) => registry.components.find((c) => c.id === cid))
            .filter((c): c is NonNullable<typeof c> => c !== undefined)
            .map((c) => ({
              id: c.id,
              name: c.name,
              category: c.category,
              summary: c.summary,
            }));
        }

        const conf = Math.round(route.confidence * 100);
        const lines = [
          `## Route: ${route.name} (\`${route.id}\`)`,
          ``,
          `**Risk:** \`${route.risk_level}\` | **Confidence:** ${conf}% | **Status:** \`${route.status}\``,
          ``,
          route.summary.trim(),
          ``,
          `**Components (${route.components.length}):** ${route.components.map((c) => `\`${c}\``).join(", ")}`,
          ``,
          `**Edges (${inlineEdges.length}):**`,
        ];

        for (const e of inlineEdges) {
          const testedTag = e.tested ? "" : ` ⚠️ untested`;
          lines.push(`- \`${e.edge_id}\` \`${e.relation}\` [${e.severity}]${testedTag} — ${e.condition || "no condition"}`);
        }

        if (route.required_evals.length > 0) {
          lines.push(``, `**Required evals:**`);
          for (const ev of route.required_evals) {
            lines.push(`- ${ev}`);
          }
        }

        // MAR-92: critical untested edges checklist
        const checklist = criticalUntestedChecklist(inlineEdges);
        if (checklist) {
          lines.push(checklist);
          warnings.push(`This route has ${inlineEdges.filter((e) => !e.tested).length} untested edge(s). Validate before using in production.`);
        }

        logger.debug(`get_route → ${route.id}`);
        return toMcpContent(
          okResponse(lines.join("\n"), data, warnings, [
            "get_graph_component",
            "list_graph_edges",
            "get_stack_recommendation",
          ]),
        );
      } catch (err) {
        logger.error("get_route failed", err);
        return toErrorResult(err);
      }
    },
  );
}
