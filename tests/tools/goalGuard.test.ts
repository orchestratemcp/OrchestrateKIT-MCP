/**
 * MAR-145 (ChatGPT dogfood) — plan_workflow goal-guard, handler level.
 *
 * Exercises the tool through the real in-memory MCP path to verify the handler's
 * two needs_goal branches: the assessGoalInput phrase guard AND the empty-route
 * backstop (a goal that passes the phrase guard but matches no components must
 * return needs_goal, not an empty plan).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/tools/index.js";
import { assessGoalInput } from "../../src/tools/planWorkflow.js";

let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: "goal-guard-test", version: "0.0.0" });
  registerTools(server);
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

async function plan(goal: string): Promise<Record<string, unknown>> {
  const r = await client.callTool({ name: "plan_workflow", arguments: { goal } });
  return r.structuredContent as Record<string, unknown>;
}

// MAR-344: cross-client dogfood (ChatGPT, Claude) showed the first response
// often paraphrases plan_workflow's summary_markdown and drops the A) B) C) D)
// continuation menu unless a user explicitly asks for verbatim rendering. The
// tool description itself must carry that instruction so it doesn't depend on
// server-level instructions being surfaced by every client.
describe("plan_workflow tool description — verbatim rendering (MAR-344)", () => {
  it("instructs the calling client to render summary_markdown verbatim", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "plan_workflow");
    expect(tool).toBeDefined();
    const description = (tool?.description ?? "").toLowerCase();
    expect(description).toContain("verbatim");
    expect(description).toContain("summary_markdown");
  });

  it("instructs the calling client to skip a round whose hidden_when matches", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "plan_workflow");
    const description = (tool?.description ?? "").toLowerCase();
    expect(description).toContain("skip the whole round");
    expect(description).toContain("its own `hidden_when`");
  });
});

describe("plan_workflow needs_goal — handler (MAR-145)", () => {
  it("empty-route backstop: a goal that matches no components → needs_goal (not an empty plan)", async () => {
    // Passes the phrase guard (no marker, not a trivial pattern, >1 word) but
    // names no workflow capability, so it would otherwise compose to 0 steps.
    expect(assessGoalInput("make my situation better overall")).toEqual({ ok: true });
    const sc = await plan("make my situation better overall");
    expect(sc.status).toBe("needs_goal");
    expect(sc.plan_source).toBeUndefined();
    expect(String(sc.reason)).toContain("too vague");
  });

  it("a real, specific goal still produces a plan (not needs_goal)", async () => {
    const sc = await plan(
      "process 100 invoices in parallel and roll back everything if any step fails",
    );
    expect(sc.status).toBeUndefined();
    expect(["playbook", "composed"]).toContain(sc.plan_source);
    expect((sc.recommended_route as unknown[]).length).toBeGreaterThan(0);
  });
});
