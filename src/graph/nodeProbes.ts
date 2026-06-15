import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { composeRoute } from "./routeComposer.js";
import { planWorkflow } from "../tools/planWorkflow.js";
import { loadRegistry } from "../registry/registryLoader.js";

/**
 * Node-probe model (MAR-125 / TEST-01).
 *
 * A probe is a single-capability goal with components that must / must not appear
 * in the composed route (matcher + safety augmenter + ordering). Probes are
 * FIXTURES (Track A), not logged sessions (Track B). Shared by `pnpm probe`
 * (scripts/node-probes.ts) and tests/graph/nodeProbes.test.ts.
 */

export interface NodeProbe {
  id: string;
  goal: string;
  must_have: string[];
  forbidden: string[];
  /**
   * Which tool to route the goal through (default "compose"). "plan" runs the
   * full plan_workflow so a probe can assert on its playbook-routing decision —
   * needed for playbook-override bugs (MAR-130) that compose alone never makes.
   */
  via?: "compose" | "plan";
  /**
   * Playbook ids that MUST NOT be the plan_workflow match for this goal. Only
   * meaningful with `via: plan`. Guards against a generic playbook over-matching
   * an unrelated domain (e.g. email_calendar_assistant on a CRM goal, MAR-130).
   */
  forbidden_playbook?: string[];
  /** Known-failing probe documenting an open bug; does not fail the gate. */
  xfail?: boolean;
  /** Linear id tracking the xfail. */
  finding?: string;
}

interface ProbesFile {
  probes: NodeProbe[];
}

export interface ProbeResult {
  id: string;
  passed: boolean;
  missing: string[];
  leaked: string[];
  /** Forbidden playbook(s) the plan_workflow match leaked (via: plan only). */
  leaked_playbook: string[];
  routeIds: string[];
}

/** Repo root, resolved from this module's location (src/graph → ../..). */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_PROBES_PATH = "benchmarks/node-probes.yaml";

/** Load and validate the probe set from a repo-root-relative (or absolute) path. */
export function loadProbes(relOrAbsPath: string = DEFAULT_PROBES_PATH): NodeProbe[] {
  const path = isAbsolute(relOrAbsPath) ? relOrAbsPath : join(repoRoot, relOrAbsPath);
  const parsed = yaml.load(readFileSync(path, "utf8")) as ProbesFile;
  if (!parsed || !Array.isArray(parsed.probes) || parsed.probes.length === 0) {
    throw new Error(`No probes found in ${relOrAbsPath}`);
  }
  return parsed.probes;
}

/** Run one probe through compose_workflow_route (default) or plan_workflow and
 * report missing / leaked components and any leaked forbidden playbook. */
export function runProbe(
  probe: NodeProbe,
  registry: ReturnType<typeof loadRegistry>,
): ProbeResult {
  const input = {
    goal: probe.goal,
    must_have_capabilities: [],
    must_avoid: [],
    output_depth: "standard" as const,
  };

  let routeComponentIds: string[];
  let matchedPlaybookId: string | null = null;

  if (probe.via === "plan") {
    const plan = planWorkflow(input, registry);
    routeComponentIds = plan.recommended_route.map((s) => s.component_id);
    matchedPlaybookId = plan.playbook?.id ?? null;
  } else {
    const composed = composeRoute(input, registry);
    routeComponentIds = composed.recommended_route.map((s) => s.component_id);
  }

  const idSet = new Set(routeComponentIds);
  const missing = (probe.must_have ?? []).filter((id) => !idSet.has(id));
  const leaked = (probe.forbidden ?? []).filter((id) => idSet.has(id));
  const leaked_playbook = matchedPlaybookId
    ? (probe.forbidden_playbook ?? []).filter((id) => id === matchedPlaybookId)
    : [];

  return {
    id: probe.id,
    passed: missing.length === 0 && leaked.length === 0 && leaked_playbook.length === 0,
    missing,
    leaked,
    leaked_playbook,
    routeIds: [...idSet],
  };
}
