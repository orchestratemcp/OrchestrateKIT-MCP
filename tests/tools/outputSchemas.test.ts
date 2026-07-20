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
import { ExportBuildBriefOutputShape } from "../../src/tools/outputSchemas.js";

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
const VOLATILE_KEYS = new Set(["last_updated", "freshness", "generated_at"]);

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

function normalizeExportBuildBrief(value: unknown): unknown {
  const out = normalize(value) as Record<string, unknown>;
  const pkg = out.artifact_package as Record<string, unknown> | undefined;
  const templates = pkg?.linear_issue_templates;
  if (pkg && Array.isArray(templates)) {
    pkg.linear_issue_templates = templates.map((template) => {
      const t = template as Record<string, unknown>;
      const fields = t.fields as Record<string, unknown> | undefined;
      return {
        id: t.id,
        milestone_id: t.milestone_id,
        title: t.title,
        field_keys: Object.keys(fields ?? {}).sort().join("|"),
        markdown: t.markdown,
      };
    });
  }
  return out;
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

async function rawToolResult(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false, `${name} returned isError`).toBe(false);
  return result;
}

const PLAYBOOK_GOAL =
  "scan a codebase, plan changes, edit code, run tests and write a PR summary";
const EXPORT_BRIEF_GOAL =
  "read emails, detect leads and write a note to the CRM for each lead";
const READONLY_PR_GOAL =
  "When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.";
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

  it("MAR-345: text content is summary_markdown, not JSON for clients to re-render", async () => {
    const result = await rawToolResult("plan_workflow", {
      goal: "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.",
      output_depth: "brief",
    });
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    )?.text;
    const sc = result.structuredContent as Record<string, unknown>;
    expect(text).toBe(sc.summary_markdown);
    expect(text).toContain("**Route:**");
    // MAR-398: Layer 1 is a decision card; the walkthrough moved to `standard`.
    expect(text).toContain("**Risks & safeguards:**");
    expect(sc.next_action_menu).toBeDefined();
    expect(text).not.toContain('"recommended_route"');
    expect(text).not.toContain('"next_action_menu"');
  });

  it("needs_goal nudge conforms + golden snapshot (MAR-162)", async () => {
    const sc = await structured("plan_workflow", { goal: PREAMBLE_GOAL });
    expect(sc.status).toBe("needs_goal");
    expect(sc.plan_source).toBeUndefined();
    expect(normalize(sc)).toMatchSnapshot();
  });
});

