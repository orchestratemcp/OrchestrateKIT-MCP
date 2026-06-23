#!/usr/bin/env node
/**
 * `pnpm demo` — a human-readable smoke demo (MAR-158 / M5).
 *
 * Spins up the real MCP server in-memory, connects a real MCP client over a
 * linked transport, and drives a handful of calls so you can SEE the planner
 * working end-to-end (tools registered, output schemas validated, structured
 * content returned). It exercises the features shipped in the M5 sprint:
 *   - health_check          → registry counts + validated-edge % (MAR-164)
 *   - plan_workflow (plan)   → MAR-101 status header + structuredContent (MAR-163)
 *   - plan_workflow (guard)  → needs_goal on preamble input (MAR-162)
 *   - plan_workflow (negate) → "drafts only, no email" drops email steps (MAR-161)
 *   - explain_component      → plain-language operator output
 *
 * This is a DEMO, not a gate. The gates are `pnpm verify` + `pnpm probe`.
 * Run:  pnpm demo
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bootstrapNodeRegistry } from "../src/registry/nodeRegistryBootstrap.js";
import { registerTools } from "../src/tools/index.js";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function h(title: string): void {
  console.log(`\n${BOLD}${"─".repeat(72)}${RESET}`);
  console.log(`${BOLD}${title}${RESET}`);
  console.log(`${BOLD}${"─".repeat(72)}${RESET}`);
}

function ok(msg: string): void {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}

async function main(): Promise<void> {
  bootstrapNodeRegistry();

  const server = new McpServer({ name: "orchestratemcp-demo", version: "0.0.0" });
  registerTools(server);
  const client = new Client({ name: "demo-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    // Tools with an outputSchema return structuredContent; the rest (e.g.
    // health_check) return JSON in the text content — fall back to that.
    let sc = res.structuredContent as Record<string, unknown> | undefined;
    if (!sc) {
      const text = (res.content as Array<{ type: string; text?: string }> | undefined)?.find(
        (c) => c.type === "text",
      )?.text;
      if (text) {
        try {
          sc = JSON.parse(text) as Record<string, unknown>;
        } catch {
          /* leave undefined */
        }
      }
    }
    return { isError: res.isError ?? false, sc };
  };

  // ── tool discovery ──
  h("Tool discovery (what a connected client sees)");
  const { tools } = await client.listTools();
  ok(`${tools.length} tools registered`);
  console.log(
    `${DIM}    ${tools.map((t) => t.name).join(", ")}${RESET}`,
  );
  const withSchema = tools.filter((t) => t.outputSchema).map((t) => t.name);
  ok(`${withSchema.length} declare an output schema (MAR-163): ${withSchema.join(", ")}`);

  // ── health_check: validated-edge % (MAR-164) ──
  h("health_check — registry & validated-connection coverage (MAR-164)");
  const health = await call("health_check", {});
  const reg = (health.sc?.registry ?? {}) as Record<string, number>;
  ok(`components: ${reg.component_count}  ·  edges: ${reg.edge_count}  ·  playbooks: ${reg.playbook_count}`);
  const tested = (reg.edge_count ?? 0) - Math.round((reg.untested_edge_pct ?? 0) / 100 * (reg.edge_count ?? 0));
  ok(`validated edges: ${tested}/${reg.edge_count} (${(100 - (reg.untested_edge_pct ?? 0)).toFixed(1)}% tested)`);

  // ── plan_workflow: a real plan + the MAR-101 status header (MAR-163 structuredContent) ──
  h("plan_workflow — a real plan (MAR-101 status header + structured output)");
  const plan = await call("plan_workflow", {
    goal: "process 100 invoices in parallel and roll back everything if any step fails",
  });
  ok(`plan_source: ${plan.sc?.plan_source}  ·  route_status: ${plan.sc?.route_status}  ·  structuredContent present: ${plan.sc !== undefined}`);
  const steps = (plan.sc?.recommended_route as Array<{ component_id: string }> | undefined) ?? [];
  ok(`route (${steps.length} steps): ${steps.map((s) => s.component_id).join(" → ")}`);
  console.log(`${DIM}    ── status header (top of summary_markdown) ──${RESET}`);
  const header = String(plan.sc?.summary_markdown ?? "").split("\n").slice(0, 9);
  for (const line of header) console.log(`${DIM}    ${line}${RESET}`);

  // ── goal-guard: needs_goal on preamble input (MAR-162) ──
  h("plan_workflow — goal-guard rejects echoed preamble (MAR-162)");
  const guard = await call("plan_workflow", {
    goal: "OrchestrateMCP is a workflow-design advisor that plans safer AI agent workflows.",
  });
  ok(`status: ${guard.sc?.status}  (expected: needs_goal)`);
  ok(`reason: ${guard.sc?.reason}`);

  // ── negation engine: "drafts only, no email" drops email steps (MAR-161) ──
  h("plan_workflow — negation engine drops what you forbade (MAR-161)");
  const negate = await call("plan_workflow", {
    goal: "Generate three social post variants from this blog, drafts only, and send them for human approval.",
  });
  const negIds = ((negate.sc?.recommended_route as Array<{ component_id: string }> | undefined) ?? []).map(
    (s) => s.component_id,
  );
  const leaked = negIds.filter((id) => id === "email_draft" || id === "optional_email_send");
  ok(`route: ${negIds.join(", ")}`);
  ok(`email components leaked: ${leaked.length === 0 ? "none ✓ (drafts-only honoured)" : leaked.join(", ")}`);

  // ── explain_component: plain-language operator output ──
  h("explain_component — plain-language explanation (MAR-136)");
  const explain = await call("explain_component", { component_id: "human_approval_gate" });
  ok(`status: ${explain.sc?.status}  ·  component: ${explain.sc?.name}`);
  const ex = String(explain.sc?.explanation ?? "").split("\n").slice(0, 4);
  for (const line of ex) console.log(`${DIM}    ${line}${RESET}`);

  await client.close();
  await server.close();

  h("Demo complete");
  ok("Everything above ran through the real in-memory MCP client/server path.");
  console.log(`${DIM}    The CI gates are: pnpm verify  ·  pnpm probe  ·  pnpm build${RESET}\n`);
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
