import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION, MIN_COMPONENTS, MIN_EDGES } from "../config.js";
import { getRegistryStatus, getRegistryBuild } from "../registry/registryProvider.js";
import type { RegistryBuild } from "../registry/buildInfoTypes.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { registerListGraphComponents } from "./listGraphComponents.js";
import { registerGetGraphComponent } from "./getGraphComponent.js";
import { registerListGraphEdges } from "./listGraphEdges.js";
import { registerGetGraphEdge } from "./getGraphEdge.js";
import { registerGetStackRecommendation } from "./getStackRecommendation.js";
import { registerListKnownRoutes } from "./listKnownRoutes.js";
import { registerGetRoute } from "./getRoute.js";
import { registerComposeWorkflowRoute } from "./composeWorkflowRoute.js";
import { registerGetPlaybook } from "./getPlaybook.js";
import { registerGetRelevantDocs } from "./getRelevantDocs.js";
import { registerRecommendArchitecture } from "./recommendArchitecture.js";
import { registerReviewWorkflowDesign } from "./reviewWorkflowDesign.js";
import { registerPlanWorkflow } from "./planWorkflow.js";
import { registerRecordSessionFeedback } from "./recordSessionFeedback.js";
import { registerExplainComponent } from "./explainComponent.js";
import { registerValidatePlaybookCandidate } from "./validatePlaybookCandidate.js";
import { registerExportBuildBrief } from "./exportBuildBrief.js";

export type RegistrySummary = {
  component_count: number;
  edge_count: number;
  stack_count: number;
  route_count: number;
  playbook_count: number;
  worker_count: number;
  /** Percentage of edges with tested=false (MAR-92). */
  untested_edge_pct: number;
  /** Components whose registry YAML is >90 days old by file mtime (MAR-137). */
  stale_component_count: number;
};

export type { RegistryBuild };

export type HealthCheckResult = {
  name: string;
  version: string;
  registry: RegistrySummary;
  build: RegistryBuild;
  /**
   * MAR-220 release-trust gate: true when the running build is fresh and the
   * registry meets the published count floor — i.e. safe to show off live. When
   * false, `demo_blockers` lists exactly why.
   */
  safe_to_demo: boolean;
  /** Human-readable reasons safe_to_demo is false. Empty when safe. */
  demo_blockers: string[];
};

/**
 * Aggregate the release-trust signals (MAR-220). Combines the count floor
 * (MIN_COMPONENTS/MIN_EDGES), every-edge-tested, dist staleness (MAR-114),
 * and process staleness (MAR-141) into a single safe-to-demo verdict.
 */
export function computeDemoBlockers(
  registry: RegistrySummary,
  build: RegistryBuild,
): string[] {
  const blockers: string[] = [];
  if (registry.component_count < MIN_COMPONENTS) {
    blockers.push(
      `component_count ${registry.component_count} below floor ${MIN_COMPONENTS}`,
    );
  }
  if (registry.edge_count < MIN_EDGES) {
    blockers.push(`edge_count ${registry.edge_count} below floor ${MIN_EDGES}`);
  }
  if (registry.untested_edge_pct > 0) {
    blockers.push(`${registry.untested_edge_pct}% of edges are untested`);
  }
  if (build.stale) {
    blockers.push("build is stale vs source — run `pnpm build` / `pnpm deploy:worker`");
  }
  if (build.process_stale) {
    blockers.push("running process is older than the build — restart + reconnect");
  }
  return blockers;
}

export function buildHealthCheckResult(): HealthCheckResult {
  const status = getRegistryStatus();
  const build = getRegistryBuild();
  const registry: RegistrySummary = {
    component_count: status.component_count,
    edge_count: status.edge_count,
    stack_count: status.stack_count,
    route_count: status.route_count,
    playbook_count: status.playbook_count,
    worker_count: status.worker_count,
    untested_edge_pct: status.untested_edge_pct,
    stale_component_count: status.stale_component_count,
  };
  const demo_blockers = computeDemoBlockers(registry, build);
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    registry,
    build,
    safe_to_demo: demo_blockers.length === 0,
    demo_blockers,
  };
}

export function registerTools(server: McpServer): void {
  registerListGraphComponents(server);
  registerGetGraphComponent(server);
  registerListGraphEdges(server);
  registerGetGraphEdge(server);
  registerGetStackRecommendation(server);
  registerListKnownRoutes(server);
  registerGetRoute(server);
  registerComposeWorkflowRoute(server);
  registerGetPlaybook(server);
  registerGetRelevantDocs(server);
  registerRecommendArchitecture(server);
  registerReviewWorkflowDesign(server);
  registerPlanWorkflow(server);
  registerRecordSessionFeedback(server);
  registerExplainComponent(server);
  registerValidatePlaybookCandidate(server);
  registerExportBuildBrief(server);

  server.registerTool(
    "health_check",
    {
      title: "Health Check",
      description:
        "Returns the server name, version, a summary of loaded registry entities (components, edges, stacks, routes, playbooks), and a build fingerprint. The `build.stale` field is true when the dist/ registry is outdated vs the source — run `pnpm build` to fix. The `safe_to_demo` field is true only when the build is fresh and the registry meets the published count floor; `demo_blockers` lists any reasons it is not. Use this to confirm the MCP server is running and the registry is fresh.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = buildHealthCheckResult();
        logger.debug(`health_check → ${JSON.stringify(result)}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        logger.error("health_check failed", err);
        return toErrorResult(err);
      }
    },
  );
}