describe("MAR-249 — export_build_brief output schema", () => {
  it("runtime structuredContent conforms + golden snapshot", async () => {
    const plan = await structured("plan_workflow", {
      goal: EXPORT_BRIEF_GOAL,
      output_depth: "technical",
    });
    const sc = await structured("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt", "linear"],
      llm_provider: "anthropic",
    });

    const pkg = sc.artifact_package as Record<string, unknown>;
    expect(pkg.compiler).toBe("export_build_brief.artifact_compiler.v1");
    expect(pkg.status).toBe("compiled");
    expect(sc.provenance_tag).toBe("registry-grounded");
    expect(normalizeExportBuildBrief(sc)).toMatchSnapshot();
  });

  it("compact structuredContent conforms and text content is brief_markdown", async () => {
    const plan = await structured("plan_workflow", {
      goal: EXPORT_BRIEF_GOAL,
      output_depth: "technical",
    });
    const result = await rawToolResult("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt", "linear"],
      delivery_mode: "compact",
      llm_provider: "anthropic",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (item) => item.type === "text",
    )?.text;

    expect(() => ExportBuildBriefOutputShape.parse(sc)).not.toThrow();
    expect((sc.delivery as Record<string, unknown>).mode).toBe("compact");
    expect(sc.artifact_package).toBeUndefined();
    expect(text).toBe(sc.brief_markdown);
    expect(normalizeExportBuildBrief(sc)).toMatchSnapshot();
  });

  it("explicit full delivery keeps artifact_package and legacy JSON text", async () => {
    const plan = await structured("plan_workflow", {
      goal: EXPORT_BRIEF_GOAL,
      output_depth: "technical",
    });
    const result = await rawToolResult("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt", "linear"],
      delivery_mode: "full",
      llm_provider: "anthropic",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (item) => item.type === "text",
    )?.text;

    expect((sc.delivery as Record<string, unknown>).mode).toBe("full");
    expect(sc.artifact_package).toBeDefined();
    expect(JSON.parse(text ?? "null")).toEqual(sc);
  });

  it("plan_passport delivery emits deterministic build contract + failure-mode pack", async () => {
    const plan = await structured("plan_workflow", {
      goal: EXPORT_BRIEF_GOAL,
      output_depth: "technical",
    });
    const result = await rawToolResult("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt"],
      delivery_mode: "plan_passport",
      llm_provider: "anthropic",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (item) => item.type === "text",
    )?.text;
    const passport = sc.plan_passport as Record<string, unknown>;
    const tests = passport.acceptance_tests as Array<Record<string, unknown>>;

    expect(() => ExportBuildBriefOutputShape.parse(sc)).not.toThrow();
    expect((sc.delivery as Record<string, unknown>).mode).toBe("plan_passport");
    expect(sc.artifact_package).toBeUndefined();
    expect(sc.handoffs).toBeUndefined();
    expect(text).toBe(sc.passport_markdown);
    expect(passport.contract).toBe("orchestratekit.plan_passport.v1");
    expect(String(passport.contract_id)).toMatch(/^plan_passport:[a-f0-9]{16}$/);
    expect(tests.filter((test) => test.kind === "failure_mode").length).toBeGreaterThanOrEqual(5);
    expect(tests.map((test) => test.id)).toEqual(
      expect.arrayContaining([
        "external-write-duplicate-event-idempotency",
        "external-write-partial-failure-stops-handoff",
        "external-write-missing-expired-scope",
        "external-write-retry-idempotency-violation",
      ]),
    );
    expect(normalizeExportBuildBrief(sc)).toMatchSnapshot();
  });

  it("plan_passport includes read-only/no-write tests for readonly PR review plans", async () => {
    const plan = await structured("plan_workflow", {
      goal: READONLY_PR_GOAL,
      output_depth: "technical",
    });
    const sc = await structured("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt"],
      delivery_mode: "plan_passport",
      llm_provider: "deterministic_first",
    });
    const passport = sc.plan_passport as Record<string, unknown>;
    const tests = passport.acceptance_tests as Array<Record<string, unknown>>;
    expect(tests.map((test) => test.id)).toEqual(
      expect.arrayContaining([
        "read-only-no-code-or-repo-write",
        "read-only-output-is-report-only",
      ]),
    );
  });

  it("plan_passport includes loop and fan-out tests when those structures are present", async () => {
    const sc = await structured("export_build_brief", {
      goal: "Process invoices in parallel, collect every item result, retry failures, and stop after three passes.",
      plan_source: "composed",
      route_status: "candidate",
      recommended_route: [
        { step: 1, component_id: "scheduled_trigger", purpose: "Start the batch.", model_tier: "none", risk_level: "low" },
        { step: 2, component_id: "loop_controller", purpose: "Bound retries.", model_tier: "none", risk_level: "medium" },
        { step: 3, component_id: "fan_out_collector", purpose: "Merge per-item results.", model_tier: "none", risk_level: "medium" },
      ],
      safety_review: {
        status: "warnings",
        risk_score: 30,
        blocking_issues: [],
        warnings: [],
        approval_gates_required: [],
      },
      automation_clearance: {
        level: "L1",
        autonomous_allowed: true,
        reason: "Internal state updates only in this synthetic contract test.",
        required_controls: ["audit_log"],
        highest_action_components: ["state_store"],
      },
      enforced_approval_gates: [],
      untested_edges: [],
      avoid_when_violations: [],
      evals_to_add: [],
      design_notes: [],
      worker_pipeline: null,
      loop_guidance: {
        playbook_id: "dynamic_worker_loop",
        worker_sequence: ["planner", "tester"],
        loop_contract: {
          max_iterations: 3,
          stop_condition: "all invoices processed",
          escalation_condition: "same item fails twice",
          state_required: true,
          audit_required: true,
          human_gate_required_for: [],
          reviewer_independent: true,
          no_write_until_final_gate: true,
        },
        guardrail_checklist: ["Persist per-item state before retry."],
      },
      approval_gate_advisory: null,
      handoff_targets: ["prompt"],
      delivery_mode: "plan_passport",
      llm_provider: "deterministic_first",
    });
    const passport = sc.plan_passport as Record<string, unknown>;
    const tests = passport.acceptance_tests as Array<Record<string, unknown>>;
    expect(tests.map((test) => test.id)).toEqual(
      expect.arrayContaining([
        "loop-termination-bounded",
        "fan-out-item-failure-handling",
      ]),
    );
  });

  it("missing llm_provider returns structured needs_input before artifacts", async () => {
    const plan = await structured("plan_workflow", {
      goal: EXPORT_BRIEF_GOAL,
      output_depth: "technical",
    });
    const result = await rawToolResult("export_build_brief", {
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates ?? [],
      untested_edges: plan.untested_edges ?? [],
      avoid_when_violations: plan.avoid_when_violations ?? [],
      evals_to_add: plan.evals_to_add ?? [],
      design_notes: plan.design_notes ?? [],
      worker_pipeline: plan.worker_pipeline ?? null,
      loop_guidance: plan.loop_guidance ?? null,
      approval_gate_advisory: plan.approval_gate_advisory ?? null,
      handoff_targets: ["prompt", "linear"],
      delivery_mode: "compact",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(() => ExportBuildBriefOutputShape.parse(sc)).not.toThrow();
    expect(sc.status).toBe("needs_input");
    expect(sc.delivery).toBeUndefined();
    expect(sc.connect).toBeUndefined();
    const needs = sc.needs_input as Record<string, unknown>;
    expect(needs.kind).toBe("llm_provider");
    expect(JSON.stringify(needs)).toContain("OpenRouter");
    expect(JSON.stringify(needs)).toContain("Anthropic");
    expect(JSON.stringify(needs)).toContain("deterministic_first");
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
