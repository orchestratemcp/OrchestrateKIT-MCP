/**
 * MAR-79 runner — generate the Obsidian vault from the live registry.
 *
 * Wires the existing exportToObsidian() service to the file writer and a
 * destination directory. The vault is a build artifact (gitignored) — regenerate
 * it any time the registry changes.
 *
 * Usage:
 *   pnpm export:obsidian                        # → ./obsidian-vault
 *   pnpm export:obsidian --out ../my-vault      # custom destination
 *   pnpm export:obsidian --include-candidates   # include candidate playbooks/routes
 */
import { resolve } from "node:path";
import { loadRegistry } from "../src/registry/registryLoader.js";
import { exportToObsidian } from "../src/services/obsidianExportService.js";
import { writeExportToDisk } from "../src/services/obsidianExportWriter.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const outDir = resolve(process.cwd(), argValue("--out") ?? "obsidian-vault");
const includeCandidates = process.argv.includes("--include-candidates");

const registry = loadRegistry();
const result = exportToObsidian(registry, includeCandidates);
const written = writeExportToDisk(outDir, result.files);

const s = result.stats;
console.log("\nObsidian vault exported:");
console.log(`  destination:  ${written.export_dir}`);
console.log(`  files:        ${written.files_written}`);
console.log(
  `  entities:     ${s.components_exported} components · ${s.edges_exported} edges · ${s.routes_exported} routes · ${s.playbooks_exported} playbooks · ${s.stacks_exported} stacks`,
);
if (includeCandidates) console.log("  (candidates included)");
if (result.warnings.length > 0) {
  console.log(`  warnings:     ${result.warnings.length}`);
  for (const w of result.warnings.slice(0, 10)) console.log(`    - ${w}`);
}
if (written.errors.length > 0) {
  console.error(`  errors:       ${written.errors.length}`);
  for (const e of written.errors) console.error(`    ! ${e}`);
  process.exit(1);
}
console.log("\nOpen it in Obsidian: Open folder as vault → select the destination above.\n");
