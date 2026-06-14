import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import type { Registry } from "../registry/registryTypes.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/**
 * record_session_feedback — MAR-126 / SHIP-01
 *
 * The "ship" step of plan → build → connect → test → ship. Captures a session
 * evaluation on a COMPLETED setup and emits a structured, Lab-ready artifact.
 *
 * STATELESS CONTRACT: this tool stores nothing and makes no network calls. The
 * MCP is public, read-only and advisory; accumulation/learning lives in the
 * private OrchestrateLab. This tool only normalises + validates the feedback
 * into the Lab session schema and runs deterministic safety self-checks, then
 * hands back one paste-ready block for the human to save in the Lab.
 */

const RATING = z.number().int().min(1).max(5);

const InputShape = {
  goal: z.string().min(5).describe("The agent goal this session designed (plain language)."),
  route_components: z
    .array(z.string())
    .min(1)
    .describe("Component ids that ended up in the shipped/used route (the completed setup)."),
  route_selected: z
    .string()
    .default("")
    .describe("Route or playbook id/name that was used, if any."),
  client: z.string().default("").describe("Client used, e.g. 'claude' or 'cursor'."),
  model: z.string().default("").describe("Model used, e.g. 'claude-opus-4-8'."),
  user_goal_domain: z
    .string()
    .default("")
    .describe("Domain, e.g. 'content-publishing' | 'research' | 'data-pipeline'."),
  edges_used: z.array(z.string()).default([]).describe("Edge ids used in the route."),
  untested_edges: z
    .array(z.string())
    .default([])
    .describe("Untested edges that shipped → edge validation queue."),
  ratings: z
    .object({
      route_quality: RATING.optional(),
      safety: RATING.optional(),
      specificity: RATING.optional(),
      non_hallucination: RATING.optional(),
      brevity: RATING.optional(),
    })
    .optional()
    .describe("Per-dimension 1-5 scores (MAR-122 rubric). modelOutputRating is their average."),
  overall_rating: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("Overall 1-5 rating (0 = unrated). Used when per-dimension ratings are absent."),
  what_helped: z.string().default("").describe("One line: what OrchestrateKit added."),
  what_was_noise: z.string().default("").describe("One line: what was noise."),
  missing_components: z
    .array(z.string())
    .default([])
    .describe("Capabilities you needed but the registry lacked → component gap queue."),
  wrong_components: z.array(z.string()).default([]).describe("Components that were wrongly matched."),
  new_edge_candidates: z.array(z.string()).default([]).describe("New edge ideas → edge queue."),
  playbook_candidate: z
    .string()
    .default("")
    .describe("Slug for a promotable golden-path playbook → promotion queue."),
  linear_issue_candidates: z
    .array(z.string())
    .default([])
    .describe("Follow-up issues worth filing."),
  baseline_comparison: z
    .string()
    .default("")
    .describe("Optional A/B note vs. a build made WITHOUT the MCP."),
};

type SelfCheck = { severity: "high" | "medium"; component: string; message: string };

/** Deterministic safety self-checks driven by each component's own declared contract. */
function selfChecks(
  routeIds: string[],
  registry: Registry,
): { unknown_components: string[]; checks: SelfCheck[] } {
  const byId = new Map(registry.components.map((c) => [c.id, c]));
  const idSet = new Set(routeIds);
  const unknown_components = routeIds.filter((id) => !byId.has(id));
  const checks: SelfCheck[] = [];

  for (const id of routeIds) {
    const comp = byId.get(id);
    if (!comp) continue;
    for (const req of comp.requires ?? []) {
      if (!idSet.has(req)) {
        checks.push({
          severity: "high",
          component: id,
          message: `\`${id}\` requires \`${req}\`, but it is not in the route. Add it (declared dependency).`,
        });
      }
    }
    for (const rec of comp.recommended_with ?? []) {
      if (!idSet.has(rec)) {
        checks.push({
          severity: "medium",
          component: id,
          message: `\`${id}\` is safer with \`${rec}\`, which is absent. Consider adding it.`,
        });
      }
    }
  }
  return { unknown_components, checks };
}

