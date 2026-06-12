import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { matchCapabilities } from "../graph/capabilityMatcher.js";
import { findOverlappingPlaybooks } from "../graph/playbookOverlap.js";
import type { RegistrySnapshot } from "../graph/routeComposer.js";
import { ALL_RULES } from "../review/rules/index.js";
import {
  calculateRiskScore,
  deriveStatus,
  type ReviewContext,
  type ReviewFinding,
  type GraphEntityRef,
} from "../review/types.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const AgentSchema = z.object({
  name: z.string().min(1),
  responsibility: z.string().min(1),
  tools: z.array(z.string()).default([]),
});

const ToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  side_effects: z.array(z.string()).default([]),
});

const StateSchema = z.object({
  has_persistent_state: z.boolean().optional(),
  store: z.string().optional(),
  notes: z.string().optional(),
});

const ApprovalSchema = z.object({
  required: z.boolean().optional(),
  approval_points: z.array(z.string()).default([]),
});

const InputShape = {
  workflow_name: z.string().optional().describe("Optional name for the workflow being reviewed."),
  goal: z.string().min(5).describe("What the workflow is trying to accomplish."),
  proposed_architecture: z.string().optional().describe(
    "Free-text description of the proposed architecture. Include data flow, component roles and decision points.",
  ),
  route_id: z.string().optional().describe(
    "Known registry route id to inspect (e.g. 'research_route_v1'). " +
    "Enables graph-aware edge and component inspection.",
  ),
  component_ids: z.array(z.string()).default([]).describe(
    "Registry component ids included in the workflow. Used for graph-aware checks.",
  ),
  agents: z.array(AgentSchema).default([]).describe(
    "Agents in the workflow with their responsibilities and tools.",
  ),
  tools: z.array(ToolSchema).default([]).describe(
    "Custom tools used by agents. Include descriptions, permissions and side effects.",
  ),
  state: StateSchema.optional().describe("State/storage configuration for the workflow."),
  human_approval: ApprovalSchema.optional().describe("Human approval configuration."),
  integrations: z.array(z.string()).default([]).describe(
    "External services/integrations used (e.g. ['email', 'calendar', 'slack', 'github']).",
  ),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional().describe(
    "Declared risk level of the workflow.",
  ),
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

type GraphFinding = {
  entity_type: "component" | "edge" | "route" | "playbook";
  entity_id: string;
  severity: string;
  message: string;
  recommended_fix: string;
};

type ReviewOutput = {
  status: "pass" | "warnings" | "fail";
  risk_score: number;
  summary_markdown: string;
  blocking_issues: string[];
  warnings: string[];
  graph_findings: GraphFinding[];
  missing_components: string[];
  recommended_changes: string[];
  approval_gates_required: string[];
  evals_to_add: string[];
  matching_playbook_ids: string[];
  next_recommended_tools: string[];
};

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const EXTERNAL_WRITE_IDS = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
]);

export function buildReviewContext(
  input: {
    workflow_name?: string;
    goal: string;
    proposed_architecture?: string;
    route_id?: string;
    component_ids: string[];
    agents: Array<{ name: string; responsibility: string; tools: string[] }>;
    tools: Array<{ name: string; description?: string; permissions: string[]; side_effects: string[] }>;
    state?: { has_persistent_state?: boolean; store?: string; notes?: string };
    human_approval?: { required?: boolean; approval_points: string[] };
    integrations: string[];
    risk_level?: "low" | "medium" | "high" | "critical";
  },
  registry: RegistrySnapshot,
): ReviewContext {
  const resolvedRoute = input.route_id
    ? registry.routes.find((r) => r.id === input.route_id)
    : undefined;

  // Merge component_ids from input + route
  const allComponentIds = [
    ...new Set([
      ...input.component_ids,
      ...(resolvedRoute?.components ?? []),
    ]),
  ];

  const resolvedComponents = registry.components.filter((c) =>
    allComponentIds.includes(c.id),
  );
  const resolvedComponentSet = new Set(allComponentIds);

  const resolvedEdges = registry.edges.filter(
    (e) => resolvedComponentSet.has(e.from) || resolvedComponentSet.has(e.to),
  );

  const matchedPlaybooks = findOverlappingPlaybooks(
    resolvedComponentSet,
    registry.playbooks,
    0.5,
  );

  const hasPersistentState =
    input.state?.has_persistent_state === true ||
    (input.state?.store !== undefined && input.state.store.trim().length > 0) ||
    allComponentIds.some((id) => ["state_store", "job_queue"].includes(id));

  const humanApprovalRequired = input.human_approval?.required ?? false;
  const humanApprovalDeclared = input.human_approval !== undefined;

  const isMultiStep =
    allComponentIds.length > 3 || input.agents.length > 2;

  return {
    goal: input.goal,
    workflowName: input.workflow_name ?? "Unnamed workflow",
    proposedArchitecture: input.proposed_architecture ?? "",
    componentIds: allComponentIds,
    agents: input.agents,
    userTools: input.tools,
    integrations: input.integrations,
    hasPersistentState,
    humanApprovalDeclared,
    humanApprovalRequired,
    riskLevel: input.risk_level,
    resolvedComponents,
    resolvedEdges,
    resolvedRoute,
    resolvedPlaybooks: matchedPlaybooks.map((m) =>
      registry.playbooks.find((p) => p.id === m.playbook_id)!,
    ).filter(Boolean),
    hasExternalWrite: allComponentIds.some((id) => EXTERNAL_WRITE_IDS.has(id)),
    hasResearch: allComponentIds.some((id) =>
      ["research_synthesis", "source_ranking", "source_retrieval"].includes(id),
    ),
    hasDataScraper: allComponentIds.includes("data_scraper"),
    hasSchemaValidation: allComponentIds.some((id) =>
      ["schema_validation", "deduplication"].includes(id),
    ),
    hasCitationChecker: allComponentIds.includes("citation_checker"),
    hasHumanApprovalGate: allComponentIds.includes("human_approval_gate"),
    hasAuditLog: allComponentIds.includes("audit_log"),
    hasRetryPolicy: allComponentIds.includes("retry_policy"),
    hasAuthFailureHandler: allComponentIds.includes("auth_failure_handler"),
    isMultiStep,
    isSimpleWorkflow: !isMultiStep,
  };
}

