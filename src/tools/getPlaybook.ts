import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import type { Playbook } from "../registry/playbookSchema.js";
import type { Route } from "../registry/routeSchema.js";
import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { Stack } from "../registry/stackSchema.js";
import {
  statusWarnings,
  toInlineEdgeSummary,
  criticalUntestedChecklist,
  type InlineEdgeSummary,
} from "./graphToolFormatters.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const InputShape = {
  playbook_id: z.string().optional().describe(
    "The exact playbook id to retrieve (e.g. 'codebase_agent_workflow').",
  ),
  workflow_type: z.string().optional().describe(
    "Match the best golden-path playbook by workflow type (e.g. 'coding-agent', 'research', 'data-pipeline'). " +
    "Used when playbook_id is not known.",
  ),
  include_beta: z.boolean().default(false).describe(
    "If true, include beta-status playbooks in the search.",
  ),
  include_graph: z.boolean().default(false).describe(
    "If true, resolve and return the full graph context: route, components, edges, stack, " +
    "untested edges and approval gates.",
  ),
  output_format: z.enum(["summary", "full", "implementation_focused"]).default("full").describe(
    "summary = overview only. full = all playbook fields. " +
    "implementation_focused = guardrails, failure_modes, implementation_steps and graph context.",
  ),
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

type ComponentSummary = {
  id: string;
  name: string;
  category: string;
  summary: string;
  risk_level: string;
};

type GraphContext = {
  route?: Pick<Route, "id" | "name" | "status" | "confidence" | "risk_level"> & { untested_edges: string[] };
  components: ComponentSummary[];
  /** Full inline edge evidence objects (MAR-92). */
  edges: InlineEdgeSummary[];
  stack?: Pick<Stack, "id" | "name" | "summary">;
  untested_edges: string[];
  approval_gates: string[];
};

type GetPlaybookOutput = {
  status: "ok" | "not_found" | "low_confidence";
  matched_playbook_id?: string;
  confidence: number;
  summary_markdown: string;
  playbook?: object;
  graph_context?: GraphContext;
  warnings: string[];
  next_recommended_tools: string[];
};

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

function scorePlaybook(playbook: Playbook, workflowType: string): number {
  const needle = workflowType.toLowerCase().trim();
  const wt = playbook.workflow_type.toLowerCase();
  const title = playbook.title.toLowerCase();

  if (wt === needle) return 1.0;
  if (wt.includes(needle) || needle.includes(wt)) return 0.85;
  if (title.includes(needle)) return 0.7;
  return 0;
}

function bestPlaybookMatch(
  playbooks: Playbook[],
  workflowType: string,
): { playbook: Playbook; confidence: number } | null {
  let best: Playbook | null = null;
  let bestScore = 0;

  for (const p of playbooks) {
    const score = scorePlaybook(p, workflowType);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (!best || bestScore === 0) return null;
  return { playbook: best, confidence: bestScore };
}

// ---------------------------------------------------------------------------
// Graph context builder
// ---------------------------------------------------------------------------

function buildGraphContext(
  playbook: Playbook,
  registry: ReturnType<typeof loadRegistry>,
): GraphContext {
  const route = registry.routes.find((r) => r.id === playbook.golden_path_route_id);
  const stack = registry.stacks.find((s) => s.id === playbook.stack_id);

  const componentIds = new Set(playbook.components);
  const edgeIds = new Set(playbook.edges);

  const components: ComponentSummary[] = registry.components
    .filter((c) => componentIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      summary: c.summary,
      risk_level: c.risk_level,
    }));

  const edges: InlineEdgeSummary[] = registry.edges
    .filter((e) => edgeIds.has(e.id))
    .map(toInlineEdgeSummary);

  // Untested edges: from the route's untested_edges list + any playbook edges with tested=false.
  const routeUntestedEdges = route?.untested_edges ?? [];
  const untestedFromEdges = edges.filter((e) => !e.tested).map((e) => e.edge_id);
  const untestedEdges = [...new Set([...routeUntestedEdges, ...untestedFromEdges])];

  // Approval gates: edges that require human_approval_gate (relation=requires, to=human_approval_gate),
  // edges with requires_human_approval_when relation, or components with approval_required_for entries.
  const approvalGateEdges = edges
    .filter(
      (e) =>
        e.relation === "requires_human_approval_when" ||
        (e.relation === "requires" && e.to === "human_approval_gate"),
    )
    .map((e) => {
      const rawEdge = registry.edges.find((re) => re.id === e.edge_id);
      return `${e.from} → ${e.to} (${rawEdge?.reason ?? e.condition})`;
    });

  const approvalGateComponents = registry.components
    .filter(
      (c) =>
        componentIds.has(c.id) && c.permissions.approval_required_for.length > 0,
    )
    .map(
      (c) =>
        `${c.id}: approval required for ${c.permissions.approval_required_for.join(", ")}`,
    );

  const approvalGates = [...approvalGateEdges, ...approvalGateComponents];

  const routeSummary = route
    ? {
        id: route.id,
        name: route.name,
        status: route.status,
        confidence: route.confidence,
        risk_level: route.risk_level,
        untested_edges: route.untested_edges,
      }
    : undefined;

  const stackSummary = stack
    ? { id: stack.id, name: stack.name, summary: stack.summary }
    : undefined;

  return {
    route: routeSummary,
    components,
    edges,
    stack: stackSummary,
    untested_edges: untestedEdges,
    approval_gates: approvalGates,
  };
}

