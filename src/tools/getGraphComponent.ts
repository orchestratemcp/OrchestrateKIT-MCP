import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import {
  okResponse,
  notFoundResponse,
  statusWarnings,
  toMcpContent,
} from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { freshnessLabel } from "../lib/freshness.js";

const InputShape = {
  component_id: z.string().min(1).describe(
    "The id of the component to retrieve (e.g. 'source_retrieval')",
  ),
  include_edges: z.boolean().default(false).describe(
    "If true, include all incoming and outgoing edges for this component.",
  ),
  include_tests: z.boolean().default(false).describe(
    "If true, include evals, tested_in_playbooks and tested_in_routes.",
  ),
};

export function registerGetGraphComponent(server: McpServer): void {
  server.registerTool(
    "get_graph_component",
    {
      title: "Get Graph Component",
      description:
        "Returns full details for a single workflow graph component by id. " +
        "Use include_edges to see related edges (requires, safer_with, produces_input_for, etc.). " +
        "Use include_tests to see eval criteria and test playbook references.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });
        const component = registry.components.find((c) => c.id === input.component_id);

        if (!component) {
          logger.debug(`get_graph_component → not_found: ${input.component_id}`);
          return toMcpContent(notFoundResponse("component", input.component_id));
        }

        const warnings = statusWarnings(component.status, "component", component.id);

        // Freshness metadata from file mtime
        const mtime = registry.componentMtimes.get(component.id);
        const last_updated = mtime ? mtime.toISOString().slice(0, 10) : null;
        const freshness = last_updated ? freshnessLabel(mtime!) : "unknown";

        // Build the component data payload
        type ComponentData = {
          id: string;
          name: string;
          status: string;
          category: string;
          summary: string;
          capabilities: string[];
          inputs: string[];
          outputs: string[];
          risk_level: string;
          side_effects: string[];
          requires: string[];
          recommended_with: string[];
          avoid_with: string[];
          failure_modes: string[];
          last_updated: string | null;
          freshness: string;
          evals?: string[];
          tested_in_playbooks?: string[];
          tested_in_routes?: string[];
          outgoing_edges?: unknown[];
          incoming_edges?: unknown[];
        };

        const data: ComponentData = {
          id: component.id,
          name: component.name,
          status: component.status,
          category: component.category,
          summary: component.summary,
          capabilities: component.capabilities,
          inputs: component.inputs,
          outputs: component.outputs,
          risk_level: component.risk_level,
          side_effects: component.side_effects,
          requires: component.requires,
          recommended_with: component.recommended_with,
          avoid_with: component.avoid_with,
          failure_modes: component.failure_modes,
          last_updated,
          freshness,
        };

        if (input.include_tests) {
          data.evals = component.evals;
          data.tested_in_playbooks = component.tested_in_playbooks;
          data.tested_in_routes = component.tested_in_routes;
        }

        if (input.include_edges) {
          data.outgoing_edges = registry.edges
            .filter((e) => e.from === component.id)
            .map((e) => ({
              id: e.id,
              to: e.to,
              relation: e.relation,
              severity: e.severity,
              reason: e.reason,
            }));
          data.incoming_edges = registry.edges
            .filter((e) => e.to === component.id)
            .map((e) => ({
              id: e.id,
              from: e.from,
              relation: e.relation,
              severity: e.severity,
              reason: e.reason,
            }));
        }

        // Build summary markdown
        const lines = [
          `## ${component.name} (\`${component.id}\`)`,
          ``,
          `**Category:** \`${component.category}\` | **Risk:** \`${component.risk_level}\` | **Status:** \`${component.status}\` | **Freshness:** ${freshness}${last_updated ? ` (${last_updated})` : ""}`,
          ``,
          component.summary.trim(),
          ``,
          `**Capabilities:** ${component.capabilities.map((c) => `\`${c}\``).join(", ")}`,
        ];

        if (component.requires.length > 0) {
          lines.push(``, `**Requires:** ${component.requires.map((r) => `\`${r}\``).join(", ")}`);
        }
        if (component.failure_modes.length > 0) {
          lines.push(``, `**Key failure modes:**`);
          for (const fm of component.failure_modes.slice(0, 3)) {
            lines.push(`- ${fm}`);
          }
        }
        if (input.include_edges && data.outgoing_edges) {
          const out = data.outgoing_edges as Array<{ to: string; relation: string }>;
          if (out.length > 0) {
            lines.push(``, `**Outgoing edges (${out.length}):** ${out.map((e) => `→ \`${e.to}\` (${e.relation})`).join(", ")}`);
          }
        }

        logger.debug(`get_graph_component → ${component.id}`);
        return toMcpContent(
          okResponse(lines.join("\n"), data, warnings, [
            "list_graph_edges",
            "list_graph_components",
          ]),
        );
      } catch (err) {
        logger.error("get_graph_component failed", err);
        return toErrorResult(err);
      }
    },
  );
}
