/**
 * OrchestrateKit MCP — manual smoke script
 *
 * Run with:  pnpm tsx scripts/smoke-mcp.ts
 *
 * Calls the underlying logic for all 12 registered M2 tools and prints
 * pass/fail for each. Useful for quick local validation without a full
 * test run, and as a reference for what each tool returns.
 *
 * Does NOT start an MCP server process — calls the same functions the
 * tools use internally (deterministic, no side effects).
 */

import { loadRegistry } from "../src/registry/registryLoader.js";
import { buildHealthCheckResult } from "../src/tools/index.js";
import { composeRoute } from "../src/graph/routeComposer.js";
import { loadDocsIndex, matchDocsIndex } from "../src/docs-index/loader.js";
import { calculateRiskScore, deriveStatus } from "../src/review/types.js";
import { ALL_RULES } from "../src/review/rules/index.js";
import { findOverlappingPlaybooks } from "../src/graph/playbookOverlap.js";
import { classifySteps } from "../src/architecture/stepClassifier.js";
import { getDoNotBuildRules } from "../src/architecture/doNotBuildRules.js";

// ---------------------------------------------------------------------------

type SmokeResult = { tool: string; passed: boolean; note: string };

const results: SmokeResult[] = [];

function check(tool: string, fn: () => void): void {
  try {
    fn();
    results.push({ tool, passed: true, note: "ok" });
  } catch (err) {
    results.push({
      tool,
      passed: false,
      note: err instanceof Error ? err.message : String(err),
    });
  }
}

function assertDefined<T>(v: T | undefined | null, name: string): T {
  if (v == null) throw new Error(`${name} is undefined/null`);
  return v;
}

function assertLength<T>(arr: T[], name: string, minLen = 1): T[] {
  if (arr.length < minLen) throw new Error(`${name} is empty (expected >= ${minLen})`);
  return arr;
}

// ---------------------------------------------------------------------------
// Load shared state
// ---------------------------------------------------------------------------

const registry = loadRegistry({ includeBeta: true });
const docsIndex = loadDocsIndex();

// ---------------------------------------------------------------------------
// 1. health_check
// ---------------------------------------------------------------------------

check("health_check", () => {
  const result = buildHealthCheckResult();
  assertDefined(result.name, "name");
  assertDefined(result.version, "version");
  if (result.registry.component_count < 1)
    throw new Error("registry has no components");
  console.log(
    `  → ${result.name} v${result.version} | ` +
    `${result.registry.component_count} components, ` +
    `${result.registry.edge_count} edges, ` +
    `${result.registry.playbook_count} playbooks`,
  );
});

// ---------------------------------------------------------------------------
// 2. list_graph_components
// ---------------------------------------------------------------------------

check("list_graph_components", () => {
  const components = assertLength(registry.components, "components", 20);
  console.log(`  → ${components.length} components loaded`);
});

// ---------------------------------------------------------------------------
// 3. get_graph_component
// ---------------------------------------------------------------------------

check("get_graph_component", () => {
  const comp = assertDefined(
    registry.components.find((c) => c.id === "human_approval_gate"),
    "human_approval_gate",
  );
  if (comp.category !== "safety")
    throw new Error(`human_approval_gate category is ${comp.category}, expected safety`);
  console.log(`  → ${comp.id} [${comp.category}] capabilities: ${comp.capabilities.slice(0, 2).join(", ")}`);
});

// ---------------------------------------------------------------------------
// 4. list_graph_edges
// ---------------------------------------------------------------------------

check("list_graph_edges", () => {
  const edges = assertLength(registry.edges, "edges", 40);
  const approvalEdge = edges.find((e) => e.to === "human_approval_gate");
  if (!approvalEdge) throw new Error("no edge pointing to human_approval_gate");
  console.log(`  → ${edges.length} edges | approval edge: ${approvalEdge.id}`);
});

// ---------------------------------------------------------------------------
// 5. get_stack_recommendation
// ---------------------------------------------------------------------------

check("get_stack_recommendation", () => {
  const stack = assertDefined(
    registry.stacks.find((s) => s.id === "default_orchestratekit_stack"),
    "default_orchestratekit_stack",
  );
  if (Object.keys(stack.choices).length < 3)
    throw new Error("stack has too few choices");
  console.log(`  → ${stack.name} — ${Object.keys(stack.choices).length} technology choices`);
});

// ---------------------------------------------------------------------------
// 6. list_known_routes
// ---------------------------------------------------------------------------

check("list_known_routes", () => {
  const routes = assertLength(registry.routes, "routes", 3);
  console.log(`  → ${routes.length} routes: ${routes.map((r) => r.id).join(", ")}`);
});

// ---------------------------------------------------------------------------
// 7. get_route
// ---------------------------------------------------------------------------

check("get_route", () => {
  const route = assertDefined(
    registry.routes.find((r) => r.id === "research_route_v1"),
    "research_route_v1",
  );
  assertLength(route.components, "route.components", 3);
  console.log(
    `  → ${route.id} | ${route.components.length} components | confidence ${Math.round(route.confidence * 100)}%`,
  );
});

// ---------------------------------------------------------------------------
// 8. compose_workflow_route
// ---------------------------------------------------------------------------

check("compose_workflow_route", () => {
  const result = composeRoute(
    {
      goal: "scrape job listings, normalise and store them with deduplication",
      must_have_capabilities: [],
      must_avoid: [],
    },
    registry,
  );
  if (result.status === "not_found") throw new Error("compose returned not_found");
  if (result.recommended_route.length < 3)
    throw new Error(`route too short: ${result.recommended_route.length} steps`);
  console.log(
    `  → ${result.status} | ${result.recommended_route.length} steps | ` +
    `score ${result.route_score}/100 | ` +
    `playbooks: ${result.known_playbooks_reused.join(", ") || "none"}`,
  );
});

