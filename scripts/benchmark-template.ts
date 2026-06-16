#!/usr/bin/env tsx
/**
 * benchmark-template.ts — MAR-119
 *
 * Outputs a pre-filled markdown results file to stdout.
 * Pipe to a file to start a scoring session:
 *
 *   pnpm tsx scripts/benchmark-template.ts > benchmarks/results-YYYY-MM-DD.md
 *   pnpm tsx scripts/benchmark-template.ts --prompt p6_email_lead_crm > /tmp/p6.md
 *
 * Flags:
 *   --all                  Run all prompts (default when no --prompt given)
 *   --prompt <id>          Run a single prompt by id
 *   --prompts <path>       Prompts file (default: benchmarks/prompts-v2.yaml)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { loadRegistry } from "../src/registry/registryLoader.js";
import { composeRoute } from "../src/graph/routeComposer.js";
import { getRegistryBuild } from "../src/registry/buildManifest.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

// ── Types ──────────────────────────────────────────────────────────────────────

type Prompt = {
  id: string;
  title: string;
  category: string;
  has_exact_playbook: boolean;
  playbook_id?: string;
  compose_workflow_route_goal?: string;
  prompt: string;
  must_have?: string[];
  nice_to_have?: string[];
  forbidden?: string[];
  missing_but_expected?: string[];
  acceptance_notes?: string;
};

type PromptsFile = { prompts: Prompt[] };

// ── CLI args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const promptsFlagIdx = args.indexOf("--prompts");
const promptsRelPath =
  promptsFlagIdx !== -1 && args[promptsFlagIdx + 1]
    ? args[promptsFlagIdx + 1]!
    : "benchmarks/prompts-v2.yaml";

const { prompts } = yaml.load(
  readFileSync(join(root, promptsRelPath), "utf8"),
) as PromptsFile;

const promptFlagIdx = args.indexOf("--prompt");
const filterId: string | null =
  promptFlagIdx !== -1 && args[promptFlagIdx + 1]
    ? args[promptFlagIdx + 1]!
    : null;

const selected = filterId ? prompts.filter((p) => p.id === filterId) : prompts;

if (selected.length === 0) {
  process.stderr.write(
    `No prompt found for id: ${filterId}\nAvailable: ${prompts.map((p) => p.id).join(", ")}\n`,
  );
  process.exit(1);
}

// ── Registry ───────────────────────────────────────────────────────────────────

const registry = loadRegistry({ includeBeta: false });
const build = getRegistryBuild();
const today = new Date().toISOString().slice(0, 10);

// ── Rubric v2 criteria (in scoring order) ─────────────────────────────────────

const CRITERIA = [
  { id: "suitable_architecture",       na_for: [] as string[] },
  { id: "avoids_complexity",           na_for: [] },
  { id: "separates_llm_deterministic", na_for: [] },
  { id: "concrete_steps",              na_for: [] },
  { id: "eval_plan",                   na_for: [] },
  { id: "approval_gates",              na_for: [] },
  { id: "permission_risks",            na_for: [] },
  { id: "retries_idempotency",         na_for: [] },
  { id: "persistent_state",            na_for: [] },
  { id: "observability",               na_for: [] },
  { id: "reuses_graph_components",     na_for: ["A"] },
  { id: "stack_explanation",           na_for: [] },
  { id: "untested_edges",              na_for: ["A", "B"] },
  { id: "candidate_not_validated",     na_for: ["A", "B"] },
  { id: "brevity",                     na_for: [] },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoringTable(): string[] {
  return [
    `| ${"Criterion".padEnd(32)} | B (0-2) | C (0-2) | Notes |`,
    `| ${"-".repeat(32)} | ------- | ------- | ----- |`,
    ...CRITERIA.map((c) => {
      const b = c.na_for.includes("B") ? "  N/A  " : "   —   ";
      const cCol = "   —   ";
      return `| ${c.id.padEnd(32)} | ${b} | ${cCol} |       |`;
    }),
    `| ${"**TOTAL**".padEnd(32)} | **— / 28** | **— / 30** |       |`,
  ];
}

function fixtureRows(p: Prompt, routeIds: Set<string>): string[] {
  const rows = [
    "| Component | Type | In compose route? |",
    "| --- | --- | --- |",
  ];
  for (const c of p.must_have ?? []) {
    rows.push(`| \`${c}\` | must_have | ${routeIds.has(c) ? "✅" : "❌ **MISSING**"} |`);
  }
  for (const c of p.nice_to_have ?? []) {
    rows.push(`| \`${c}\` | nice_to_have | ${routeIds.has(c) ? "✅" : "—"} |`);
  }
  for (const c of p.forbidden ?? []) {
    rows.push(
      `| \`${c}\` | forbidden | ${routeIds.has(c) ? "⚠️ **FALSE POSITIVE**" : "✅ absent"} |`,
    );
  }
  return rows;
}

function renderPrompt(p: Prompt): string[] {
  const goal = (p.compose_workflow_route_goal ?? p.prompt).trim();
  const composed = composeRoute(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" },
    registry,
  );

  const routeIds = new Set(composed.recommended_route.map((s) => s.component_id));

  const bCalls = p.has_exact_playbook && p.playbook_id
    ? [
        "```",
        "list_known_routes({})",
        `get_route({ id: "${p.playbook_id}_route_v1", include_component_details: true })`,
        "```",
      ]
    : [
        "```",
        "list_known_routes({})  # confirm no exact playbook match",
        "```",
      ];

  const routeRows = [
    "| Step | Component | Risk | Purpose |",
    "| --- | --- | --- | --- |",
    ...composed.recommended_route.map(
      (s) => `| ${s.step} | \`${s.component_id}\` | ${s.risk_level} | ${s.purpose.slice(0, 60)} |`,
    ),
  ];

  const untestedNote =
    composed.untested_edges.length > 0
      ? `**Untested edges (${composed.untested_edges.length}):** ${composed.untested_edges.slice(0, 6).map((e) => `${e.id} (${e.severity})`).join(", ")}${composed.untested_edges.length > 6 ? " …" : ""}`
      : "**Untested edges:** none flagged";

  const playbookNote =
    composed.playbook_recommendation != null
      ? `**Playbook match:** \`${composed.playbook_recommendation.playbook_id}\` (recall ${Math.round(composed.playbook_recommendation.overlap.recall * 100)}%, precision ${Math.round(composed.playbook_recommendation.overlap.precision * 100)}%)`
      : "";

  const lines: string[] = [
    `## ${p.id} — ${p.title}`,
    "",
    `**Category:** ${p.category} | **Playbook:** ${p.has_exact_playbook ? `\`${p.playbook_id}\`` : "none — graph-composed"}`,
    `**Must-have:** ${(p.must_have ?? []).map((c) => `\`${c}\``).join(", ")}`,
    `**Forbidden:** ${(p.forbidden ?? []).map((c) => `\`${c}\``).join(", ")}`,
    "",
    "### Condition B — MCP setup calls",
    "",
    ...bCalls,
    "",
    "### Condition C — compose\\_workflow\\_route",
    "",
    `**Goal:** ${goal.slice(0, 140)}${goal.length > 140 ? " …" : ""}`,
    "",
    `**Status:** \`${composed.status}\` | **Route status:** \`${composed.route_status}\` | **Score:** ${composed.route_score}/100 | **Confidence:** ${Math.round(composed.confidence * 100)}% (${composed.confidence_label})`,
    "",
    ...routeRows,
    "",
    `**Approval gates:** ${composed.required_approval_gates.length > 0 ? composed.required_approval_gates.map((g) => `\`${g}\``).join(", ") : "none"}`,
    untestedNote,
  ];

  if (playbookNote) lines.push(playbookNote);

  if (composed.warnings.length > 0) {
    lines.push("", "**Warnings:**");
    for (const w of composed.warnings) lines.push(`- ${w}`);
  }

  if (composed.compose_noise.length > 0) {
    lines.push("", "**Compose noise (possible false positives):**");
    for (const n of composed.compose_noise) {
      lines.push(`- \`${n.component_id}\`: ${n.reason}`);
    }
  }

  lines.push(
    "",
    "### Fixture check _(auto-computed from compose output)_",
    "",
    ...fixtureRows(p, routeIds),
    "",
    "### Scoring",
    "",
    ...scoringTable(),
    "",
    "---",
  );

  return lines;
}

// ── Assemble output ────────────────────────────────────────────────────────────

const staleNote = build.stale
  ? "**⚠️ STALE** — run `pnpm build` and restart server before collecting B/C responses"
  : build.built_at === null
    ? "no (dev/tsx mode — registry always fresh)"
    : "no";

const out: string[] = [
  "# OrchestrateKit MCP — Benchmark Results",
  "",
  "**Protocol version:** v2",
  `**Run date:** ${today}`,
  "**Tester:** _____________",
  "**Client:** Cursor / Claude Desktop / ChatGPT _(circle one)_",
  "**Model:** _____________",
  "**Model version / snapshot:** _____________",
  "**MCP server version:** 0.1.0",
  `**Registry fingerprint:** ${build.fingerprint}`,
  `**Registry stale at run start:** ${staleNote}`,
  `**Registry at time of run:** ${registry.components.length} components, ${registry.edges.length} edges, ${registry.routes.length} routes, ${registry.playbooks.length} playbooks`,
  "**Settings:**",
  "  - temperature: default",
  "  - web search: _____________",
  "  - tools (B/C): list_known_routes, get_route, compose_workflow_route, get_graph_component, get_stack_recommendation",
  "  - tools (A): none",
  "**Condition A isolation confirmed:** yes / no",
  "",
  "---",
  "",
  "## Summary scores",
  "",
  "| Prompt | B (/28) | C (/30) | C − B | Gate |",
  "| --- | --- | --- | --- | --- |",
  ...selected.map((p) => `| ${p.title} | — | — | — | |`),
  "| **Average** | | | — | |",
  "",
  "---",
  "",
];

for (const p of selected) {
  out.push(...renderPrompt(p), "");
}

out.push(
  "## Retro questions",
  "",
  "1. Did `compose_workflow_route` improve results for novel/graph-composed prompts (p6, p7)?",
  "2. Did the graph reduce generic advice in any Condition C response?",
  "3. Were untested edges useful context or noise for the scorer?",
  "4. Any false positives (forbidden components) in the compose output?",
  "5. What should change before the next run?",
  "",
);

process.stdout.write(out.join("\n"));
