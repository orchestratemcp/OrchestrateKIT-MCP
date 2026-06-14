import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { composeRoute } from "./routeComposer.js";
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

/** Run one probe through composeRoute and report missing / leaked components. */
export function runProbe(
  probe: NodeProbe,
  registry: ReturnType<typeof loadRegistry>,
): ProbeResult {
  const composed = composeRoute(
    { goal: probe.goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" },
    registry,
  );
  const idSet = new Set(composed.recommended_route.map((s) => s.component_id));
  const missing = (probe.must_have ?? []).filter((id) => !idSet.has(id));
  const leaked = (probe.forbidden ?? []).filter((id) => idSet.has(id));
  return {
    id: probe.id,
    passed: missing.length === 0 && leaked.length === 0,
    missing,
    leaked,
    routeIds: [...idSet],
  };
}
