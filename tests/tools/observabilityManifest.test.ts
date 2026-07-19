/**
 * MAR-296 / DASH-02 — agent.manifest.json emission + observability wiring.
 *
 * The manifest export_build_brief emits must validate against the FROZEN DASH-01
 * schema (tests/fixtures/dash/agent.manifest.schema.json, a verbatim copy of
 * orchestratedash's contract). This is the cross-repo tripwire: the MCP emitter
 * and the DASH receiver share no code, so this fixture is the only thing that
 * catches drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { exportBuildBrief } from "../../src/tools/exportBuildBrief.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

// ajv ships dual CJS/ESM; its default export interop diverges between esbuild
// (vitest) and tsc under NodeNext. Load the CJS entry via createRequire so both
// toolchains see the same constructable class — the standard NodeNext escape.
const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-var-requires */
const Ajv2020 = require("ajv/dist/2020.js") as new (opts?: object) => {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown };
};
const addFormats = require("ajv-formats") as (ajv: object) => void;
/* eslint-enable @typescript-eslint/no-var-requires */

const registry = loadRegistry();

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/dash/agent.manifest.schema.json",
);
const manifestSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateManifest = ajv.compile(manifestSchema);

type BuildTarget = "cowork" | "cursor" | "chatgpt_gpt" | "code";

function planAndBrief(
  goal: string,
  opts: { build_target?: BuildTarget; output_location?: string } = {},
) {
  const plan = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
  return exportBuildBrief({
    goal: plan.goal,
    plan_source: plan.plan_source,
    route_status: plan.route_status,
    recommended_route: plan.recommended_route,
    safety_review: plan.safety_review,
    automation_clearance: plan.automation_clearance,
    enforced_approval_gates: plan.enforced_approval_gates,
    untested_edges: plan.untested_edges,
    avoid_when_violations: plan.avoid_when_violations,
    evals_to_add: plan.evals_to_add,
    design_notes: plan.design_notes,
    worker_pipeline: plan.worker_pipeline,
    loop_guidance: plan.loop_guidance,
    approval_gate_advisory: plan.approval_gate_advisory,
    handoff_targets: ["prompt"],
    playbook_id: plan.playbook?.id ?? "",
    route_id: plan.playbook?.route_id ?? "",
    build_target: opts.build_target ?? "code",
    output_location: opts.output_location ?? "",
    generated_at: "2026-07-05T00:00:00Z", // deterministic for assertions
    llm_provider: "anthropic",
  });
}

const LEAD_GOAL =
  "read emails, detect sales leads and write a note to the CRM for each lead";

describe("MAR-296 — agent_manifest validates against the frozen DASH-01 schema", () => {
  it("playbook plan → manifest conforms", () => {
    const b = planAndBrief(LEAD_GOAL, { output_location: "HubSpot notes + Gmail drafts" });
    const valid = validateManifest(b.agent_manifest);
    expect(validateManifest.errors ?? null, JSON.stringify(validateManifest.errors)).toBeNull();
    expect(valid).toBe(true);
  });

  it("composed plan → manifest conforms with empty playbook_id/route_id", () => {
    const b = planAndBrief(
      "Every Monday, pull last week's signups from our analytics API and post a summary to Slack.",
    );
    expect(b.agent_manifest.agent.plan_source).toBe("composed");
    expect(b.agent_manifest.agent.playbook_id).toBe("");
    expect(b.agent_manifest.agent.route_id).toBe("");
    expect(validateManifest(b.agent_manifest)).toBe(true);
  });

  it("conforms for ALL FOUR build_targets, and each renders the §9 wiring section", () => {
    const targets: BuildTarget[] = ["cowork", "cursor", "chatgpt_gpt", "code"];
    for (const t of targets) {
      const b = planAndBrief(LEAD_GOAL, { build_target: t });
      expect(validateManifest(b.agent_manifest), `manifest invalid for ${t}`).toBe(true);
      expect(b.agent_manifest.agent.build_target).toBe(t);
      expect(b.sections.s9_observability).toContain("§9 Observability wiring");
      expect(b.sections.s9_observability).toContain(`build_target: \`${t}\``);
      expect(b.brief_markdown).toContain("§9 Observability wiring");
      // MAR-396: every target still explains how the built agent is observed, but
      // the ASSISTANT-surface targets cannot emit DASH run events — no code runs
      // that could. They carry the honest equivalent (the surface's own history)
      // plus the explicit statement that an external monitor cannot see this
      // agent. §9 itself and the agent_manifest are unchanged for all four.
      if (t === "cowork" || t === "chatgpt_gpt") {
        expect(b.handoffs.prompt, t).toContain("## How you'll know it ran");
        expect(b.handoffs.prompt, t).toContain("cannot see it");
      } else {
        expect(b.handoffs.prompt, t).toContain("§9 Observability wiring");
      }
    }
  });
});

