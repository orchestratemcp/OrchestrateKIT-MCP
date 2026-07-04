#!/usr/bin/env tsx
/**
 * node-probes.ts — MAR-125 / TEST-01 (thin CLI)
 *
 * Runs the node-probe set (benchmarks/node-probes.yaml) through the full
 * composeRoute and asserts must_have present / forbidden absent. Prints a
 * per-probe table and EXITS NON-ZERO on any failure → usable as a CI gate.
 * (Closes the MAR-119 acceptance criterion the markdown benchmark-template
 * didn't implement.)
 *
 *   pnpm probe
 *   pnpm tsx scripts/node-probes.ts --probes benchmarks/node-probes.yaml
 *
 * Probe logic lives in src/graph/nodeProbes.ts (shared with the vitest suite).
 * These are FIXTURES (Track A), not logged sessions. See
 * orchestratelab/TESTING_GUIDE.md.
 */

import { loadProbes, runProbe, DEFAULT_PROBES_PATH } from "../src/graph/nodeProbes.js";
import { loadRegistry } from "../src/registry/registryLoader.js";

const args = process.argv.slice(2);
const probesFlagIdx = args.indexOf("--probes");
const probesPath =
  probesFlagIdx !== -1 && args[probesFlagIdx + 1] ? args[probesFlagIdx + 1]! : DEFAULT_PROBES_PATH;

const probes = loadProbes(probesPath);
const registry = loadRegistry({ includeBeta: false });

let failures = 0;
let passed = 0;
let xfailed = 0;
const lines: string[] = [];

for (const probe of probes) {
  const r = runProbe(probe, registry);
  if (probe.xfail) {
    if (r.passed) {
      // xpass — the bug is fixed; force the marker (and finding) to be cleared.
      failures++;
      lines.push(
        `  ❗ ${probe.id} — XPASS: now passing, remove xfail` +
          (probe.finding ? ` and close ${probe.finding}` : ""),
      );
    } else {
      xfailed++;
      lines.push(`  ⚠️  ${probe.id} — xfail (known${probe.finding ? `, ${probe.finding}` : ""})`);
    }
    continue;
  }
  if (r.passed) {
    passed++;
    lines.push(`  ✅ ${probe.id}`);
  } else {
    failures++;
    lines.push(`  ❌ ${probe.id}`);
    if (r.missing.length) lines.push(`       missing must_have: ${r.missing.join(", ")}`);
    if (r.leaked.length) lines.push(`       forbidden leaked:  ${r.leaked.join(", ")}`);
    if (r.leaked_playbook.length) lines.push(`       forbidden playbook: ${r.leaked_playbook.join(", ")}`);
    if (r.missing_playbook.length) lines.push(`       required playbook not selected: ${r.missing_playbook.join(", ")}`);
    lines.push(`       route: ${r.routeIds.join(", ")}`);
  }
}

process.stdout.write(
  `\nNode probes (${probes.length}) — registry ${registry.components.length} components / ${registry.edges.length} edges\n\n` +
    lines.join("\n") +
    `\n\n${passed} passed, ${failures} failed, ${xfailed} xfail\n`,
);

if (failures > 0) {
  process.stderr.write(`\n${failures} probe(s) FAILED\n`);
  process.exit(1);
}
