import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/tools/index.js";
import { registerResources } from "../../src/resources/index.js";
import {
  playbookResourceUri,
  PLAYBOOK_RESOURCE_URI_PREFIX,
} from "../../src/resources/playbookResources.js";
import { loadRegistry } from "../../src/registry/registryProvider.js";

let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: "playbook-resource-test", version: "0.0.0" });
  registerTools(server);
  registerResources(server);
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

describe("playbook MCP resources", () => {
  it("lists one JSON resource for each default-registry playbook", async () => {
    const registry = loadRegistry();
    const { resources } = await client.listResources();
    const playbookResources = resources.filter((resource) =>
      resource.uri.startsWith(PLAYBOOK_RESOURCE_URI_PREFIX),
    );

    expect(playbookResources).toHaveLength(registry.playbooks.length);

    for (const playbook of registry.playbooks) {
      const resource = playbookResources.find(
        (candidate) => candidate.uri === playbookResourceUri(playbook.id),
      );
      expect(resource, `${playbook.id} resource`).toBeDefined();
      expect(resource?.name).toBe(`playbook.${playbook.id}`);
      expect(resource?.title).toBe(playbook.title);
      expect(resource?.mimeType).toBe("application/json");
    }
  });

  it("reads the same payload returned by get_playbook with default options", async () => {
    const uri = playbookResourceUri("codebase_agent_workflow");
    const resourceResult = await client.readResource({ uri });
    expect(resourceResult.contents).toHaveLength(1);

    const content = resourceResult.contents[0];
    expect(content.uri).toBe(uri);
    expect(content.mimeType).toBe("application/json");
    expect("text" in content).toBe(true);
    if (!("text" in content)) throw new Error("Expected text resource content");

    const toolResult = await client.callTool({
      name: "get_playbook",
      arguments: {
        playbook_id: "codebase_agent_workflow",
        include_beta: false,
        include_graph: false,
        output_format: "full",
      },
    });

    expect(JSON.parse(content.text)).toEqual(toolResult.structuredContent);
  });
});