// ---------------------------------------------------------------------------
// Markdown formatters
// ---------------------------------------------------------------------------

function playbookToMarkdown(
  playbook: Playbook,
  format: "summary" | "full" | "implementation_focused",
  graphCtx?: GraphContext,
): string {
  const lines: string[] = [
    `## Playbook: ${playbook.title} (\`${playbook.id}\`)`,
    ``,
    `**Workflow type:** \`${playbook.workflow_type}\` | **Risk:** \`${playbook.risk_level}\` | **Status:** \`${playbook.status}\``,
    ``,
    playbook.summary.trim(),
  ];

  if (format !== "summary") {
    if (playbook.best_for.length > 0) {
      lines.push(``, `**Best for:**`);
      for (const b of playbook.best_for) lines.push(`- ${b}`);
    }

    if (playbook.avoid_when.length > 0) {
      lines.push(``, `**Avoid when:**`);
      for (const a of playbook.avoid_when) lines.push(`- ${a}`);
    }
  }

  if (format === "full" || format === "implementation_focused") {
    if (playbook.guardrails.length > 0) {
      lines.push(``, `**Guardrails:**`);
      for (const g of playbook.guardrails) lines.push(`- ${g}`);
    }

    if (playbook.failure_modes.length > 0) {
      lines.push(``, `**Failure modes:**`);
      for (const f of playbook.failure_modes) lines.push(`- ${f}`);
    }
  }

  if (format === "implementation_focused" && playbook.implementation_steps.length > 0) {
    lines.push(``, `**Implementation steps:**`);
    for (const step of playbook.implementation_steps) lines.push(`- ${step}`);
  }

  if (graphCtx) {
    lines.push(``, `### Graph context`);

    if (graphCtx.route) {
      const conf = Math.round(graphCtx.route.confidence * 100);
      lines.push(
        ``,
        `**Golden-path route:** \`${graphCtx.route.id}\` — ${graphCtx.route.name} ` +
        `(confidence ${conf}%, risk \`${graphCtx.route.risk_level}\`, status \`${graphCtx.route.status}\`)`,
      );
    } else {
      lines.push(``, `**Golden-path route:** \`${playbook.golden_path_route_id}\` (not found in loaded registry)`);
    }

    if (graphCtx.stack) {
      lines.push(``, `**Stack:** \`${graphCtx.stack.id}\` — ${graphCtx.stack.summary.trim()}`);
    }

    if (graphCtx.components.length > 0) {
      lines.push(``, `**Components (${graphCtx.components.length}):**`);
      for (const c of graphCtx.components) {
        lines.push(`- \`${c.id}\` [${c.category}] ${c.summary.trim()}`);
      }
    }

    if (graphCtx.edges.length > 0) {
      lines.push(``, `**Edges (${graphCtx.edges.length}):**`);
      for (const e of graphCtx.edges) {
        const testedTag = e.tested ? "" : " ⚠️ untested";
        const condPart = e.condition ? ` — condition: ${e.condition}` : "";
        lines.push(`- \`${e.edge_id}\` \`${e.relation}\` [${e.severity}]${testedTag}${condPart}`);
      }
    }

    // MAR-92: critical untested edges checklist
    const checklist = criticalUntestedChecklist(graphCtx.edges);
    if (checklist) {
      lines.push(checklist);
    }

    if (graphCtx.approval_gates.length > 0) {
      lines.push(``, `**🔐 Approval gates:**`);
      for (const g of graphCtx.approval_gates) lines.push(`- ${g}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerGetPlaybook(server: McpServer): void {
  server.registerTool(
    "get_playbook",
    {
      title: "Get Playbook",
      description:
        "Returns a golden-path playbook from the workflow graph registry by id or workflow type. " +
        "Set include_graph=true to also receive the resolved route, component summaries, " +
        "edge summaries, stack context, untested edges and approval gates. " +
        "If no playbook matches, recommends compose_workflow_route instead. " +
        "Returns warnings for beta/deprecated/low-confidence matches. " +
        "Use list_known_routes to browse available route ids.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: input.include_beta });

        // --- Find playbook ---
        let playbook: Playbook | undefined;
        let confidence = 1.0;

        if (input.playbook_id) {
          playbook = registry.playbooks.find((p) => p.id === input.playbook_id);
          if (!playbook) {
            const output: GetPlaybookOutput = {
              status: "not_found",
              confidence: 0,
              summary_markdown: `**Playbook not found:** \`${input.playbook_id}\` does not exist in the published registry.`,
              warnings: [
                `No playbook with id "${input.playbook_id}" found. Use get_playbook with a workflow_type to search by type, or compose_workflow_route to build a new route.`,
              ],
              next_recommended_tools: ["compose_workflow_route", "list_known_routes"],
            };
            logger.debug(`get_playbook → not_found: ${input.playbook_id}`);
            return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
          }
        } else if (input.workflow_type) {
          const match = bestPlaybookMatch(registry.playbooks, input.workflow_type);
          if (!match) {
            const output: GetPlaybookOutput = {
              status: "not_found",
              confidence: 0,
              summary_markdown: `**No playbook matched** workflow type \`${input.workflow_type}\`.`,
              warnings: [
                `No published playbook matches workflow type "${input.workflow_type}". Use compose_workflow_route to build a candidate route from scratch.`,
              ],
              next_recommended_tools: ["compose_workflow_route", "list_known_routes"],
            };
            logger.debug(`get_playbook → not_found by workflow_type: ${input.workflow_type}`);
            return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
          }
          playbook = match.playbook;
          confidence = match.confidence;
        } else {
          const output: GetPlaybookOutput = {
            status: "not_found",
            confidence: 0,
            summary_markdown: `**Input required:** provide either playbook_id or workflow_type.`,
            warnings: ["Provide playbook_id or workflow_type to look up a playbook."],
            next_recommended_tools: ["list_known_routes", "compose_workflow_route"],
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
        }

        // --- Collect warnings ---
        const warnings: string[] = [
          ...statusWarnings(playbook.status, "playbook", playbook.id),
        ];

        if (confidence < 1.0) {
          warnings.push(
            `Low-confidence match (${Math.round(confidence * 100)}%): playbook "${playbook.id}" was matched by workflow_type, not exact id. Verify this is the right playbook before implementing.`,
          );
        }

        // --- Build graph context ---
        let graphCtx: GraphContext | undefined;
        if (input.include_graph) {
          graphCtx = buildGraphContext(playbook, registry);

          if (!registry.routes.find((r) => r.id === playbook!.golden_path_route_id)) {
            warnings.push(
              `Golden-path route "${playbook.golden_path_route_id}" was not found in the loaded registry. ` +
              `The route may be filtered out by status.`,
            );
          }

          if (graphCtx.untested_edges.length > 0) {
            warnings.push(
              `This playbook has ${graphCtx.untested_edges.length} untested edge(s): ` +
              graphCtx.untested_edges.join(", ") +
              ". Validate these edges before using in production.",
            );
          }

          if (graphCtx.approval_gates.length > 0) {
            warnings.push(
              `This playbook has ${graphCtx.approval_gates.length} approval gate(s). ` +
              "External write/send/publish/calendar-write flows require human approval before execution.",
            );
          }
        }

        // --- Build output playbook object ---
        const playbookObj =
          input.output_format === "summary"
            ? {
                id: playbook.id,
                title: playbook.title,
                status: playbook.status,
                workflow_type: playbook.workflow_type,
                risk_level: playbook.risk_level,
                summary: playbook.summary,
              }
            : input.output_format === "implementation_focused"
            ? {
                id: playbook.id,
                title: playbook.title,
                status: playbook.status,
                workflow_type: playbook.workflow_type,
                risk_level: playbook.risk_level,
                summary: playbook.summary,
                guardrails: playbook.guardrails,
                failure_modes: playbook.failure_modes,
                implementation_steps: playbook.implementation_steps,
                golden_path_route_id: playbook.golden_path_route_id,
                stack_id: playbook.stack_id,
              }
            : playbook;

        const summary = playbookToMarkdown(playbook, input.output_format, graphCtx);
        const status: "ok" | "low_confidence" =
          confidence >= 0.8 ? "ok" : "low_confidence";

        const output: GetPlaybookOutput = {
          status,
          matched_playbook_id: playbook.id,
          confidence,
          summary_markdown: summary,
          playbook: playbookObj,
          graph_context: graphCtx,
          warnings,
          next_recommended_tools: [
            "get_relevant_docs",
            "compose_workflow_route",
            "get_route",
            "get_graph_component",
          ],
        };

        logger.debug(
          `get_playbook → status=${output.status} id=${playbook.id} confidence=${confidence}`,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
      } catch (err) {
        logger.error("get_playbook failed", err);
        return toErrorResult(err);
      }
    },
  );
}
