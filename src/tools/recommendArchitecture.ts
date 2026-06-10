import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { composeRoute } from "../graph/routeComposer.js";
import { findOverlappingRoutes } from "../graph/playbookOverlap.js";
import { classifySteps, describeStateNeeds } from "../architecture/stepClassifier.js";
import { getDoNotBuildRules } from "../architecture/doNotBuildRules.js";
import {
  formatRecommendation,
  derivePattern,
  deriveNextSteps,
  type ArchitectureData,
  type OutputDepth,
} from "../architecture/architectureFormatter.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const InputShape = {
  goal: z.string().min(5).describe(
    "Describe the AI workflow you want to build. " +
    "Example: 'I want to scrape job listings, normalise the data and store it for search.'",
  ),
  current_stack: z.array(z.string()).default([]).describe(
    "Technologies you are already using (e.g. ['nextjs', 'sqlite', 'openai']). Used to contextualise the stack recommendation.",
  ),
  preferred_models: z.array(z.string()).default([]).describe(
    "LLM providers/models you prefer (e.g. ['openai', 'anthropic']). Informational — does not affect routing.",
  ),
  preferred_frameworks: z.array(z.string()).default([]).describe(
    "Frameworks you prefer (e.g. ['vercel-ai-sdk', 'langchain']). Informational.",
  ),
  integrations: z.array(z.string()).default([]).describe(
    "External services/integrations required (e.g. ['email', 'calendar', 'slack']). Used to surface approval gate requirements.",
  ),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional().describe(
    "Maximum acceptable risk level. High/critical inputs trigger mandatory approval gate guidance.",
  ),
  budget_preference: z.enum(["low", "balanced", "high_quality"]).default("balanced").describe(
    "Cost preference: low = minimise tokens/calls, balanced = good quality at reasonable cost, high_quality = optimise for quality.",
  ),
  latency_preference: z.enum(["low", "balanced", "not_important"]).default("balanced").describe(
    "Latency preference: low = optimise for speed, balanced = acceptable latency, not_important = quality over speed.",
  ),
  local_or_hosted: z.enum(["local", "hosted", "either"]).default("either").describe(
    "Whether you are building a local tool or a hosted product. Affects stack and storage recommendations.",
  ),
  output_depth: z.enum(["brief", "standard", "deep"]).default("standard").describe(
    "brief = pattern + route only. standard = full architecture. deep = + evals, assumptions, implementation guidance.",
  ),
};

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