// ---------------------------------------------------------------------------
// Evals suggestion
// ---------------------------------------------------------------------------

function collectEvalsToAdd(ctx: ReviewContext): string[] {
  const evals = new Set<string>();

  for (const comp of ctx.resolvedComponents) {
    for (const ev of comp.evals.slice(0, 2)) {
      evals.add(`[${comp.id}] ${ev}`);
    }
  }

  for (const pb of ctx.resolvedPlaybooks) {
    for (const ev of pb.evals.slice(0, 2)) {
      evals.add(`[${pb.id}] ${ev}`);
    }
  }

  if (evals.size === 0) {
    evals.add("Define at least 2-3 eval fixtures before implementation (use promptfoo for LLM steps, vitest for deterministic steps).");
  }

  return [...evals].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Missing components derivation
// ---------------------------------------------------------------------------

function deriveMissingComponents(
  findings: ReviewFinding[],
  allComponentIds: string[],
): string[] {
  const missing = new Set<string>();
  const current = new Set(allComponentIds);

  for (const f of findings) {
    if (!f.entity_ref) continue;
    if (f.entity_ref.entity_type !== "component") continue;
    if (!current.has(f.entity_ref.entity_id)) {
      missing.add(f.entity_ref.entity_id);
    }
  }

  return [...missing];
}

// ---------------------------------------------------------------------------
// Markdown summary formatter
// ---------------------------------------------------------------------------

function formatSummaryMarkdown(
  workflowName: string,
  goal: string,
  status: "pass" | "warnings" | "fail",
  riskScore: number,
  blockingIssues: string[],
  warnings: string[],
  graphFindings: GraphFinding[],
  matchingPlaybookIds: string[],
): string {
  const statusEmoji = status === "pass" ? "✅" : status === "warnings" ? "⚠️" : "❌";
  const lines = [
    `## Workflow Design Review — ${workflowName}`,
    ``,
    `**Goal:** ${goal}`,
    ``,
    `**Status:** ${statusEmoji} ${status.toUpperCase()} | **Risk score:** ${riskScore}/100`,
    ``,
  ];

  if (matchingPlaybookIds.length > 0) {
    lines.push(
      `**Matching golden-path playbook(s):** ${matchingPlaybookIds.map((id) => `\`${id}\``).join(", ")}`,
      ``,
    );
  }

  if (blockingIssues.length > 0) {
    lines.push(`### ❌ Blocking issues (${blockingIssues.length})`, ``);
    for (const issue of blockingIssues) lines.push(`- ${issue}`);
    lines.push(``);
  }

  if (warnings.length > 0) {
    lines.push(`### ⚠️ Warnings (${warnings.length})`, ``);
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  if (graphFindings.length > 0) {
    lines.push(`### 🔍 Graph findings (${graphFindings.length})`, ``);
    for (const gf of graphFindings) {
      lines.push(`- **[${gf.severity}]** \`${gf.entity_id}\` — ${gf.message}`);
      lines.push(`  → Fix: ${gf.recommended_fix}`);
    }
    lines.push(``);
  }

  if (status === "pass") {
    lines.push(`> No blocking issues or warnings found. Review passed with score ${riskScore}/100.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerReviewWorkflowDesign(server: McpServer): void {
  server.registerTool(
    "review_workflow_design",
    {
      title: "Review Workflow Design",
      description:
        "Deterministic safety checker for AI workflow designs. " +
        "Accepts a workflow spec (goal, components, agents, tools, state, integrations) and returns " +
        "a structured review covering: missing approval gates, state gaps, tool safety, " +
        "architecture anti-patterns, graph-derived findings (untested edges, conflicts, missing deps) " +
        "and eval coverage. No LLM calls — all checks are rule-based. " +
        "Use before implementing to catch critical design problems early. " +
        "Provide route_id or component_ids for graph-aware analysis.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });

        // ── Step 1: If route_id provided but not found, add a pre-finding ──
        const routeNotFoundFindings: ReviewFinding[] = [];
        if (input.route_id) {
          const found = registry.routes.find((r) => r.id === input.route_id);
          if (!found) {
            routeNotFoundFindings.push({
              severity: "medium",
              category: "graph",
              message: `Route \`${input.route_id}\` not found in the loaded registry.`,
              reason: "The specified route_id does not exist in published/validated routes.",
              recommended_fix:
                "Use `list_known_routes` to find valid route IDs, or remove the route_id to skip route-level checks.",
            });
          }
        }

        // ── Step 2: If no components given, try to infer from goal ──
        let componentIds = [...input.component_ids];
        if (componentIds.length === 0 && !input.route_id) {
          const { matches } = matchCapabilities(input.goal, [], [], registry.components);
          componentIds = matches.slice(0, 6).map((m) => m.component.id);
        }

        const enrichedInput = { ...input, component_ids: componentIds };

        // ── Step 3: Build context ──
        const ctx = buildReviewContext(enrichedInput, registry);

        // ── Step 4: Run all rules ──
        const allFindings: ReviewFinding[] = [
          ...routeNotFoundFindings,
          ...ALL_RULES.flatMap((rule) => rule(ctx)),
        ];

        // ── Step 5: Compute scores and status ──
        const riskScore = calculateRiskScore(allFindings);
        const status = deriveStatus(riskScore, allFindings);

        // ── Step 6: Partition findings ──
        const blockingIssues = allFindings
          .filter((f) => f.severity === "critical" || f.severity === "high")
          .map((f) => f.message);

        const warnings = allFindings
          .filter((f) => f.severity === "medium" || f.severity === "low")
          .map((f) => f.message);

        const graphFindings: GraphFinding[] = allFindings
          .filter((f): f is ReviewFinding & { entity_ref: GraphEntityRef } => f.entity_ref !== undefined)
          .map((f) => ({
            entity_type: f.entity_ref.entity_type,
            entity_id: f.entity_ref.entity_id,
            severity: f.severity,
            message: f.message,
            recommended_fix: f.recommended_fix,
          }));

        // ── Step 7: Derived outputs ──
        const missingComponents = deriveMissingComponents(allFindings, ctx.componentIds);
        const recommendedChanges = allFindings
          .filter((f) => f.severity === "critical" || f.severity === "high")
          .map((f) => f.recommended_fix);
        const approvalGatesRequired =
          allFindings.some(
            (f) => f.category === "approval_gate" && (f.severity === "critical" || f.severity === "high"),
          )
            ? ["human_approval_gate"]
            : [];
        const evalsToAdd = collectEvalsToAdd(ctx);
        const matchingPlaybookIds = ctx.resolvedPlaybooks.map((p) => p.id);

        // ── Step 8: Inferred goal-based matching (if no components resolved) ──
        const finalMatchingPlaybookIds =
          matchingPlaybookIds.length > 0
            ? matchingPlaybookIds
            : (() => {
                const inferred = findOverlappingPlaybooks(
                  new Set(componentIds),
                  registry.playbooks,
                  0.4,
                );
                return inferred.map((o) => o.playbook_id);
              })();

        // ── Step 9: Format summary ──
        const summary = formatSummaryMarkdown(
          ctx.workflowName,
          input.goal,
          status,
          riskScore,
          blockingIssues,
          warnings,
          graphFindings,
          finalMatchingPlaybookIds,
        );

        const output: ReviewOutput = {
          status,
          risk_score: riskScore,
          summary_markdown: summary,
          blocking_issues: blockingIssues,
          warnings,
          graph_findings: graphFindings,
          missing_components: missingComponents,
          recommended_changes: recommendedChanges,
          approval_gates_required: approvalGatesRequired,
          evals_to_add: evalsToAdd,
          matching_playbook_ids: finalMatchingPlaybookIds,
          next_recommended_tools: [
            "recommend_architecture",
            "get_playbook",
            "get_route",
            "get_graph_component",
          ],
        };

        logger.debug(
          `review_workflow_design → status=${status} risk_score=${riskScore} ` +
          `findings=${allFindings.length} blocking=${blockingIssues.length}`,
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
      } catch (err) {
        logger.error("review_workflow_design failed", err);
        return toErrorResult(err);
      }
    },
  );
}
