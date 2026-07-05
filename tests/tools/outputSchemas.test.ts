/**
 * MAR-163 — output-schema conformance + golden snapshots.
 *
 * Drives the five key tools through the REAL MCP runtime path: a server with the
 * tools registered (each declaring `outputSchema`) linked in-memory to a client.
 * Both the server (Zod) and the client (Ajv, against the published JSON schema)
 * validate `structuredContent` against the schema — so a wrong schema surfaces
 * as a tool error HERE, before it can break a live client.
 *
 * Then it snapshots a normalized view of `structuredContent` so any STRUCTURAL
 * drift (renamed / removed / added fields, a changed discriminant, the MAR-148
 * gate-field class) fails CI, while prose tweaks and volatile mtime-derived
 * fields do not churn the snapshot.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/tools/index.js";

let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: "orchestratekit-mcp-test", version: "0.0.0" });
  registerTools(server);
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

/** Fields whose value is non-deterministic across clones/time (file mtimes). */
const VOLATILE_KEYS = new Set(["last_updated", "freshness"]);

/**
 * Normalize structuredContent for a stable golden snapshot: drop volatile fields,
 * collapse long prose to a marker (so wording edits do not churn the snapshot),
 * and sort object keys. Structure, discriminants, ids, enums, numbers and gate
 * fields are preserved — exactly the contract surface drift would touch.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "string") return value.length > 80 ? "[text]" : value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = VOLATILE_KEYS.has(k)
        ? "[volatile]"
        : normalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

async function structured(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  // A wrong outputSchema makes the client/server throw before this point; an
  // isError result would mean the tool itself failed.
  expect(result.isError ?? false, `${name} returned isError`).toBe(false);
  expect(result.structuredContent, `${name} missing structuredContent`).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
}

const PLAYBOOK_GOAL =
  "scan a codebase, plan changes, edit code, run tests and write a PR summary";
// The composed golden must match no published playbook. MAR-303 gave the
// Postgres→report→Slack shape its own playbook, so this uses the analytics-API
// variant (no DB-source token → scheduled_data_report's gate does not fire).
const COMPOSED_GOAL =
  "Every Monday at 8am, pull last week's signups from our analytics API, summarize them, and post to our team Slack channel.";
const PREAMBLE_GOAL =
  "OrchestrateMCP is a workflow-design advisor that helps you plan safer AI agent workflows.";

describe("MAR-163 — plan_workflow output schema", () => {
  it("playbook plan conforms + golden snapshot", async () => {
    const sc = await structured("plan_workflow", { goal: PLAYBOOK_GOAL });
    expect(sc.plan_source).toBe("playbook");
    expect(sc.status).toBeUndefined(); // a plan has no needs_goal status
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("composed plan conforms + golden snapshot", async () => {
    const sc = await structured("plan_workflow", { goal: COMPOSED_GOAL });
    expect(sc.plan_source).toBe("composed");
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("brief mode conforms + golden snapshot", async () => {
    const sc = await structured("plan_workflow", {
      goal: PLAYBOOK_GOAL,
      output_depth: "brief",
    });
    expect(sc.plan_source).toBe("playbook");
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("needs_goal nudge conforms + golden snapshot (MAR-162)", async () => {
    const sc = await structured("plan_workflow", { goal: PREAMBLE_GOAL });
    expect(sc.status).toBe("needs_goal");
    expect(sc.plan_source).toBeUndefined();
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-169 — validate_playbook_candidate output schema", () => {
  const CANDIDATE_YAML = `id: snap_candidate
version: "0.1.0"
status: draft
title: Snap Candidate
summary: A candidate used for the output-schema snapshot.
workflow_type: data
golden_path_route_id: ""
components: [data_scraper, data_normalizer, deduplication, schema_validation, state_store]
edges: [data_scraper__produces__data_normalizer]
stack_id: default_orchestratekit_stack
risk_level: medium
deterministic_steps: [data_scraper]
failure_modes: [a, b, c, d, e]
evals: [a, b, c, d, e]
sources:
  - title: t
    source_type: internal_note
`;

  it("ok branch conforms + golden snapshot", async () => {
    const sc = await structured("validate_playbook_candidate", {
      playbook_yaml: CANDIDATE_YAML,
    });
    expect(sc.status).toBe("ok");
    expect(sc.qualifies_for).toBe("beta");
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("invalid_yaml branch conforms + golden snapshot", async () => {
    const sc = await structured("validate_playbook_candidate", {
      playbook_yaml: "::: not : yaml : [",
    });
    expect(sc.status).toBe("invalid_yaml");
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-163 — explain_component output schema", () => {
  it("ok branch conforms + golden snapshot", async () => {
    const sc = await structured("explain_component", {
      component_id: "human_approval_gate",
    });
    expect(sc.status).toBe("ok");
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("not_found branch conforms + golden snapshot", async () => {
    const sc = await structured("explain_component", {
      component_id: "does_not_exist",
    });
    expect(sc.status).toBe("not_found");
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-163 — get_playbook output schema", () => {
  it("ok branch conforms + golden snapshot", async () => {
    const sc = await structured("get_playbook", {
      playbook_id: "codebase_agent_workflow",
    });
    expect(typeof sc.status).toBe("string");
    expect(normalize(sc)).toMatchSnapshot();
  });

  it("not_found branch conforms + golden snapshot", async () => {
    const sc = await structured("get_playbook", { playbook_id: "no_such_playbook" });
    expect(sc.status).toBe("not_found");
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-163 — recommend_architecture output schema", () => {
  it("ok branch conforms + golden snapshot", async () => {
    const sc = await structured("recommend_architecture", {
      goal: "read emails, classify intent and draft a reply for approval",
    });
    expect(typeof sc.status).toBe("string");
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-163 — review_workflow_design output schema", () => {
  it("conforms + golden snapshot", async () => {
    const sc = await structured("review_workflow_design", {
      goal: "generate copy and publish to the website",
      component_ids: ["external_publish", "copy_generation"],
    });
    expect(typeof sc.status).toBe("string");
    expect(typeof sc.risk_score).toBe("number");
    expect(normalize(sc)).toMatchSnapshot();
  });
});