describe("MAR-296 — manifest content is deterministic + registry-grounded", () => {
  it("derives irreversible_components from high/critical-risk route steps (L3 CRM)", () => {
    const b = planAndBrief(LEAD_GOAL);
    // crm_note_write is a high-risk write in this route → gate-compliance target.
    expect(b.agent_manifest.safety_contract.irreversible_components).toContain("crm_note_write");
    expect(b.agent_manifest.safety_contract.automation_clearance).toMatch(/^L[0-4]$/);
    // §9 names the irreversible step for gate compliance
    expect(b.sections.s9_observability).toContain("Gate compliance");
    expect(b.sections.s9_observability).toContain("crm_note_write");
  });

  it("manifest planned_route mirrors the plan's route order + coerces enums", () => {
    const b = planAndBrief(LEAD_GOAL);
    const routeIds = b.agent_manifest.planned_route.map((s) => s.component_id);
    expect(routeIds.length).toBeGreaterThan(0);
    for (const s of b.agent_manifest.planned_route) {
      expect(["low", "medium", "high", "critical"]).toContain(s.risk_level);
      expect(["none", "small", "standard", "frontier"]).toContain(s.model_tier);
    }
  });

  it("carries the full v1 event set + env-var wiring", () => {
    const b = planAndBrief(LEAD_GOAL);
    expect(b.agent_manifest.monitoring.events).toEqual([
      "run_started",
      "step_started",
      "step_completed",
      "gate_requested",
      "gate_resolved",
      "run_completed",
      "run_failed",
    ]);
    expect(b.agent_manifest.monitoring.endpoint_env).toBe("DASH_INGEST_URL");
    expect(b.agent_manifest.monitoring.token_env).toBe("DASH_INGEST_TOKEN");
  });

  it("registry_fingerprint defaults to the bundle content fingerprint (16 hex)", () => {
    const b = planAndBrief(LEAD_GOAL);
    expect(b.agent_manifest.provenance.registry_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(b.agent_manifest.provenance.generated_by).toContain("export_build_brief");
  });

  it("agent.name slugs the playbook id (underscores → hyphens)", () => {
    const b = planAndBrief(LEAD_GOAL);
    // lead goal routes to email_lead_to_crm → slug email-lead-to-crm
    expect(b.agent_manifest.agent.name).toBe("email-lead-to-crm");
  });

  it("echoes output_location into monitoring", () => {
    const b = planAndBrief(LEAD_GOAL, { output_location: "HubSpot notes + Gmail drafts" });
    expect(b.agent_manifest.monitoring.output_location).toBe("HubSpot notes + Gmail drafts");
  });
});

describe("MAR-296 — plan_workflow observability block", () => {
  it("is present, advisory-tagged, and lists irreversible gate targets", () => {
    const plan = planWorkflow(
      { goal: LEAD_GOAL, must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(plan.observability.recommended_events).toHaveLength(7);
    expect(plan.observability.endpoint_env).toBe("DASH_INGEST_URL");
    expect(plan.observability.gate_events_required_for).toContain("crm_note_write");
    expect(plan.provenance.field_tags.observability).toBe("advisory");
  });

  it("a read-only route has no gate targets", () => {
    const plan = planWorkflow(
      { goal: "scan a GitHub pull request and post a read-only review comment, never edit code", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(plan.observability.gate_events_required_for).toHaveLength(0);
    expect(plan.observability.note).toContain("No irreversible steps");
  });
});
