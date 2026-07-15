import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/tools/index.js";
import { ReplayPlanPassportOutputShape } from "../../src/tools/outputSchemas.js";

let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: "orchestratekit-mcp-test", version: "0.0.0" });
  registerTools(server);
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

const plan_passport = {
  contract: "orchestratekit.plan_passport.v1",
  contract_id: "plan_passport:runtime1234",
  goal: "Draft a customer reply and send it only after approval.",
  route: {
    components: [
      { step: 1, component_id: "email_read" },
      { step: 2, component_id: "email_draft" },
      { step: 3, component_id: "human_approval_gate" },
      { step: 4, component_id: "optional_email_send" },
    ],
  },
  safety_gates: { enforced_approval_gates: ["human_approval_gate"] },
  acceptance_tests: [
    {
      id: "external-write-before-approval-forbidden",
      kind: "approval_gate",
      assertion: "No send before approval.",
      evidence_required: ["approval missing fixture", "send call count is zero"],
      severity: "must",
    },
  ],
  build_handoff: { target: "code" },
};

describe("replay_plan_passport tool", () => {
  it("returns schema-conforming structured replay output", async () => {
    const result = await client.callTool({
      name: "replay_plan_passport",
      arguments: {
        plan_passport,
        observed_run: {
          steps: ["email_read", "email_draft", "human_approval_gate", "optional_email_send"],
          events: [
            { type: "approval", component_id: "human_approval_gate", approved: true },
            { type: "send", component_id: "optional_email_send" },
          ],
          checklist: [{ id: "external-write-before-approval-forbidden", status: "pass" }],
          actual: { build_target: "code" },
        },
      },
    });

    expect(result.isError ?? false).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(() => ReplayPlanPassportOutputShape.parse(structured)).not.toThrow();
    expect(structured.status).toBe("pass");
    expect((structured.lab_evidence as Record<string, unknown>).contract).toBe(
      "orchestratekit.lab_evidence.plan_replay.v1",
    );
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (item) => item.type === "text",
    )?.text;
    expect(text).toBe(structured.summary_markdown);
  });

  it("accepts a build_brief wrapper and flags write-before-approval failure", async () => {
    const result = await client.callTool({
      name: "replay_plan_passport",
      arguments: {
        build_brief: { plan_passport },
        observed_run: {
          steps: ["email_read", "email_draft", "human_approval_gate", "optional_email_send"],
          events: [
            { type: "send", component_id: "optional_email_send" },
            { type: "approval", component_id: "human_approval_gate", approved: true },
          ],
          checklist: [{ id: "external-write-before-approval-forbidden", status: "pass" }],
          actual: { build_target: "code" },
        },
      },
    });

    expect(result.isError ?? false).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("fail");
    expect(structured.corpus_contract_candidate).toEqual(
      expect.objectContaining({ human_gate: "required" }),
    );
    expect(structured.linear_issue_candidate).toEqual(
      expect.objectContaining({ human_gate: "required" }),
    );
  });
});
