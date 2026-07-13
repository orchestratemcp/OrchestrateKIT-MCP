import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { composeRoute } from "../graph/routeComposer.js";
import { getRegistryBuild } from "../registry/buildManifest.js";
import { contentFingerprint } from "../registry/contentFingerprint.js";
import { loadRegistry, readRawEntries } from "../registry/registryLoader.js";

export const PUBLIC_BENCHMARK_SCHEMA_VERSION = "1.0";

export type BenchmarkPrompt = {
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
};

type PromptsFile = { prompts: BenchmarkPrompt[] };

export type FixtureVerdict = {
  required: string[];
  required_present: string[];
  required_missing: string[];
  forbidden: string[];
  forbidden_absent: string[];
  forbidden_present: string[];
  nice_to_have: string[];
  nice_to_have_present: string[];
  assertion_count: number;
  passed_assertion_count: number;
  passed: boolean;
};

export type PublicBenchmarkPromptResult = {
  id: string;
  title: string;
  category: string;
  expected_playbook: string | null;
  expected_playbook_present: boolean | null;
  fixture: FixtureVerdict;
  composition: {
    status: string;
    route_status: string;
    route_score: number;
    components: string[];
    blocking_gaps: string[];
    untested_edges: Array<{ id: string; severity: string }>;
    compose_noise: Array<{ component_id: string; reason: string }>;
    playbook_first: {
      recommendation_type: string;
      playbook_id: string;
      recall: number;
      precision: number;
    } | null;
  };
  passed: boolean;
};

export type PublicBenchmarkReport = {
  schema_version: string;
  report_fingerprint: string;
  methodology: {
    name: string;
    kind: "deterministic_registry_conformance";
    llm_calls: 0;
    network_calls: 0;
    measures: string[];
    does_not_measure: string[];
    llm_quality_claim_status: "hold_for_isolated_client_rerun";
  };
  provenance: {
    package_name: string;
    package_version: string;
    registry_fingerprint: string;
    registry_scope: "public_non_beta";
    registry_build_mode: "source" | "compiled";
    registry_counts: {
      components: number;
      edges: number;
      routes: number;
      playbooks: number;
      workers: number;
    };
    source_hashes: {
      prompts_v2_sha256: string;
      false_positives_v1_sha256: string;
    };
    environment_contract: {
      node: string;
      package_manager: string;
      execution: "local_no_network";
    };
  };
  summary: {
    prompt_count: number;
    prompts_passed: number;
    fixture_assertions: number;
    fixture_assertions_passed: number;
    required_components_missing: number;
    forbidden_components_present: number;
    expected_playbooks_missing: number;
    route_score_average: number;
    route_score_min: number;
    route_score_max: number;
    candidate_or_blocked_routes: number;
    untested_edges_reported: number;
    compose_noise_flags: number;
    playbook_first_recommendations: number;
    passed: boolean;
  };
  prompts: PublicBenchmarkPromptResult[];
};

function defaultRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function benchmarkSourceFingerprint(value: string): string {
  return sha256(value.replace(/\r\n?/g, "\n"));
}

