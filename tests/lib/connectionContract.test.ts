/**
 * MAR-383 / DASH-08 — the connection contract (Connect, UX spine step 4).
 *
 * These tests exist because the failure mode here is not a crash, it is a LIE:
 * copy that implies an existing claude.ai connection will work in the deployed
 * agent, a "one click" button for a path nobody has built, or a Gmail
 * connection that hides Google's verification cost. Each honesty rule from the
 * module docblock is asserted explicitly below.
 */
import { describe, it, expect } from "vitest";
import {
  AUTHORIZATION_NOTE,
  AUTHORIZATION_NOTE_SHORT,
  buildConnectionContract,
  compactConnectionContract,
  renderConnectionContract,
  type ConnectionRequirement,
} from "../../src/lib/connectionContract.js";
import {
  planWorkflow,
  LAYER1_MAX_CHARS,
  connectionContractForComponents,
} from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { buildConnectArtifacts, s11Connect } from "../../src/lib/connectContract.js";

const registry = loadRegistry();

const GOLDEN =
  "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
  "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
  "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
  "the email. I will be present for approval and I want visible run logs.";

const byId = (contract: ConnectionRequirement[], id: string): ConnectionRequirement => {
  const found = contract.find((c) => c.connection_id === id);
  expect(found, `expected a "${id}" connection in [${contract.map((c) => c.connection_id)}]`).toBeDefined();
  return found!;
};

/** Every string a client could render, flattened. */
const allStrings = (contract: ConnectionRequirement[]): string[] =>
  contract.flatMap((c) => [
    c.label,
    c.grants,
    c.verification_requirement ?? "",
    ...c.acquisition_paths.flatMap((p) => [p.label, p.how, p.reuse, p.caveat ?? ""]),
  ]);

describe("MAR-383 — acquisition-path ranking", () => {
  const CASES = [
    { name: "Gmail", components: ["email_read", "email_draft"], connection: "gmail" },
    { name: "Google Calendar", components: ["calendar_lookup", "calendar_write"], connection: "google_calendar" },
    { name: "Slack", components: ["slack_notification"], connection: "slack" },
    { name: "HubSpot", components: ["crm_note_write"], connection: "hubspot" },
  ];

  for (const c of CASES) {
    it(`${c.name}: paths are ranked broker → MCP server → raw OAuth`, () => {
      const connection = byId(connectionContractForComponents(c.components), c.connection);
      expect(connection.acquisition_paths.map((p) => p.kind)).toEqual([
        "broker_connection_mcp",
        "mcp_server",
        "raw_oauth",
      ]);
      // rank is 1..n and strictly ascending — DASH sorts on it.
      expect(connection.acquisition_paths.map((p) => p.rank)).toEqual([1, 2, 3]);
    });

    it(`${c.name}: the actionable path is the first NON-planned one`, () => {
      const connection = byId(connectionContractForComponents(c.components), c.connection);
      const actionable = connection.acquisition_paths.find(
        (p) => p.kind === connection.actionable_path_kind,
      );
      expect(actionable?.availability).not.toBe("planned");
      // …and it is genuinely the FIRST such path, not just any of them.
      const firstNonPlanned = connection.acquisition_paths.find((p) => p.availability !== "planned");
      expect(connection.actionable_path_kind).toBe(firstNonPlanned?.kind);
    });
  }

  it("a provider with no MCP server at all still offers the connect.mjs escape hatch", () => {
    // optional_email_send (SendGrid/Resend) has mcp_server.availability "none".
    const contract = connectionContractForComponents(["optional_email_send"]);
    expect(contract).toHaveLength(1);
    const kinds = contract[0].acquisition_paths.map((p) => p.kind);
    expect(kinds).not.toContain("mcp_server");
    expect(kinds).toContain("raw_oauth");
    expect(contract[0].actionable_path_kind).toBe("raw_oauth");
  });

  it("one Gmail authorization serves read, compose AND draft-save — not three connections", () => {
    const contract = connectionContractForComponents([
      "email_read",
      "email_draft",
      "gmail_draft_write",
    ]);
    expect(contract).toHaveLength(1);
    expect(contract[0].serves_components).toEqual([
      "email_read",
      "email_draft",
      "gmail_draft_write",
    ]);
  });
});

describe("MAR-383 — ownership location", () => {
  it("each path names where the provider token actually ends up living", () => {
    const gmail = byId(connectionContractForComponents(["email_read"]), "gmail");
    const owner = (kind: string) =>
      gmail.acquisition_paths.find((p) => p.kind === kind)?.ownership_location;
    // Broker/DASH holds it → the agent merely consumes the connection.
    expect(owner("broker_connection_mcp")).toBe("dash");
    // The MCP server holds it → owned outside the agent, by the user.
    expect(owner("mcp_server")).toBe("external_manager");
    // connect.mjs writes the agent's own .env → dies with the agent.
    expect(owner("raw_oauth")).toBe("agent");
  });

  it("ownership_location is always one of the three MAR-383 locations", () => {
    const contract = connectionContractForComponents([
      "email_read",
      "calendar_write",
      "slack_notification",
      "crm_note_write",
    ]);
    for (const c of contract) {
      for (const p of c.acquisition_paths) {
        expect(["dash", "agent", "external_manager"]).toContain(p.ownership_location);
      }
    }
  });
});

