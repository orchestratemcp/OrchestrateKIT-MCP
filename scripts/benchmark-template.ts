#!/usr/bin/env tsx
/**
 * benchmark-template.ts
 *
 * Prints a formatted benchmark session guide to stdout.
 * For graph-composed prompts it also runs compose_workflow_route locally
 * and embeds the candidate route in the output.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-template.ts
 *   pnpm tsx scripts/benchmark-template.ts --prompt p6_email_lead_crm
 *   pnpm tsx scripts/benchmark-template.ts --all
 *
 * v2 (MAR-96) — use prompts-v2.yaml with must_have / forbidden fixture fields:
 *   pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --all
 *   pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --prompt p6_email_lead_crm
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { loadRegistry } from "../src/registry/registryLoader.js";
import { composeRoute } from "../src/graph/routeComposer.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

// ── Load prompts ──────────────────────────────────────────────────────────────

type Prompt = {
  id: string;
  title: string;
  category: string;
  has_exact_playbook: boolean;
  playbook_id?: string;
  compose_workflow_route_goal?: string;
  prompt: string;
  // v1 fields
  expected_components?: string[];
  acceptance_notes?: string;
  // v2 fields (prompts-v2.yaml)
  must_have?: string[];
  nice_to_have?: string[];
  forbidden?: string[];
  missing_but_expected?: string[];
};

type PromptsFile = { prompts: Prompt[] };

// ── Resolve prompts file (--prompts <path> overrides default) ─────────────────
const promptsFlagIdx = process.argv.indexOf("--prompts");
const promptsPath =
  promptsFlagIdx !== -1 && process.argv[promptsFlagIdx + 1]
    ? join(root, process.argv[promptsFlagIdx + 1]!)
    : join(root, "benchmarks", "prompts.yaml");

const { prompts } = yaml.load(readFileSync(promptsPath, "utf8")) as PromptsFile;
const isV2 = promptsPath.includes("v2");

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
// Skip --prompts and its value when looking for the prompt filter id
const filterId = args.includes("--all")
  ? null
  : args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--prompts").find(Boolean) ?? null;

const selected = filterId
  ? prompts.filter((p) => p.id === filterId)
  : prompts;

if (selected.length === 0) {
  console.error(`No prompt found for id: ${filterId}`);
  console.error(`Available: ${prompts.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

// ── Load registry once ────────────────────────────────────────────────────────

const registry = loadRegistry({ includeBeta: false });

// ── Helpers ───────────────────────────────────────────────────────────────────

const hr = "─".repeat(72);
const sep = "═".repeat(72);

function rubricTable(): string {
  const v1Criteria = [
    "suitable_architecture",
    "avoids_complexity",
    "separates_llm_deterministic",
    "persistent_state",
    "approval_gates",
    "permission_risks",
    "eval_plan",
    "retries_idempotency",
    "observability",
    "concrete_steps",
    "reuses_graph_components",
    "untested_edges",
    "candidate_not_validated",
    "stack_explanation",
  ];
  const criteria = isV2 ? [...v1Criteria, "brevity"] : v1Criteria;

  const header =
    `| ${"Criterion".padEnd(32)} | A (0-2) | B (0-2) | C (0-2) | Notes |\n` +
    `| ${"-".repeat(32)} | ------- | ------- | ------- | ----- |`;

  const rows = criteria.map(
    (c) => `| ${c.padEnd(32)} |    —    |    —    |    —    |       |`,
  );

  return [header, ...rows].join("\n");
}

function printPrompt(p: Prompt, index: number): void {
  console.log(`\n${sep}`);
  console.log(`PROMPT ${index + 1}: ${p.id}`);
  console.log(`Title:    ${p.title}`);
  console.log(`Category: ${p.category}`);
  console.log(`Playbook: ${p.has_exact_playbook ? p.playbook_id ?? "yes" : "none — graph-composed"}`);
  console.log(sep);

  console.log("\n── PROMPT TEXT (paste verbatim) " + hr.slice(32));
  console.log(p.prompt.trim());

  if (isV2 && p.must_have) {
    console.log("\n── MUST-HAVE COMPONENTS " + hr.slice(23));
    console.log(p.must_have.join(", "));
    if (p.nice_to_have && p.nice_to_have.length > 0) {
      console.log("Nice to have:  " + p.nice_to_have.join(", "));
    }
    if (p.forbidden && p.forbidden.length > 0) {
      console.log("FORBIDDEN:     " + p.forbidden.join(", ") + "  ← false-positive check");
    }
    if (p.missing_but_expected && p.missing_but_expected.length > 0) {
      console.log("Missing (registry gap): " + p.missing_but_expected.join(", "));
    }
  } else {
    console.log("\n── EXPECTED COMPONENTS " + hr.slice(22));
    console.log((p.expected_components ?? []).join(", "));
  }

  if (p.acceptance_notes) {
    console.log("\n── ACCEPTANCE NOTES " + hr.slice(20));
    console.log(p.acceptance_notes.trim());
  }

  // Condition B MCP setup
  console.log("\n── CONDITION B — MCP SETUP CALLS " + hr.slice(32));
  if (p.has_exact_playbook && p.playbook_id) {
    console.log(`list_known_routes({})`);
    console.log(`get_route({ id: "${p.playbook_id}_route_v1", include_component_details: true })`);
  } else {
    console.log(`list_known_routes({})  → confirm no exact match`);
  }

  // Condition C — compose_workflow_route
  console.log("\n── CONDITION C — compose_workflow_route OUTPUT " + hr.slice(46));
  const goal = p.compose_workflow_route_goal ?? p.prompt.trim();
  const composed = composeRoute(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" },
    registry,
  );

  console.log(`Status:     ${composed.status}`);
  console.log(`Score:      ${composed.route_score}/100`);
  console.log(`Confidence: ${Math.round(composed.confidence * 100)}%`);
  console.log(`\nRecommended route:`);
  for (const step of composed.recommended_route) {
    console.log(
      `  ${step.step}. ${step.component_id.padEnd(28)} [risk: ${step.risk_level}]  ${step.purpose.slice(0, 50)}`,
    );
  }

  if (composed.required_approval_gates.length > 0) {
    console.log(`\nApproval gates: ${composed.required_approval_gates.join(", ")}`);
  }
  if (composed.untested_edges.length > 0) {
    console.log(`Untested edges: ${composed.untested_edges.slice(0, 5).join(", ")}${composed.untested_edges.length > 5 ? " ..." : ""}`);
  }
  if (composed.known_playbooks_reused.length > 0) {
    console.log(`Overlapping playbooks: ${composed.known_playbooks_reused.join(", ")}`);
  }
  if (composed.warnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of composed.warnings) {
      console.log(`  ⚠  ${w.slice(0, 90)}`);
    }
  }

  // Blank scoring table
  console.log("\n── SCORING TABLE " + hr.slice(16));
  console.log(rubricTable());
  const totalRow = isV2
    ? `\n| ${"TOTAL".padEnd(32)} |  — / 24 |  — / 28 |  — / 30 |       |`
    : `\n| ${"TOTAL".padEnd(32)} |  — / 22 |  — / 24 |  — / 28 |       |`;
  console.log(totalRow);

  console.log("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

const protocolVersion = isV2 ? "v2" : "v1";
const maxScores = isV2 ? "A=24 / B=28 / C=30" : "A=22 / B=24 / C=28";

console.log(`\n${sep}`);
console.log("ORCHESTRATEKIT MCP — BENCHMARK SESSION TEMPLATE");
console.log(`Protocol:  ${protocolVersion}   Max scores: ${maxScores}`);
console.log(`Registry:  ${registry.components.length} components, ${registry.edges.length} edges`);
console.log(`Prompts:   ${selected.length} of ${prompts.length} selected  (${promptsPath})`);
console.log(`${sep}`);
console.log(isV2
  ? "\nProtocol: benchmarks/PROTOCOL.md  |  Rubric: benchmarks/rubric-v2.yaml"
  : "\nInstructions: see docs/BENCHMARKING.md");
console.log("Record results in: benchmarks/results-YYYY-MM-DD.md\n");

selected.forEach((p, i) => printPrompt(p, i));

console.log(`${sep}`);
console.log("RETRO QUESTIONS (answer after all prompts are scored)");
console.log(hr);
console.log("1. Did compose_workflow_route improve the result?");
console.log("2. Did the workflow graph reduce generic advice?");
console.log("3. Were untested edges useful or noisy?");
console.log("4. Add more components/edges, simplify graph, or return to playbook-first?");
console.log("5. What must change before starting OrchestrateLab?");
console.log(`${sep}\n`);