// ---------------------------------------------------------------------------
// 8b. compose_workflow_route — candidate route (no exact playbook match)
// ---------------------------------------------------------------------------

check("compose_workflow_route (candidate — no exact playbook)", () => {
  const result = composeRoute(
    {
      goal: "monitor a public API endpoint for schema drift and alert via webhook when a breaking change is detected",
      must_have_capabilities: [],
      must_avoid: [],
    },
    registry,
  );
  if (result.status === "not_found") throw new Error("compose returned not_found for candidate goal");
  console.log(
    `  → ${result.status} | ${result.recommended_route.length} steps | ` +
    `confidence ${Math.round(result.confidence * 100)}% | ` +
    `playbooks reused: ${result.known_playbooks_reused.length}`,
  );
});

// ---------------------------------------------------------------------------
// 9. get_playbook
// ---------------------------------------------------------------------------

check("get_playbook", () => {
  const playbook = assertDefined(
    registry.playbooks.find((p) => p.id === "codebase_agent_workflow"),
    "codebase_agent_workflow",
  );
  if (!playbook.golden_path_route_id)
    throw new Error("playbook missing golden_path_route_id");
  const route = registry.routes.find((r) => r.id === playbook.golden_path_route_id);
  if (!route) throw new Error(`golden_path_route_id ${playbook.golden_path_route_id} not found`);
  console.log(
    `  → ${playbook.id} | route: ${route.id} | ` +
    `components: ${playbook.components.length} | evals: ${playbook.evals.length}`,
  );
});

// ---------------------------------------------------------------------------
// 10. get_relevant_docs
// ---------------------------------------------------------------------------

check("get_relevant_docs", () => {
  assertLength(docsIndex, "docsIndex", 3);
  const matches = matchDocsIndex(docsIndex, { frameworks: ["cursor", "mcp"] });
  assertLength(matches, "docs matches for cursor+mcp", 1);
  console.log(`  → ${docsIndex.length} docs-index entries | cursor+mcp matches: ${matches.length}`);
});

// ---------------------------------------------------------------------------
// 11. recommend_architecture
// ---------------------------------------------------------------------------

check("recommend_architecture", () => {
  const composed = composeRoute(
    {
      goal: "read emails, classify intent and draft a reply based on context",
      must_have_capabilities: [],
      must_avoid: [],
    },
    registry,
  );
  if (composed.status === "not_found") throw new Error("compose not_found for architecture goal");

  const componentIds = composed.recommended_route.map((s) => s.component_id);
  const classification = classifySteps(componentIds, registry.components);
  const doNotBuild = getDoNotBuildRules({ goal: "email assistant", componentIds });
  const matchedPlaybooks = findOverlappingPlaybooks(new Set(componentIds), registry.playbooks, 0.5);

  if (componentIds.length < 3) throw new Error("too few components for architecture");
  console.log(
    `  → ${composed.status} | ${componentIds.length} components | ` +
    `llm: ${classification.llm_driven_steps.length} | det: ${classification.deterministic_steps.length} | gates: ${classification.approval_gate_components.length} | ` +
    `do-not-build: ${doNotBuild.length} | playbooks: ${matchedPlaybooks.length}`,
  );
});

// ---------------------------------------------------------------------------
// 12. review_workflow_design
// ---------------------------------------------------------------------------

check("review_workflow_design", () => {
  const compIds = ["external_publish", "copy_generation"];
  const ctx = {
    goal: "generate copy and publish to website",
    workflowName: "Content Publisher",
    proposedArchitecture: "LLM generates copy, then publishes to website",
    componentIds: compIds,
    agents: [],
    userTools: [],
    integrations: ["email"],
    hasPersistentState: false,
    humanApprovalDeclared: false,
    humanApprovalRequired: false,
    riskLevel: undefined as string | undefined,
    resolvedComponents: registry.components.filter((c) => compIds.includes(c.id)),
    resolvedEdges: registry.edges.filter((e) => compIds.includes(e.from) || compIds.includes(e.to)),
    resolvedRoute: undefined,
    resolvedPlaybooks: [],
    hasExternalWrite: true,
    hasResearch: false,
    hasDataScraper: false,
    hasSchemaValidation: false,
    hasCitationChecker: false,
    hasHumanApprovalGate: false,
    hasAuditLog: false,
    hasRetryPolicy: false,
    isMultiStep: false,
    isSimpleWorkflow: true,
  };

  const findings = ALL_RULES.flatMap((r) => r(ctx));
  const score = calculateRiskScore(findings);
  const status = deriveStatus(score, findings);

  if (score === 0) throw new Error("review returned score=0 for dangerous workflow (expected >= 25)");
  if (status !== "fail") throw new Error(`expected fail, got ${status}`);

  const criticalFindings = findings.filter((f) => f.severity === "critical");
  if (criticalFindings.length === 0) throw new Error("expected at least 1 critical finding for external_publish without gate");

  console.log(
    `  → status=${status} | score=${score}/100 | ` +
    `critical: ${criticalFindings.length} | ` +
    `all findings: ${findings.length}`,
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);

console.log("\n" + "─".repeat(60));
console.log(`\n  OrchestrateKit MCP — Smoke Test\n`);
console.log(`  ${passed.length}/${results.length} tools passed\n`);

for (const r of results) {
  const icon = r.passed ? "✅" : "❌";
  console.log(`  ${icon}  ${r.tool}${r.passed ? "" : `\n     ↳ ${r.note}`}`);
}

console.log("\n" + "─".repeat(60));

if (failed.length > 0) {
  process.exit(1);
}
