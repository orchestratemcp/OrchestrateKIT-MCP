import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryProvider.js";
import { buildGetPlaybookOutput } from "../tools/getPlaybook.js";

export const PLAYBOOK_RESOURCE_URI_PREFIX = "orchestratekit://playbooks/";

export function playbookResourceUri(playbookId: string): string {
  return `${PLAYBOOK_RESOURCE_URI_PREFIX}${encodeURIComponent(playbookId)}`;
}

export function readPlaybookResourceText(playbookId: string): string {
  return JSON.stringify(
    buildGetPlaybookOutput({
      playbook_id: playbookId,
      include_beta: false,
      include_graph: false,
      output_format: "full",
    }),
  );
}

export function registerPlaybookResources(server: McpServer): void {
  const registry = loadRegistry();

  for (const playbook of registry.playbooks) {
    const uri = playbookResourceUri(playbook.id);

    server.registerResource(
      `playbook.${playbook.id}`,
      uri,
      {
        title: playbook.title,
        description:
          `Published OrchestrateMCP playbook for ${playbook.workflow_type}. ` +
          "Content is the same JSON payload returned by get_playbook with default options.",
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: readPlaybookResourceText(playbook.id),
          },
        ],
      }),
    );
  }
}