function averageRating(ratings?: Record<string, number | undefined>): number {
  if (!ratings) return 0;
  const vals = Object.values(ratings).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function buildSessionFeedback(
  input: {
    goal: string;
    route_components: string[];
    route_selected: string;
    client: string;
    model: string;
    user_goal_domain: string;
    edges_used: string[];
    untested_edges: string[];
    ratings?: Record<string, number | undefined>;
    overall_rating?: number;
    what_helped: string;
    what_was_noise: string;
    missing_components: string[];
    wrong_components: string[];
    new_edge_candidates: string[];
    playbook_candidate: string;
    linear_issue_candidates: string[];
    baseline_comparison: string;
  },
  registry: Registry,
) {
  const modelOutputRating =
    averageRating(input.ratings) || (input.overall_rating ?? 0);

  // Lab session schema (MAR-105 SessionForm field names) — paste-ready.
  const session = {
    date: new Date().toISOString().slice(0, 10),
    model: input.model,
    client: input.client,
    prompt: input.goal,
    userGoalDomain: input.user_goal_domain,
    toolsUsed: [] as string[],
    routeSelected: input.route_selected,
    componentsSelected: input.route_components,
    edgesUsed: input.edges_used,
    untestedEdges: input.untested_edges,
    modelOutputRating,
    whatHelped: input.what_helped,
    whatWasNoise: input.what_was_noise,
    missingComponents: input.missing_components,
    wrongComponents: input.wrong_components,
    newEdgeCandidates: input.new_edge_candidates,
    playbookCandidate: input.playbook_candidate,
    linearIssueCandidates: input.linear_issue_candidates,
  };

  const { unknown_components, checks } = selfChecks(input.route_components, registry);

  const lines = (label: string, arr: string[]) => `${label}: ${arr.length ? arr.join(", ") : "—"}`;
  const paste_ready_markdown = [
    `### OrchestrateKit session — ${session.date}`,
    `client: ${session.client || "—"} · model: ${session.model || "—"} · domain: ${session.userGoalDomain || "—"}`,
    `prompt: ${session.prompt}`,
    `routeSelected: ${session.routeSelected || "—"}`,
    lines("componentsSelected", session.componentsSelected),
    lines("edgesUsed", session.edgesUsed),
    lines("untestedEdges", session.untestedEdges),
    `modelOutputRating: ${session.modelOutputRating || "unrated"} (1-5)`,
    `whatHelped: ${session.whatHelped || "—"}`,
    `whatWasNoise: ${session.whatWasNoise || "—"}`,
    lines("missingComponents", session.missingComponents),
    lines("wrongComponents", session.wrongComponents),
    lines("newEdgeCandidates", session.newEdgeCandidates),
    `playbookCandidate: ${session.playbookCandidate || "—"}`,
    lines("linearIssueCandidates", session.linearIssueCandidates),
    input.baseline_comparison ? `baseline_comparison: ${input.baseline_comparison}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    stateless: true as const,
    session,
    rubric: input.ratings ?? null,
    unknown_components,
    self_checks: checks,
    paste_ready_markdown,
    instruction:
      "This tool stored nothing. Save the session in OrchestrateLab to feed the evidence " +
      "queues: paste into http://localhost:3000/sessions/new (run `pnpm dev` in orchestratelab). " +
      "Address any high-severity self_checks before shipping.",
  };
}

export function registerRecordSessionFeedback(server: McpServer): void {
  server.registerTool(
    "record_session_feedback",
    {
      title: "Record Session Feedback",
      description:
        "The 'ship' step after plan_workflow: capture an evaluation of a COMPLETED workflow setup. " +
        "Returns a structured, paste-ready session record aligned to the OrchestrateLab session log, " +
        "plus deterministic safety self-checks (e.g. a component whose required dependency or " +
        "recommended safeguard is missing from the route). " +
        "STATELESS: this tool stores nothing and makes no network calls — it only formats and checks " +
        "your feedback. Save the returned record in OrchestrateLab yourself to accumulate evidence. " +
        "Call this once the user is done designing/building a workflow with OrchestrateKit.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: false });
        const result = buildSessionFeedback(input, registry);
        logger.debug(
          `record_session_feedback → components=${input.route_components.length} self_checks=${result.self_checks.length}`,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        logger.error("record_session_feedback failed", err);
        return toErrorResult(err);
      }
    },
  );
}
