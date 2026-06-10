#!/usr/bin/env node
/**
 * CLI entry for `pnpm registry:lint` (MAR-94).
 */
import { lintRegistry } from "../src/registry/registryLint.js";

const result = lintRegistry();

console.log("Registry lint — brain completion % (published/validated components):");
console.log(
  `  L0 Safety:      ${result.brain_completion_pct.L0}%`,
);
console.log(
  `  L1 Identity:    ${result.brain_completion_pct.L1}%`,
);
console.log(
  `  L2 Connections: ${result.brain_completion_pct.L2}%`,
);
console.log(
  `  L3 Operations:  ${result.brain_completion_pct.L3}%`,
);
console.log(
  `  L4 Lifecycle:   ${result.brain_completion_pct.L4}%`,
);
console.log(`  (${result.component_count} components checked)`);

if (!result.ok) {
  console.error(`\nRegistry lint FAILED — ${result.errors.length} error(s):\n`);
  for (const e of result.errors) {
    console.error(`  [${e.entity}] ${e.field}: ${e.message}`);
  }
  process.exit(1);
}

console.log("\nRegistry lint passed.");
process.exit(0);