describe("MAR-383 — honesty rules", () => {
  const contract = connectionContractForComponents([
    "email_read",
    "email_draft",
    "gmail_draft_write",
    "calendar_lookup",
    "calendar_write",
    "slack_notification",
    "crm_note_write",
  ]);

  it("RULE 1: nothing claims an existing claude.ai/Cursor grant transfers to our runtime", () => {
    // The lie this guards against is "already connected in Claude → nothing to
    // do here". Any copy pairing another client with reuse/transfer is banned.
    const TRANSFER_CLAIMS = [
      /already connected/i,
      /reuse[sd]? your (claude|cursor|chatgpt)/i,
      /transfers? (to|from) (claude|cursor|the runtime)/i,
      /no (re-?)?authoriz/i,
      /carries over to (the )?(deployed|runtime|agent)/i,
    ];
    for (const s of allStrings(contract)) {
      for (const claim of TRANSFER_CLAIMS) {
        expect(s, `transfer claim in: "${s}"`).not.toMatch(claim);
      }
    }
    // And the constant that states the truth says it plainly.
    expect(AUTHORIZATION_NOTE).toMatch(/cannot be reused by the deployed agent/);
    expect(AUTHORIZATION_NOTE_SHORT).toMatch(/does not carry to the deployed agent/);
  });

  it("RULE 2: a 'planned' path is never rendered as one click or as available", () => {
    const planned = contract.flatMap((c) =>
      c.acquisition_paths.filter((p) => p.availability === "planned"),
    );
    expect(planned.length, "the broker path should still be planned").toBeGreaterThan(0);
    for (const p of planned) {
      for (const s of [p.label, p.how, p.reuse, p.caveat ?? ""]) {
        expect(s, `"one click" on a planned path: "${s}"`).not.toMatch(/one[- ]click/i);
        expect(s, `"available now" on a planned path: "${s}"`).not.toMatch(/available now/i);
      }
      // It must say, in the field a client renders as the call to action, that
      // there is nothing to do yet.
      expect(p.how).toMatch(/not available yet/i);
    }
    // No connection may point its actionable CTA at a planned path.
    for (const c of contract) {
      const actionable = c.acquisition_paths.find((p) => p.kind === c.actionable_path_kind);
      expect(actionable?.availability, `${c.connection_id} CTA`).not.toBe("planned");
    }
  });

  it("RULE 3: restricted-scope providers disclose the verification requirement", () => {
    // Gmail's scopes are restricted by Google → verification + possibly CASA.
    const gmail = byId(contract, "gmail");
    expect(gmail.verification_requirement).toBeTruthy();
    expect(gmail.verification_requirement).toMatch(/verification/i);
    expect(gmail.verification_requirement).toMatch(/CASA/);

    // Calendar scopes are sensitive but NOT restricted — no false alarm.
    expect(byId(contract, "google_calendar").verification_requirement).toBeNull();
    expect(byId(contract, "slack").verification_requirement).toBeNull();
  });

  it("no acquisition path promises 'one click' anywhere, at any availability", () => {
    for (const s of allStrings(contract)) {
      expect(s, `"one click" in: "${s}"`).not.toMatch(/one[- ]click/i);
    }
  });
});