type RecommendArchitectureOutput = {
  status: "ok" | "candidate_route" | "low_confidence" | "blocked_candidate" | "not_found";
  matched_playbook_ids: string[];
  route_id?: string;
  confidence: number;
  recommendation_markdown: string;
  architecture: {
    pattern: string;
    why: string;
    route: object[];
    llm_driven_steps: string[];
    deterministic_steps: string[];
    state: { components: string[]; needs: string[]; recommendation: string };
    tools: string[];
    approval_gates: string[];
    evals: string[];
    stack: object;
    do_not_build: string[];
  };
  assumptions: string[];
  warnings: string[];
  untested_edges: string[];
  next_steps: string[];
  next_recommended_tools: string[];
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerRecommendArchitecture(server: McpServer): void {
  server.registerTool(
    "recommend_architecture",
    {
      title: "Recommend Architecture",
      description:
        "The main user-facing architecture recommendation tool. " +
        "Accepts a workflow goal and constraints, then returns a concrete, opinionated " +
        "architecture recommendation with route, step classification, stack guidance, " +
        "approval gates, do-not-build anti-patterns and confidence scoring. " +
        "Uses deterministic graph routing — no LLM calls. " +
        "Candidate routes are clearly labelled. High-risk workflows always include approval guidance. " +
        "Use compose_workflow_route for raw route composition without architecture framing.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: false });

        // ── Step 1: Compose route ──
        const composed = composeRoute(
          {
            goal: input.goal,
            must_have_capabilities: [],
            must_avoid: [],
            risk_level: input.risk_level,
            local_or_hosted: input.local_or_hosted,
            output_depth: input.output_depth,
          },
          registry,
        );

        // ── Step 2: Handle no-match ──
        if (composed.status === "not_found") {
          const output: RecommendArchitectureOutput = {
            status: "not_found",
            matched_playbook_ids: [],
            confidence: 0,
            recommendation_markdown:
              `## No architecture found\n\n` +
              `No workflow graph components matched the goal: _"${input.goal}"_\n\n` +
              `Try rephrasing with more specific terms (e.g. "email", "research", "code", "data", "publish").\n\n` +
              `Use \`list_graph_components\` to browse available components.`,
            architecture: {
              pattern: "No pattern — no matching components",
              why: "",
              route: [],
              llm_driven_steps: [],
              deterministic_steps: [],
              state: { components: [], needs: [], recommendation: "" },
              tools: [],
              approval_gates: [],
              evals: [],
              stack: {},
              do_not_build: [],
            },
            assumptions: [],
            warnings: ["No registry components matched this goal."],
            untested_edges: [],
            next_steps: ["Use list_graph_components to browse available workflow components."],
            next_recommended_tools: ["list_graph_components", "compose_workflow_route"],
          };
          logger.debug(`recommend_architecture → not_found`);
          return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
        }

        // ── Step 3: Resolve matched playbooks ──
        const componentIds = composed.recommended_route.map((s) => s.component_id);
        const matchedPlaybooks = registry.playbooks.filter((p) =>
          composed.known_playbooks_reused.includes(p.id),
        );
        const bestPlaybook = matchedPlaybooks[0];

        // ── Step 4: Find best matching known route ──
        const finalComponentSet = new Set(componentIds);
        const routeOverlaps = findOverlappingRoutes(finalComponentSet, registry.routes, 0.6);
        const bestRouteMatch = routeOverlaps[0];
        const routeId = bestRouteMatch?.route_id;

        // ── Step 5: Classify steps ──
        const classification = classifySteps(
          componentIds,
          registry.components,
          bestPlaybook
            ? {
                llm_driven_steps: bestPlaybook.llm_driven_steps,
                deterministic_steps: bestPlaybook.deterministic_steps,
              }
            : undefined,
        );

        // ── Step 6: State needs ──
        const stateInfo = describeStateNeeds(
          classification.state_components,
          input.local_or_hosted,
        );

        // ── Step 7: Stack ──
        const stack = registry.stacks.find(
          (s) => s.id === (bestPlaybook?.stack_id ?? "default_orchestratekit_stack"),
        );
        const stackChoicesSummary: string[] = [];
        if (stack) {
          for (const [area, choice] of Object.entries(stack.choices)) {
            const c = choice as { recommended: string | string[]; reason?: string };
            const rec = Array.isArray(c.recommended) ? c.recommended.join(", ") : c.recommended;
            stackChoicesSummary.push(`**${area}:** \`${rec}\``);
          }
        }

        // ── Step 8: Do-not-build rules ──
        const allAvoidWhen = matchedPlaybooks.flatMap((p) => p.avoid_when);
        const doNotBuild = getDoNotBuildRules({
          goal: input.goal,
          componentIds,
          riskLevel: input.risk_level,
          localOrHosted: input.local_or_hosted,
          matchedPlaybookAvoidWhen: allAvoidWhen,
          routeComponentCount: componentIds.length,
        });

        // ── Step 9: Pattern + why ──
        const pattern = derivePattern(
          componentIds,
          classification.approval_gate_components,
          classification.state_components,
          classification.llm_driven_steps,
        );

        const why =
          bestPlaybook?.recommended_architecture?.why?.trim() ??
          `${pattern} — matched via goal analysis against ${componentIds.length} workflow graph components.`;

        // ── Step 10: Evals ──
        const evals =
          input.output_depth === "deep"
            ? composed.evals_to_add
            : composed.evals_to_add.slice(0, 3);

        // ── Step 11: Next steps ──
        const nextSteps = deriveNextSteps(
          composed.untested_edges,
          doNotBuild,
          evals,
          composed.known_playbooks_reused,
          composed.status,
        );

        // ── Step 12: Warnings ──
        const warnings = [...composed.warnings];
        if (input.risk_level === "high" || input.risk_level === "critical") {
          warnings.push(
            `Risk level \`${input.risk_level}\` requested. ` +
            "Ensure all external write/send/publish/calendar-write actions have a human approval gate.",
          );
        }
        if (input.budget_preference === "low") {
          warnings.push(
            "Budget preference is low. Prefer deterministic pipeline steps over LLM calls where possible. " +
            "Cache LLM outputs aggressively. Avoid streaming for batch workflows.",
          );
        }

        // ── Step 13: Build architecture data for formatter ──
        const archData: ArchitectureData = {
          status: composed.status,
          confidence: composed.confidence,
          routeScore: composed.route_score,
          goal: input.goal,
          pattern,
          why,
          route: composed.recommended_route,
          routeId,
          matchedPlaybookIds: composed.known_playbooks_reused,
          llmDrivenSteps: classification.llm_driven_steps,
          deterministicSteps: classification.deterministic_steps,
          stateComponents: classification.state_components,
          stateNeeds: stateInfo.needs,
          toolComponents: classification.tool_components,
          approvalGates: classification.approval_gate_components,
          evals,
          stackId: stack?.id ?? "default_orchestratekit_stack",
          stackName: stack?.name ?? "Default OrchestrateKit Stack",
          stackChoicesSummary,
          doNotBuild,
          assumptions: composed.assumptions,
          warnings,
          untestedEdges: composed.untested_edges,
          nextSteps,
        };

        const markdown = formatRecommendation(archData, input.output_depth as OutputDepth);

        // ── Step 14: Assemble output ──
        const output: RecommendArchitectureOutput = {
          status: composed.status,
          matched_playbook_ids: composed.known_playbooks_reused,
          route_id: routeId,
          confidence: composed.confidence,
          recommendation_markdown: markdown,
          architecture: {
            pattern,
            why,
            route: composed.recommended_route,
            llm_driven_steps: classification.llm_driven_steps,
            deterministic_steps: classification.deterministic_steps,
            state: stateInfo,
            tools: classification.tool_components,
            approval_gates: classification.approval_gate_components,
            evals,
            stack: stack
              ? { id: stack.id, name: stack.name, summary: stack.summary }
              : {},
            do_not_build: doNotBuild,
          },
          assumptions: composed.assumptions,
          warnings,
          untested_edges: composed.untested_edges,
          next_steps: nextSteps,
          next_recommended_tools: [
            "get_playbook",
            "get_route",
            "get_stack_recommendation",
            "get_relevant_docs",
          ],
        };

        logger.debug(
          `recommend_architecture → status=${output.status} confidence=${composed.confidence} ` +
          `playbooks=${output.matched_playbook_ids.join(",")} route=${output.route_id ?? "none"}`,
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
      } catch (err) {
        logger.error("recommend_architecture failed", err);
        return toErrorResult(err);
      }
    },
  );
}
