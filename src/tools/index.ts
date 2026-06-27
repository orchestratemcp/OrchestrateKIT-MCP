import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../config.js";
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
};

export function buildHealthCheckResult(): HealthCheckResult {
  const status = getRegistryStatus();
  const build = getRegistryBuild();
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    registry: {
      component_count: status.component_count,
      edge_count: status.edge_count,
      stack_count: status.stack_count,
      route_count: status.route_count,
      playbook_count: status.playbook_count,
      worker_count: status.worker_count,
      untested_edge_pct: status.untested_edge_pct,
      stale_component_count: status.stale_component_count,
    },
    build,
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
        "Returns the server name, version, a summary of loaded registry entities (components, edges, stacks, routes, playbooks), and a build fingerprint. The `build.stale` field is true when the dist/ registry is outdated vs the source — run `pnpm build` to fix. Use this to confirm the MCP server is running and the registry is fresh.",
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