describe("MAR-383 — surfaces", () => {
  it("Layer 1 names the connections and the one-authorization fact, without scopes or packages", () => {
    for (const depth of ["guided", "brief"] as const) {
      const r = planWorkflow(
        { goal: GOLDEN, must_have_capabilities: [], must_avoid: [], output_depth: depth },
        registry,
      );
      const md = r.summary_markdown;
      const connect = md.match(/\*\*Connect:\*\* (.+)/)?.[1] ?? "";

      expect(connect).toContain("Gmail");
      expect(connect).toContain("Google Calendar");
      expect(connect).toContain(AUTHORIZATION_NOTE_SHORT);

      // Raw scopes and package names are Layer-2 concerns and must not leak.
      expect(connect).not.toMatch(/googleapis\.com\/auth/);
      expect(connect).not.toMatch(/@modelcontextprotocol/);
      expect(md, "no scope URL anywhere in Layer 1").not.toMatch(/googleapis\.com\/auth/);
    }
  });

  it("Layer 1 stays under the brevity bound, and this change REDUCED it", () => {
    for (const depth of ["guided", "brief"] as const) {
      const r = planWorkflow(
        { goal: GOLDEN, must_have_capabilities: [], must_avoid: [], output_depth: depth },
        registry,
      );
      const len = r.summary_markdown.length;
      expect(len, `${depth} length ${len} <= ${LAYER1_MAX_CHARS}`).toBeLessThanOrEqual(
        LAYER1_MAX_CHARS,
      );
      // Pre-MAR-383 the golden prompt rendered 3679 with a component-shaped
      // Connect line. Collapsing it to connections must keep it BELOW that even
      // though the honesty clause was added — this change may never be the
      // reason the bound is raised.
      expect(len, `${depth} must be shorter than the pre-MAR-383 3679`).toBeLessThan(3679);
    }
  });

  it("the plan carries the connection contract, compact by default and full at technical depth", () => {
    const plan = (depth: "guided" | "technical") =>
      planWorkflow(
        { goal: GOLDEN, must_have_capabilities: [], must_avoid: [], output_depth: depth },
        registry,
      ).connection_contract;

    const compact = plan("guided");
    const full = plan("technical");

    // Both depths carry the honesty-bearing fields…
    for (const c of [...compact, ...full]) {
      expect(c.actionable_path_kind).toBeTruthy();
      expect(c.acquisition_paths.length).toBeGreaterThan(0);
    }
    expect(byId(compact, "gmail").verification_requirement).toBeTruthy();
    // …and only the per-path prose is depth-gated.
    expect(byId(full, "gmail").acquisition_paths[0].how).not.toBe("");
    expect(byId(compact, "gmail").acquisition_paths[0].how).toBe("");
  });

  it("compactConnectionContract drops only prose, never a path or a disclosure", () => {
    const full = connectionContractForComponents(["email_read", "calendar_write"]);
    const compact = compactConnectionContract(full);
    expect(compact.map((c) => c.connection_id)).toEqual(full.map((c) => c.connection_id));
    for (let i = 0; i < full.length; i++) {
      expect(compact[i].acquisition_paths.map((p) => p.kind)).toEqual(
        full[i].acquisition_paths.map((p) => p.kind),
      );
      expect(compact[i].acquisition_paths.map((p) => p.availability)).toEqual(
        full[i].acquisition_paths.map((p) => p.availability),
      );
      expect(compact[i].verification_requirement).toBe(full[i].verification_requirement);
      expect(compact[i].actionable_path_kind).toBe(full[i].actionable_path_kind);
    }
  });

  it("§11 leads with the connection contract and still emits the connect.mjs escape hatch", () => {
    const routeSteps = [
      { component_id: "email_read" },
      { component_id: "calendar_write" },
    ];
    const artifacts = buildConnectArtifacts({
      route_steps: routeSteps,
      agent_name: "test-agent",
      registry_fingerprint: "test-fingerprint",
    });
    const s11 = s11Connect(artifacts, connectionContractForComponents(["email_read", "calendar_write"]));

    // The connection contract comes first…
    expect(s11).toContain("§11 Connect — connections");
    expect(s11).toContain(AUTHORIZATION_NOTE);
    expect(s11).toContain("token held by");
    expect(s11.indexOf("§11 Connect — connections")).toBeLessThan(
      s11.indexOf("direct credentials"),
    );

    // …and MAR-364 survives, demoted but intact.
    expect(s11).toContain("scripts/connect.mjs");
    expect(s11).toContain("advanced / self-hosted");
    expect(artifacts.connect_script).toContain("googleOauthLoopback");
    expect(artifacts.script_path).toBe("scripts/connect.mjs");
  });

  it("renderConnectionContract marks the actionable path and never marks a planned one", () => {
    const rendered = renderConnectionContract(
      connectionContractForComponents(["email_read"]),
    ).join("\n");
    const doThisLine = rendered.split("\n").find((l) => l.includes("do this today")) ?? "";
    expect(doThisLine).toBeTruthy();
    expect(doThisLine).not.toContain("_planned_");
  });

  it("is deterministic and holds no secrets", () => {
    const ids = ["email_read", "calendar_write", "slack_notification", "crm_note_write"];
    expect(JSON.stringify(connectionContractForComponents(ids))).toBe(
      JSON.stringify(connectionContractForComponents(ids)),
    );
    // Metadata only: no value that could be a credential.
    const serialized = JSON.stringify(connectionContractForComponents(ids));
    expect(serialized).not.toMatch(/sk-ant-|sk-or-v1-|GOCSPX-|pat-[a-z0-9]/i);
  });
});

describe("MAR-383 — the manifest carries connections for DASH", () => {
  it("agent.manifest.json exposes the contract without a second round-trip", async () => {
    const { buildAgentManifest } = await import("../../src/lib/observabilityContract.js");
    const connections = connectionContractForComponents(["email_read", "calendar_write"]);
    const manifest = buildAgentManifest({
      goal: GOLDEN,
      plan_source: "playbook",
      playbook_id: "email_calendar_assistant",
      route_id: "r1",
      build_target: "code",
      route_steps: [],
      automation_clearance: "L3",
      enforced_approval_gates: [],
      output_location: "",
      registry_fingerprint: "test",
      generated_at: "2026-01-01T00:00:00.000Z",
      connections,
    });
    expect(manifest.connections.map((c) => c.connection_id)).toEqual(["gmail", "google_calendar"]);
    // The manifest is client-readable — it must stay metadata-only.
    expect(JSON.stringify(manifest)).not.toMatch(/refresh_token"\s*:\s*"[^"]+/);
  });

  it("defaults to an empty connection list rather than undefined", () => {
    const contract = connectionContractForComponents(["audit_log"]);
    expect(contract).toEqual([]);
  });
});