export function benchmarkArtifactMatches(actual: string, expected: string): boolean {
  return actual.replace(/\r\n/g, "\n") === expected.replace(/\r\n/g, "\n");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function evaluateFixture(
  prompt: Pick<BenchmarkPrompt, "must_have" | "nice_to_have" | "forbidden">,
  componentIds: Iterable<string>,
): FixtureVerdict {
  const actual = new Set(componentIds);
  const required = prompt.must_have ?? [];
  const forbidden = prompt.forbidden ?? [];
  const niceToHave = prompt.nice_to_have ?? [];
  const requiredPresent = required.filter((id) => actual.has(id));
  const requiredMissing = required.filter((id) => !actual.has(id));
  const forbiddenPresent = forbidden.filter((id) => actual.has(id));
  const forbiddenAbsent = forbidden.filter((id) => !actual.has(id));
  const assertionCount = required.length + forbidden.length;
  const passedAssertionCount = requiredPresent.length + forbiddenAbsent.length;

  return {
    required,
    required_present: requiredPresent,
    required_missing: requiredMissing,
    forbidden,
    forbidden_absent: forbiddenAbsent,
    forbidden_present: forbiddenPresent,
    nice_to_have: niceToHave,
    nice_to_have_present: niceToHave.filter((id) => actual.has(id)),
    assertion_count: assertionCount,
    passed_assertion_count: passedAssertionCount,
    passed: requiredMissing.length === 0 && forbiddenPresent.length === 0,
  };
}

export function buildPublicBenchmark(root = defaultRoot()): PublicBenchmarkReport {
  const promptsPath = join(root, "benchmarks", "prompts-v2.yaml");
  const falsePositivesPath = join(root, "benchmarks", "fixtures", "false-positives-v1.yaml");
  const packagePath = join(root, "package.json");
  const registryDir = join(root, "registry");
  const promptsSource = readFileSync(promptsPath, "utf8");
  const falsePositivesSource = readFileSync(falsePositivesPath, "utf8");
  const promptFile = parseYaml(promptsSource) as PromptsFile;
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
    name: string;
    version: string;
    packageManager?: string;
    engines?: { node?: string };
  };
  const registry = loadRegistry({ includeBeta: false, registryDir });
  const build = getRegistryBuild(registryDir);
  const registryFingerprint = contentFingerprint(readRawEntries(registryDir));
  if (build.stale || build.process_stale) {
    throw new Error(
      `Refusing benchmark on stale registry ${build.fingerprint}; run pnpm build and retry.`,
    );
  }

  const playbookIds = new Set(registry.playbooks.map((playbook) => playbook.id));
  const prompts = promptFile.prompts.map((prompt): PublicBenchmarkPromptResult => {
    const goal = (prompt.compose_workflow_route_goal ?? prompt.prompt).trim();
    const composed = composeRoute(
      { goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" },
      registry,
    );
    const componentIds = composed.recommended_route.map((step) => step.component_id);
    const fixture = evaluateFixture(prompt, componentIds);
    const expectedPlaybook = prompt.has_exact_playbook ? (prompt.playbook_id ?? null) : null;
    const expectedPlaybookPresent = expectedPlaybook ? playbookIds.has(expectedPlaybook) : null;

    return {
      id: prompt.id,
      title: prompt.title,
      category: prompt.category,
      expected_playbook: expectedPlaybook,
      expected_playbook_present: expectedPlaybookPresent,
      fixture,
      composition: {
        status: composed.status,
        route_status: composed.route_status,
        route_score: composed.route_score,
        components: componentIds,
        blocking_gaps: composed.blocking_gaps,
        untested_edges: composed.untested_edges,
        compose_noise: composed.compose_noise,
        playbook_first: composed.playbook_recommendation
          ? {
              recommendation_type: composed.playbook_recommendation.recommendation_type,
              playbook_id: composed.playbook_recommendation.playbook_id,
              recall: composed.playbook_recommendation.overlap.recall,
              precision: composed.playbook_recommendation.overlap.precision,
            }
          : null,
      },
      passed: fixture.passed && expectedPlaybookPresent !== false,
    };
  });

  const routeScores = prompts.map((prompt) => prompt.composition.route_score);
  const fixtureAssertions = prompts.reduce(
    (total, prompt) => total + prompt.fixture.assertion_count,
    0,
  );
  const fixtureAssertionsPassed = prompts.reduce(
    (total, prompt) => total + prompt.fixture.passed_assertion_count,
    0,
  );
  const reportWithoutFingerprint = {
    schema_version: PUBLIC_BENCHMARK_SCHEMA_VERSION,
    methodology: {
      name: "OrchestrateMCP public registry conformance benchmark",
      kind: "deterministic_registry_conformance" as const,
      llm_calls: 0 as const,
      network_calls: 0 as const,
      measures: [
        "required component coverage",
        "forbidden component absence",
        "expected playbook availability",
        "route status and deterministic route score",
        "untested edges, blocking gaps, and compose-noise disclosure",
      ],
      does_not_measure: [
        "LLM response quality",
        "vanilla-model versus MCP improvement",
        "client-specific behavior",
        "production workflow reliability",
      ],
      llm_quality_claim_status: "hold_for_isolated_client_rerun" as const,
    },
    provenance: {
      package_name: pkg.name,
      package_version: pkg.version,
      registry_fingerprint: registryFingerprint,
      registry_scope: "public_non_beta" as const,
      registry_build_mode: (build.built_at ? "compiled" : "source") as "source" | "compiled",
      registry_counts: {
        components: registry.components.length,
        edges: registry.edges.length,
        routes: registry.routes.length,
        playbooks: registry.playbooks.length,
        workers: registry.workers.length,
      },
      source_hashes: {
        prompts_v2_sha256: benchmarkSourceFingerprint(promptsSource),
        false_positives_v1_sha256: benchmarkSourceFingerprint(falsePositivesSource),
      },
      environment_contract: {
        node: pkg.engines?.node ?? "unknown",
        package_manager: pkg.packageManager ?? "pnpm with frozen pnpm-lock.yaml",
        execution: "local_no_network" as const,
      },
    },
    summary: {
      prompt_count: prompts.length,
      prompts_passed: prompts.filter((prompt) => prompt.passed).length,
      fixture_assertions: fixtureAssertions,
      fixture_assertions_passed: fixtureAssertionsPassed,
      required_components_missing: prompts.reduce(
        (total, prompt) => total + prompt.fixture.required_missing.length,
        0,
      ),
      forbidden_components_present: prompts.reduce(
        (total, prompt) => total + prompt.fixture.forbidden_present.length,
        0,
      ),
      expected_playbooks_missing: prompts.filter(
        (prompt) => prompt.expected_playbook_present === false,
      ).length,
      route_score_average:
        Math.round(
          (routeScores.reduce((total, score) => total + score, 0) /
            Math.max(routeScores.length, 1)) * 10,
        ) / 10,
      route_score_min: Math.min(...routeScores),
      route_score_max: Math.max(...routeScores),
      candidate_or_blocked_routes: prompts.filter(
        (prompt) => prompt.composition.route_status !== "validated",
      ).length,
      untested_edges_reported: prompts.reduce(
        (total, prompt) => total + prompt.composition.untested_edges.length,
        0,
      ),
      compose_noise_flags: prompts.reduce(
        (total, prompt) => total + prompt.composition.compose_noise.length,
        0,
      ),
      playbook_first_recommendations: prompts.filter(
        (prompt) => prompt.composition.playbook_first?.recommendation_type === "playbook",
      ).length,
      passed: prompts.every((prompt) => prompt.passed),
    },
    prompts,
  };
  const reportFingerprint = sha256(stableJson(reportWithoutFingerprint)).slice(0, 16);

  return {
    schema_version: reportWithoutFingerprint.schema_version,
    report_fingerprint: reportFingerprint,
    methodology: reportWithoutFingerprint.methodology,
    provenance: reportWithoutFingerprint.provenance,
    summary: reportWithoutFingerprint.summary,
    prompts: reportWithoutFingerprint.prompts,
  };
}

export function serializePublicBenchmark(report: PublicBenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderPublicBenchmarkMarkdown(report: PublicBenchmarkReport): string {
  const counts = report.provenance.registry_counts;
  const rows = report.prompts.map((prompt) => {
    const fixture = `${prompt.fixture.passed_assertion_count}/${prompt.fixture.assertion_count}`;
    const playbook = prompt.composition.playbook_first?.recommendation_type === "playbook"
      ? `\`${prompt.composition.playbook_first.playbook_id}\``
      : "compose";
    return `| ${prompt.id} | ${fixture} | ${prompt.composition.route_status} | ${prompt.composition.route_score} | ${prompt.composition.untested_edges.length} | ${prompt.composition.compose_noise.length} | ${playbook} | ${prompt.passed ? "PASS" : "FAIL"} |`;
  });

  return [
    "# Public benchmark — deterministic registry conformance",
    "",
    "> This benchmark makes **zero LLM and network calls**. It reproduces matcher/graph fixture results, not model-quality uplift. Archived A/B/C scores are not a current public claim; that claim stays on hold until isolated client runs are completed.",
    "",
    "## Reproduce",
    "",
    "```bash",
    "pnpm install --frozen-lockfile",
    "pnpm benchmark",
    "pnpm benchmark:check",
    "```",
    "",
    "## Provenance",
    "",
    `- Package: \`${report.provenance.package_name}@${report.provenance.package_version}\``,
    `- Registry fingerprint: \`${report.provenance.registry_fingerprint}\``,
    `- Report fingerprint: \`${report.report_fingerprint}\``,
    `- Public non-beta registry: ${counts.components} components / ${counts.edges} edges / ${counts.routes} routes / ${counts.playbooks} playbooks / ${counts.workers} workers`,
    `- Prompt source SHA-256: \`${report.provenance.source_hashes.prompts_v2_sha256}\``,
    `- False-positive fixture SHA-256: \`${report.provenance.source_hashes.false_positives_v1_sha256}\``,
    "",
    "## Current result",
    "",
    `**${report.summary.prompts_passed}/${report.summary.prompt_count} prompts pass; ${report.summary.fixture_assertions_passed}/${report.summary.fixture_assertions} required/forbidden assertions pass.**`,
    "",
    `Deterministic route scores range from ${report.summary.route_score_min} to ${report.summary.route_score_max} (average ${report.summary.route_score_average}). These are graph-internal scores, not LLM quality scores. The report also exposes ${report.summary.candidate_or_blocked_routes} non-validated routes, ${report.summary.untested_edges_reported} untested-edge occurrences, and ${report.summary.compose_noise_flags} compose-noise flags instead of hiding them.`,
    "",
    "| Prompt | Fixtures | Route status | Route score | Untested | Noise | Path | Verdict |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- | --- |",
    ...rows,
    "",
    "## What this proves",
    "",
    "- The current registry fingerprint deterministically covers every declared required component in the seven public prompts.",
    "- Known forbidden cross-domain components do not leak into those routes.",
    "- Expected playbooks exist, and the composer can recommend playbook-first reuse when overlap warrants it.",
    "- Candidate status, untested edges, blocking gaps, and matcher noise remain visible in the machine-readable report.",
    "",
    "## What this does not prove",
    "",
    "- It does not compare a vanilla model with an MCP-assisted model.",
    "- It does not measure ChatGPT, Claude, or Cursor response quality.",
    "- It does not prove that a designed workflow is production-reliable.",
    "- A/B/C client scoring still follows [PROTOCOL.md](../PROTOCOL.md) and requires fresh isolated conversations plus human scoring.",
    "",
    "Machine-readable result: [latest.json](latest.json). Historical manual runs remain under `benchmarks/results-*.md` with their original caveats.",
  ].join("\n");
}
