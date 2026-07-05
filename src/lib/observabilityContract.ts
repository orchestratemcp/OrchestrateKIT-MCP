/**
 * DASH telemetry-contract v1 — shared constants + deterministic manifest builder
 * (MAR-296 / DASH-02).
 *
 * Single source for BOTH plan_workflow's advisory `observability` block and
 * export_build_brief's emitted `agent.manifest.json`, so the two can never
 * disagree about the event set or which components need gate events. Mirrors
 * orchestratedash `contracts/agent.manifest.schema.json` (DASH-01 / MAR-295),
 * which is committed here as a test fixture and validated in CI — the same
 * dual-update discipline as the matcher corpus.
 *
 * The MCP stays stateless: nothing here makes a network call or talks to DASH.
 * The manifest is data placed in the build brief, exactly like the registry
 * fixture — deterministic from the plan (route, safety contract, provenance
 * fingerprint) plus the user-stated output_location.
 */

/** Contract version — bumped in lockstep with orchestratedash's schemas. */
export const MANIFEST_VERSION = 1 as const;

/** The v1 run-event set every DASH-monitored agent emits (contract-frozen). */
export const DASH_RUN_EVENTS = [
  "run_started",
  "step_started",
  "step_completed",
  "gate_requested",
  "gate_resolved",
  "run_completed",
  "run_failed",
] as const;

/** Env-var names the built agent reads its ingest URL + bearer token from. */
export const DASH_ENDPOINT_ENV = "DASH_INGEST_URL";
export const DASH_TOKEN_ENV = "DASH_INGEST_TOKEN";

export const MANIFEST_GENERATED_BY = "orchestratekit-mcp export_build_brief";

export type ManifestRisk = "low" | "medium" | "high" | "critical";
export type ManifestTier = "none" | "small" | "standard" | "frontier";
export type ManifestClearance = "L0" | "L1" | "L2" | "L3" | "L4";
export type ManifestBuildTarget = "cowork" | "cursor" | "chatgpt_gpt" | "code";

/** A route step as seen by the manifest builder (plan_workflow's RouteStep subset). */
export type ManifestRouteStep = {
  step: number;
  component_id: string;
  risk_level?: string;
  model_tier?: string;
};

const IRREVERSIBLE_RISK = new Set<ManifestRisk>(["high", "critical"]);

function coerceRisk(r?: string): ManifestRisk {
  return r === "medium" || r === "high" || r === "critical" ? r : "low";
}
function coerceTier(t?: string): ManifestTier {
  return t === "small" || t === "standard" || t === "frontier" ? t : "none";
}

/**
 * Components whose step is irreversible (registry risk_level high|critical).
 * These are the ones DASH expects a resolved gate before, and the manifest lists
 * under `safety_contract.irreversible_components`. Deduped, route order preserved.
 */
export function deriveIrreversibleComponents(steps: ManifestRouteStep[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of steps) {
    if (IRREVERSIBLE_RISK.has(coerceRisk(s.risk_level)) && !seen.has(s.component_id)) {
      seen.add(s.component_id);
      out.push(s.component_id);
    }
  }
  return out;
}

// ─────────────────────── plan_workflow observability block ───────────────────

/**
 * Advisory observability guidance surfaced by plan_workflow (MAR-296). Tells the
 * reading agent which run events to wire and where DASH enforces gate compliance,
 * without the MCP ever calling DASH. The full manifest + wiring is emitted by
 * export_build_brief.
 */
export type ObservabilityGuidance = {
  recommended_events: string[];
  gate_events_required_for: string[];
  endpoint_env: string;
  token_env: string;
  note: string;
};

export function buildObservabilityGuidance(
  steps: ManifestRouteStep[],
): ObservabilityGuidance {
  const irreversible = deriveIrreversibleComponents(steps);
  return {
    recommended_events: [...DASH_RUN_EVENTS],
    gate_events_required_for: irreversible,
    endpoint_env: DASH_ENDPOINT_ENV,
    token_env: DASH_TOKEN_ENV,
    note:
      irreversible.length > 0
        ? `Emit a gate_requested → gate_resolved pair before each irreversible step ` +
          `(${irreversible.join(", ")}). DASH flags an irreversible step_started with no ` +
          `preceding resolved gate. Call export_build_brief to get the agent.manifest.json ` +
          `and the event-wiring section for this plan.`
        : `No irreversible steps in this route — the run/step lifecycle events are enough. ` +
          `Call export_build_brief to get the agent.manifest.json and the event-wiring ` +
          `section for this plan.`,
  };
}

// ───────────────────────────── agent.manifest.json ───────────────────────────

export type AgentManifest = {
  manifest_version: typeof MANIFEST_VERSION;
  agent: {
    name: string;
    goal: string;
    plan_source: "playbook" | "composed";
    playbook_id: string;
    route_id: string;
    build_target: ManifestBuildTarget;
  };
  planned_route: {
    step: number;
    component_id: string;
    risk_level: ManifestRisk;
    model_tier: ManifestTier;
  }[];
  safety_contract: {
    automation_clearance: ManifestClearance;
    enforced_approval_gates: string[];
    irreversible_components: string[];
  };
  monitoring: {
    events: string[];
    endpoint_env: string;
    token_env: string;
    output_location: string;
  };
  provenance: {
    generated_by: string;
    registry_fingerprint: string;
    generated_at: string;
  };
};

/** Slug for `agent.name` — hyphenated, ≤60 chars, never empty. */
export function agentSlug(playbookId: string, goal: string): string {
  const source = playbookId || goal;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "agent";
}

/**
 * Build the `agent.manifest.json` for a plan (MAR-296). Deterministic: every
 * field comes from the plan (route, safety contract, provenance fingerprint) or
 * the user-stated output_location — no network, no LLM. `generated_at` is the
 * only non-reproducible field; it is injectable so tests/snapshots stay stable.
 */
export function buildAgentManifest(input: {
  goal: string;
  plan_source: "playbook" | "composed";
  playbook_id: string;
  route_id: string;
  build_target: ManifestBuildTarget;
  route_steps: ManifestRouteStep[];
  automation_clearance: ManifestClearance;
  enforced_approval_gates: string[];
  output_location: string;
  registry_fingerprint: string;
  agent_name?: string;
  generated_at?: string;
}): AgentManifest {
  return {
    manifest_version: MANIFEST_VERSION,
    agent: {
      name: input.agent_name?.trim() || agentSlug(input.playbook_id, input.goal),
      goal: input.goal,
      plan_source: input.plan_source,
      playbook_id: input.playbook_id,
      route_id: input.route_id,
      build_target: input.build_target,
    },
    planned_route: input.route_steps.map((s) => ({
      step: s.step,
      component_id: s.component_id,
      risk_level: coerceRisk(s.risk_level),
      model_tier: coerceTier(s.model_tier),
    })),
    safety_contract: {
      automation_clearance: input.automation_clearance,
      enforced_approval_gates: input.enforced_approval_gates,
      irreversible_components: deriveIrreversibleComponents(input.route_steps),
    },
    monitoring: {
      events: [...DASH_RUN_EVENTS],
      endpoint_env: DASH_ENDPOINT_ENV,
      token_env: DASH_TOKEN_ENV,
      output_location: input.output_location,
    },
    provenance: {
      generated_by: MANIFEST_GENERATED_BY,
      registry_fingerprint: input.registry_fingerprint,
      generated_at: input.generated_at ?? new Date().toISOString(),
    },
  };
}
