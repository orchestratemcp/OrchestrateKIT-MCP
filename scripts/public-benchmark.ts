#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchmarkArtifactMatches,
  buildPublicBenchmark,
  renderPublicBenchmarkMarkdown,
  serializePublicBenchmark,
} from "../src/benchmark/publicBenchmark.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = buildPublicBenchmark(root);
const json = serializePublicBenchmark(report);
const markdown = `${renderPublicBenchmarkMarkdown(report)}\n`;
const outputDir = join(root, "benchmarks", "public");
const jsonPath = join(outputDir, "latest.json");
const markdownPath = join(outputDir, "README.md");
const check = process.argv.includes("--check");
const write = process.argv.includes("--write");

if (check) {
  const failures: string[] = [];
  if (
    !existsSync(jsonPath) ||
    !benchmarkArtifactMatches(readFileSync(jsonPath, "utf8"), json)
  ) {
    failures.push("benchmarks/public/latest.json is stale");
  }
  if (
    !existsSync(markdownPath) ||
    !benchmarkArtifactMatches(readFileSync(markdownPath, "utf8"), markdown)
  ) {
    failures.push("benchmarks/public/README.md is stale");
  }
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.stderr.write("Run `pnpm benchmark:write` and review the evidence diff.\n");
    process.exit(1);
  }
  process.stdout.write(
    `Public benchmark artifacts match registry ${report.provenance.registry_fingerprint} (${report.report_fingerprint}).\n`,
  );
} else if (write) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonPath, json);
  writeFileSync(markdownPath, markdown);
  process.stdout.write(
    `Wrote public benchmark: ${report.summary.prompts_passed}/${report.summary.prompt_count} prompts pass, report ${report.report_fingerprint}.\n`,
  );
} else {
  process.stdout.write(markdown);
  if (!report.summary.passed) process.exitCode = 1;
}
