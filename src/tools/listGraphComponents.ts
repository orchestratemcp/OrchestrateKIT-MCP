import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { COMPONENT_CATEGORIES } from "../registry/componentSchema.js";
import { RISK_LEVELS } from "../registry/sharedSchemas.js";
import { okResponse, toMcpContent } from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  category: z.enum(COMPONENT_CATEGORIES).optional().describe(
    "Filter by component category: input | processing | state | safety | tool | output | eval | orchestration | integration",
  ),
  capability: z.string().optional().describe(
    "Filter by capability keyword (case-insensitive substring match on the capabilities list)",
  ),
  risk_level: z.enum(RISK_LEVELS).optional().describe(
    "Filter by risk level: low | medium | high | critical",
  ),
  include_beta: z.boolean().default(false).describe(
    "Include beta-status components. Default false.",
  ),
  max_results: z.number().int().min(1).max(100).default(20).describe(
    "Maximum number of results to return. Default 20.",
  ),
};

export function registerListGraphComponents(server: McpServer): void {
  server.registerTool(
    "list_graph_components",
    {
      title: "List Graph Components",
      description:
        "Lists published workflow graph components. Filter by category, capability keyword or risk level. " +
        "Returns id, name, category, capabilities and summary for each match. " +
        "Use get_graph_component to get full details including related edges.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: input.include_beta });
        let components = registry.components;

        if (input.category !== undefined) {
          components = components.filter((c) => c.category === input.category);
        }

        if (input.capability !== undefined) {
          const needle = input.capability.toLowerCase();
          components = components.filter((c) =>
            c.capabilities.some((cap) => cap.toLowerCase().includes(needle)),
          );
        }

        if (input.risk_level !== undefined) {
          components = components.filter((c) => c.risk_level === input.risk_level);
        }

        const limited = components.slice(0, input.max_results);

        const data = limited.map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          risk_level: c.risk_level,
          capabilities: c.capabilities,
          summary: c.summary,
          status: c.status,
        }));

        const lines = [`**${data.length} component(s) matched** (total in registry: ${registry.components.length})`];
        for (const c of data) {
          lines.push(`\n- **${c.id}** [\`${c.category}\`, risk: \`${c.risk_level}\`] — ${c.summary.trim().replace(/\n/g, " ")}`);
        }

        const warnings: string[] = [];
        if (components.length > input.max_results) {
          warnings.push(
            `${components.length - input.max_results} additional matches were truncated. Increase max_results or add more filters.`,
          );
        }

        logger.debug(`list_graph_components → ${data.length} results`);
        return toMcpContent(
          okResponse(lines.join(""), data, warnings, [
            "get_graph_component",
            "list_graph_edges",
          ]),
        );
      } catch (err) {
        logger.error("list_graph_components failed", err);
        return toErrorResult(err);
      }
    },
  );
}
