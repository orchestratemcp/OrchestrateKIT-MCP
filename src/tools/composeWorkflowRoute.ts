import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryProvider.js";
import { composeRoute } from "../graph/routeComposer.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const InputShape = {
  goal: z.string().min(5).describe(
    "Describe the workflow you want to build in plain language. " +
    "Example: 'I want to read emails, research the sender and draft a reply.'",
  ),
  must_have_capabilities: z.array(z.string()).default([]).describe(
    "Capabilities the route must include (e.g. ['send_email', 'validate_schema']). " +
    "Missing capabilities will be flagged.",
  ),
  must_avoid: z.array(z.string()).default([]).describe(
    "Component IDs to exclude from the route.",
  ),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional().describe(
    "Maximum acceptable risk level for components. Higher-risk components will be flagged.",
  ),
  local_or_hosted: z.enum(["local", "hosted", "either"]).default("either").describe(
    "Whether you are building a local tool or a hosted product. Affects stack recommendation.",
  ),
  output_depth: z.enum(["guided", "brief", "standard", "technical", "deep"]).default("standard").describe(
    "guided/brief = short summary only. standard = full route with warnings. technical/deep = includes all evals.",
  ),
};

export function registerComposeWorkflowRoute(server: McpServer): void {
  server.registerTool(
    "compose_workflow_route",
    {
      title: "Compose Workflow Route",
      description:
        "Proposes a candidate AI workflow route by matching your goal to graph components, " +
        "adding required dependencies and safety gates, ordering steps, and scoring the result. " +
        "Use this when you are designing a new AI workflow and want opinionated, " +
        "graph-backed architecture suggestions. " +
        "The result is a CANDIDATE ROUTE — not a validated playbook. Always review before implementing. " +
        "Use get_route and list_known_routes to check if a validated playbook already exists.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: false });

        const result = composeRoute(
          {
            goal: input.goal,
            must_have_capabilities: input.must_have_capabilities,
            must_avoid: input.must_avoid,
            risk_level: input.risk_level,
            local_or_hosted: input.local_or_hosted,
            output_depth: input.output_depth,
          },
          registry,
        );

        logger.debug(
          `compose_workflow_route → status=${result.status} score=${result.route_score} components=${result.recommended_route.length}`,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        logger.error("compose_workflow_route failed", err);
        return toErrorResult(err);
      }
    },
  );
}
