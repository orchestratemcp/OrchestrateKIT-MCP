/**
 * MAR-364 — fast-connect contract tests.
 *
 * The credential manifest + connect.mjs generator are deterministic, so these
 * tests pin: derivation rules (which route components pull in which env vars),
 * dedupe behavior, script embedding, script syntax validity (node --check),
 * and the sync contract between the generator and the checked-in
 * examples/email-lead-agent/scripts/connect.mjs.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildConnectArtifacts,
  buildConnectScript,
  buildCredentialManifest,
  s11Connect,
} from "../../src/lib/connectContract.js";

const EMAIL_LEAD_ROUTE = [
  { component_id: "email_read", model_tier: "none" },
  { component_id: "schema_validation", model_tier: "none" },
  { component_id: "intent_classifier", model_tier: "small" },
  { component_id: "email_draft", model_tier: "standard" },
  { component_id: "human_approval_gate", model_tier: "none" },
  { component_id: "slack_notification", model_tier: "none" },
  { component_id: "crm_note_write", model_tier: "small" },
  { component_id: "optional_email_send", model_tier: "none" },
  { component_id: "audit_log", model_tier: "none" },
];

describe("buildCredentialManifest", () => {
  it("derives the full email-lead-agent credential set in catalog order", () => {
    const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
    expect(manifest.map((c) => c.env)).toEqual([
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REFRESH_TOKEN",
      "ANTHROPIC_API_KEY",
      "SLACK_WEBHOOK_URL",
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "DASH_INGEST_URL",
      "DASH_INGEST_TOKEN",
    ]);
  });

  it("dedupes the Anthropic key across all LLM-tier steps", () => {
    const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
    const anthropic = manifest.filter((c) => c.env === "ANTHROPIC_API_KEY");
    expect(anthropic).toHaveLength(1);
    expect(anthropic[0].required_by).toEqual(["intent_classifier", "email_draft", "crm_note_write"]);
  });

  it("merges gmail required_by across read and send components", () => {
    const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
    const refresh = manifest.find((c) => c.env === "GMAIL_REFRESH_TOKEN");
    expect(refresh?.required_by).toEqual(["email_read", "optional_email_send"]);
    expect(refresh?.connect).toBe("google_oauth");
    expect(refresh?.oauth?.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    // draft-only contract: never request gmail.send
    expect(refresh?.oauth?.scopes.join(" ")).not.toContain("gmail.send");
  });

  it("marks CRM and DASH credentials optional (local fallbacks exist)", () => {
    const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
    for (const env of ["HUBSPOT_PRIVATE_APP_TOKEN", "DASH_INGEST_URL", "DASH_INGEST_TOKEN"]) {
      expect(manifest.find((c) => c.env === env)?.required).toBe(false);
    }
  });

  it("emits only the DASH pair for a credential-free route", () => {
    const manifest = buildCredentialManifest([
      { component_id: "schema_validation", model_tier: "none" },
      { component_id: "audit_log", model_tier: "none" },
    ]);
    expect(manifest.map((c) => c.env)).toEqual(["DASH_INGEST_URL", "DASH_INGEST_TOKEN"]);
  });

  it("keeps every mint_url https and every probe declarative", () => {
    const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
    for (const c of manifest) {
      expect(c.mint_url).toMatch(/^https?:\/\//);
      expect(["http", "google_refresh", "none"]).toContain(c.probe.kind);
      if (c.probe.kind === "http") {
        expect(c.probe.ok_statuses.length).toBeGreaterThan(0);
        // probe must be a cheap single call carrying the value placeholder
        const spec = JSON.stringify(c.probe);
        expect(spec).toContain("{{VALUE}}");
      }
    }
  });
});

describe("buildConnectScript", () => {
  const manifest = buildCredentialManifest(EMAIL_LEAD_ROUTE);
  const script = buildConnectScript(manifest, {
    agent_name: "email-lead-crm-slack-agent",
    registry_fingerprint: "26b95a7a03de9ffd",
  });

  it("embeds the manifest, agent name, and fingerprint", () => {
    expect(script).toContain('"env": "ANTHROPIC_API_KEY"');
    expect(script).toContain("email-lead-crm-slack-agent");
    expect(script).toContain("26b95a7a03de9ffd");
    expect(script).not.toContain("__MANIFEST_JSON__");
    expect(script).not.toContain("__AGENT_NAME__");
    expect(script).not.toContain("__FINGERPRINT__");
  });

  it("is deterministic (no timestamps) and zero-dependency", () => {
    const again = buildConnectScript(manifest, {
      agent_name: "email-lead-crm-slack-agent",
      registry_fingerprint: "26b95a7a03de9ffd",
    });
    expect(again).toBe(script);
    // only node: imports — a generated repo must not need npm install to connect
    const imports = script.match(/^import .+ from '([^']+)';$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/from 'node:/);
  });

  it("passes node --check (valid ESM syntax)", () => {
    const tmp = path.join(os.tmpdir(), `connect-syntax-check-${process.pid}.mjs`);
    fs.writeFileSync(tmp, script, "utf8");
    try {
      const res = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe("buildConnectArtifacts + s11Connect", () => {
  const artifacts = buildConnectArtifacts({
    route_steps: EMAIL_LEAD_ROUTE,
    agent_name: "email-lead-crm-slack-agent",
    registry_fingerprint: "26b95a7a03de9ffd",
  });

  it("names the required credentials in the instructions", () => {
    expect(artifacts.script_path).toBe("scripts/connect.mjs");
    expect(artifacts.instructions).toContain("GMAIL_REFRESH_TOKEN");
    expect(artifacts.instructions).toContain("ANTHROPIC_API_KEY");
    expect(artifacts.instructions).toContain("SLACK_WEBHOOK_URL");
    expect(artifacts.instructions).toContain("--check");
  });

  it("renders §11 with one line per credential and the no-secrets-here note", () => {
    const s11 = s11Connect(artifacts);
    expect(s11).toContain("§11 Connect");
    for (const c of artifacts.credential_manifest) {
      expect(s11).toContain(`\`${c.env}\``);
      expect(s11).toContain(c.mint_url);
    }
    expect(s11).toContain("The MCP never sees these values");
  });
});

describe("checked-in example script stays in sync with the generator", () => {
  it("examples/email-lead-agent/scripts/connect.mjs === generated output", () => {
    const examplePath = path.resolve(
      __dirname,
      "../../examples/email-lead-agent/scripts/connect.mjs",
    );
    const manifestPath = path.resolve(
      __dirname,
      "../../examples/email-lead-agent/agent.manifest.json",
    );
    const agentManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      agent: { name: string };
      planned_route: { component_id: string; model_tier?: string }[];
      provenance: { registry_fingerprint: string };
    };
    const expected = buildConnectScript(
      buildCredentialManifest(agentManifest.planned_route),
      {
        agent_name: agentManifest.agent.name,
        registry_fingerprint: agentManifest.provenance.registry_fingerprint,
      },
    );
    const actual = fs.readFileSync(examplePath, "utf8").replace(/\r\n/g, "\n");
    expect(actual).toBe(expected);
  });
});
