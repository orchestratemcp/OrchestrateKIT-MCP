import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import {
  okResponse,
  notFoundResponse,
  toMcpContent,
} from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const DEFAULT_STACK_ID = "default_orchestratekit_stack";

const InputShape = {
  stack_id: z.string().optional().describe(
    "Specific stack id to retrieve. Defaults to 'default_orchestratekit_stack'.",
  ),
  use_case: z.string().optional().describe(
    "Describe your use case to get targeted guidance (e.g. 'local MVP', 'hosted team product')",
  ),
  local_or_hosted: z
    .enum(["local", "hosted", "either"])
    .optional()
    .default("either")
    .describe("Whether you are building a local tool or a hosted product"),
  risk_level: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Risk level of the workflow to inform stack choices"),
};

export function registerGetStackRecommendation(server: McpServer): void {
  server.registerTool(
    "get_stack_recommendation",
    {
      title: "Get Stack Recommendation",
      description:
        "Returns the recommended technology stack for an AI workflow, with opinionated defaults and when-to-upgrade guidance. " +
        "Always warns against premature vector DB, remote auth or graph databases for local/v0 scope. " +
        "Use this before selecting technologies for a new workflow project.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry();
        const targetId = input.stack_id ?? DEFAULT_STACK_ID;
        const stack = registry.stacks.find((s) => s.id === targetId);

        if (!stack) {
          logger.debug(`get_stack_recommendation → not_found: ${targetId}`);
          return toMcpContent(notFoundResponse("stack", targetId));
        }

        const warnings: string[] = [];

        // Contextual warnings based on input
        if (input.local_or_hosted === "local") {
          warnings.push(
            "Building locally: use SQLite over Postgres, inline job execution over BullMQ, and promptfoo over cloud eval runners.",
          );
        }
        if (input.local_or_hosted === "hosted") {
          warnings.push(
            "For hosted products: switch SQLite → Supabase/Postgres before launch. In-memory queues lose jobs on restart — add BullMQ with Redis.",
          );
        }

        // Standard premature-architecture warnings
        warnings.push(
          "Do not add a vector database unless your corpus genuinely requires semantic retrieval. SQL with full-text search handles most v0 use cases.",
        );
        warnings.push(
          "Do not add remote auth/OAuth in v0. Local tools do not need it. Add it when you have real multi-user requirements.",
        );
        warnings.push(
          "Do not add a graph database (e.g. Neo4j). The registry graph is small enough for in-memory filtering.",
        );

        // Build readable choices summary
        const choiceLines: string[] = [];
        for (const [area, choice] of Object.entries(stack.choices)) {
          const c = choice as {
            recommended: string | string[];
            alternatives?: string[];
            reason?: string;
          };
          const rec = Array.isArray(c.recommended)
            ? c.recommended.join(", ")
            : c.recommended;
          const alt = c.alternatives?.join(", ") ?? "none";
          choiceLines.push(`- **${area}:** \`${rec}\` (alternatives: ${alt})`);
          if (c.reason) {
            choiceLines.push(`  > ${c.reason.trim().replace(/\n/g, " ")}`);
          }
        }

        const data = {
          id: stack.id,
          name: stack.name,
          status: stack.status,
          summary: stack.summary,
          best_for: stack.best_for,
          avoid_when: stack.avoid_when,
          choices: stack.choices,
          tradeoffs: stack.tradeoffs,
        };

        const lines = [
          `## Stack Recommendation: ${stack.name}`,
          ``,
          stack.summary.trim(),
          ``,
          `### Technology choices`,
          ...choiceLines,
          ``,
          `### Best for`,
          ...stack.best_for.map((b) => `- ${b}`),
          ``,
          `### Avoid when`,
          ...stack.avoid_when.map((a) => `- ${a}`),
          ``,
          `### Known tradeoffs`,
          ...stack.tradeoffs.map((t) => `- ${t}`),
        ];

        logger.debug(`get_stack_recommendation → ${stack.id}`);
        return toMcpContent(
          okResponse(lines.join("\n"), data, warnings, [
            "list_known_routes",
            "list_graph_components",
          ]),
        );
      } catch (err) {
        logger.error("get_stack_recommendation failed", err);
        return toErrorResult(err);
      }
    },
  );
}
