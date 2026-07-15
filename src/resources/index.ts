import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlaybookResources } from "./playbookResources.js";

export function registerResources(server: McpServer): void {
  registerPlaybookResources(server);
}
