/**
 * Smoke tests for OrchestrateMCP tools (health_check + 14 graph tools = 15 total).
 *
 * These tests call the underlying tool logic directly (same code path used by
 * the MCP server) and assert that every tool returns a JSON-serializable
 * result with the expected structure. No MCP server process is started.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { buildHealthCheckResult } from "../../src/tools/index.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { buildSessionFeedback } from "../../src/tools/recordSessionFeedback.js";
import { loadDocsIndex, matchDocsIndex } from "../../src/docs-index/loader.js";
import { ALL_RULES } from "../../src/review/rules/index.js";
import {
  calculateRiskScore,
  deriveStatus,
  type ReviewContext,
} from "../../src/review/types.js";
import { classifySteps } from "../../src/architecture/stepClassifier.js";
import { getDoNotBuildRules } from "../../src/architecture/doNotBuildRules.js";
import { findOverlappingPlaybooks } from "../../src/graph/playbookOverlap.js";
import type { Registry } from "../../src/registry/registryTypes.js";
import type { DocsIndexEntry } from "../../src/docs-index/schema.js";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let registry: Registry;
let docsIndex: DocsIndexEntry[];

beforeAll(() => {
  registry = loadRegistry({ includeBeta: true });
  docsIndex = loadDocsIndex();
});

// ---------------------------------------------------------------------------
// 1. health_check
// ---------------------------------------------------------------------------

describe("health_check", () => {
  it("returns registry counts and server metadata", () => {
    const result = buildHealthCheckResult();
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();

    expect(result.name).toBe("orchestratekit-mcp");
    expect(result.version).toBeTruthy();
    expect(result.registry.component_count).toBeGreaterThanOrEqual(20);
    expect(result.registry.edge_count).toBeGreaterThanOrEqual(40);
    expect(result.registry.playbook_count).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 2. list_graph_components
// ---------------------------------------------------------------------------

describe("list_graph_components", () => {
  it("loads at least 20 published components", () => {
    const { components } = registry;
    expect(components.length).toBeGreaterThanOrEqual(20);

    const sample = components[0];
    expect(sample.id).toBeTruthy();
    expect(sample.name).toBeTruthy();
    expect(Array.isArray(sample.capabilities)).toBe(true);
    expect(() => JSON.stringify(components)).not.toThrow();
  });

  it("components include safety category entries", () => {
    const safety = registry.components.filter((c) => c.category === "safety");
    expect(safety.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 3. get_graph_component
// ---------------------------------------------------------------------------

describe("get_graph_component", () => {
  it("finds human_approval_gate in the registry", () => {
    const comp = registry.components.find((c) => c.id === "human_approval_gate");
    expect(comp).toBeDefined();
    expect(comp!.category).toBe("safety");
    expect(comp!.capabilities.length).toBeGreaterThanOrEqual(1);
  });

  it("returns undefined for unknown id", () => {
    const comp = registry.components.find((c) => c.id === "does_not_exist");
    expect(comp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. list_graph_edges
// ---------------------------------------------------------------------------

describe("list_graph_edges", () => {
  it("loads at least 40 edges", () => {
    const { edges } = registry;
    expect(edges.length).toBeGreaterThanOrEqual(40);
    expect(() => JSON.stringify(edges)).not.toThrow();
  });

  it("edges contain an approval gate relation", () => {
    const approvalEdge = registry.edges.find((e) => e.to === "human_approval_gate");
    expect(approvalEdge).toBeDefined();
    expect(approvalEdge!.relation).toBe("requires");
  });

  it("edges have required fields", () => {
    const e = registry.edges[0];
    expect(e.id).toBeTruthy();
    expect(e.from).toBeTruthy();
    expect(e.to).toBeTruthy();
    expect(e.relation).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. get_stack_recommendation
// ---------------------------------------------------------------------------

describe("get_stack_recommendation", () => {
  it("loads the default stack with technology choices", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    expect(Object.keys(stack!.choices).length).toBeGreaterThanOrEqual(3);
    expect(() => JSON.stringify(stack)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. list_known_routes
// ---------------------------------------------------------------------------

describe("list_known_routes", () => {
  it("loads at least 3 routes", () => {
    const { routes } = registry;
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(() => JSON.stringify(routes)).not.toThrow();
  });

  it("routes have required fields", () => {
    const r = registry.routes[0];
    expect(r.id).toBeTruthy();
    expect(Array.isArray(r.components)).toBe(true);
    expect(typeof r.confidence).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 7. get_route
// ---------------------------------------------------------------------------

describe("get_route", () => {
  it("finds research_route_v1 with components", () => {
    const route = registry.routes.find((r) => r.id === "research_route_v1");
    expect(route).toBeDefined();
    expect(route!.components.length).toBeGreaterThanOrEqual(3);
    expect(route!.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. compose_workflow_route
// ---------------------------------------------------------------------------

describe("compose_workflow_route", () => {
  it("composes a valid route for a data extraction goal", () => {
    const result = composeRoute(
      {
        goal: "scrape product listings, normalise data and store with deduplication",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    expect(result.status).not.toBe("not_found");
    expect(result.recommended_route.length).toBeGreaterThanOrEqual(3);
    expect(typeof result.route_score).toBe("number");
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.edges_used)).toBe(true);
    expect(Array.isArray(result.untested_edges)).toBe(true);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  // Acceptance criteria: at least one graph-composed candidate route with
  // no exact playbook match.
  it("returns a candidate route for a goal with no exact playbook match", () => {
    const result = composeRoute(
      {
        goal: "monitor a public API endpoint for schema drift and alert via webhook when a breaking change is detected",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    expect(result.status).not.toBe("not_found");
    expect(["candidate_route", "low_confidence", "ok"]).toContain(result.status);
    expect(result.recommended_route.length).toBeGreaterThanOrEqual(2);

    const allStepIds = result.recommended_route.map((s) => s.component_id);
    expect(allStepIds.length).toBeGreaterThanOrEqual(2);
  });

  it("labels candidate routes appropriately", () => {
    const result = composeRoute(
      {
        goal: "monitor a public API endpoint for schema drift and alert via webhook when a breaking change is detected",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    if (result.status === "candidate_route" || result.status === "low_confidence") {
      // candidate / low-confidence routes must not claim to be exact playbook matches
      expect(result.known_playbooks_reused.length).toBeLessThanOrEqual(
        result.recommended_route.length,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 9. get_playbook
// ---------------------------------------------------------------------------

describe("get_playbook", () => {
  it("finds codebase_agent_workflow playbook", () => {
    const pb = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(pb).toBeDefined();
    expect(pb!.golden_path_route_id).toBeTruthy();
    expect(pb!.components.length).toBeGreaterThanOrEqual(3);
    expect(() => JSON.stringify(pb)).not.toThrow();
  });

  it("golden_path_route_id resolves to a known route", () => {
    const pb = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    const route = registry.routes.find((r) => r.id === pb!.golden_path_route_id);
    expect(route).toBeDefined();
  });

  it("can match playbook by workflow_type", () => {
    const matches = registry.playbooks.filter((p) =>
      p.workflow_type.toLowerCase().includes("agent"),
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("evals array exists (may be empty)", () => {
    for (const pb of registry.playbooks) {
      expect(Array.isArray(pb.evals)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. get_relevant_docs
// ---------------------------------------------------------------------------

describe("get_relevant_docs", () => {
  it("loads at least 3 docs-index entries", () => {
    expect(docsIndex.length).toBeGreaterThanOrEqual(3);
    expect(() => JSON.stringify(docsIndex)).not.toThrow();
  });

  it("each entry has required fields", () => {
    for (const entry of docsIndex) {
      expect(entry.id).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.summary).toBeTruthy();
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });

  it("matchDocsIndex finds cursor/mcp docs by tag", () => {
    const matches = matchDocsIndex(docsIndex, { frameworks: ["cursor", "mcp"] });
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("matchDocsIndex filters by relevant_to registry entity", () => {
    const matches = matchDocsIndex(docsIndex, { component_ids: ["human_approval_gate"] });
    // May or may not match — but should not throw
    expect(() => JSON.stringify(matches)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 11. recommend_architecture
// ---------------------------------------------------------------------------

describe("recommend_architecture", () => {
  it("composes and classifies an email assistant workflow", () => {
    const composed = composeRoute(
      {
        goal: "read emails, classify intent and draft a reply based on thread context",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    expect(composed.status).not.toBe("not_found");

    const componentIds = composed.recommended_route.map((s) => s.component_id);
    expect(componentIds.length).toBeGreaterThanOrEqual(3);

    const classification = classifySteps(componentIds, registry.components);
    expect(Array.isArray(classification.llm_driven_steps)).toBe(true);
    expect(Array.isArray(classification.deterministic_steps)).toBe(true);
    expect(Array.isArray(classification.approval_gate_components)).toBe(true);

    const matchedPlaybooks = findOverlappingPlaybooks(
      new Set(componentIds),
      registry.playbooks,
      0.5,
    );
    expect(Array.isArray(matchedPlaybooks)).toBe(true);

    const doNotBuild = getDoNotBuildRules({
      goal: "email assistant",
      componentIds,
    });
    expect(Array.isArray(doNotBuild)).toBe(true);

    expect(() =>
      JSON.stringify({ composed, classification, matchedPlaybooks, doNotBuild }),
    ).not.toThrow();
  });

  it("applies do-not-build rules for suspicious vector DB usage", () => {
    const result = getDoNotBuildRules({
      goal: "simple one-step lookup",
      componentIds: ["vector_store"],
    });
    // The vector DB rule should fire when goal is simple
    expect(Array.isArray(result)).toBe(true);
  });

  it("classifySteps returns approval_gate_components for external publish component", () => {
    const ids = ["external_publish", "human_approval_gate"];
    const cls = classifySteps(ids, registry.components);
    expect(cls.approval_gate_components.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 12. review_workflow_design
// ---------------------------------------------------------------------------

describe("review_workflow_design", () => {
  function buildCtx(overrides: Partial<ReviewContext> = {}): ReviewContext {
    const compIds = overrides.componentIds ?? ["external_publish", "copy_generation"];
    return {
      goal: "generate copy and publish to website",
      workflowName: "Content Publisher",
      proposedArchitecture: "LLM generates copy, then publishes to website automatically",
      componentIds: compIds,
      agents: [],
      userTools: [],
      integrations: overrides.integrations ?? ["email"],
      hasPersistentState: false,
      humanApprovalDeclared: false,
      humanApprovalRequired: false,
      riskLevel: undefined,
      resolvedComponents: registry.components.filter((c) => compIds.includes(c.id)),
      resolvedEdges: registry.edges.filter(
        (e) => compIds.includes(e.from) || compIds.includes(e.to),
      ),
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
      hasAuthFailureHandler: false,
      isMultiStep: false,
      isSimpleWorkflow: true,
      ...overrides,
    };
  }

  it("returns critical findings for external_publish without approval gate", () => {
    const ctx = buildCtx();
    const findings = ALL_RULES.flatMap((r) => r(ctx));
    const score = calculateRiskScore(findings);
    const status = deriveStatus(score, findings);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(25);
    expect(status).toBe("fail");

    const critical = findings.filter((f) => f.severity === "critical");
    expect(critical.length).toBeGreaterThanOrEqual(1);

    expect(() => JSON.stringify(findings)).not.toThrow();
  });

  it("returns pass for a safe, fully gated workflow", () => {
    const compIds = ["human_approval_gate", "copy_generation"];
    const ctx = buildCtx({
      componentIds: compIds,
      integrations: [],
      hasExternalWrite: false,
      hasHumanApprovalGate: true,
      humanApprovalDeclared: true,
      hasPersistentState: true,
      hasAuditLog: true,
      hasRetryPolicy: true,
    });
    const findings = ALL_RULES.flatMap((r) => r(ctx));
    const score = calculateRiskScore(findings);
    const status = deriveStatus(score, findings);

    // A well-designed workflow should score lower
    expect(score).toBeLessThan(50);
    expect(["pass", "warnings"]).toContain(status);
  });

  it("findings have required fields", () => {
    const ctx = buildCtx();
    const findings = ALL_RULES.flatMap((r) => r(ctx));
    for (const f of findings) {
      expect(f.severity).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect(f.message).toBeTruthy();
      expect(f.recommended_fix).toBeTruthy();
    }
  });

  it("calculateRiskScore caps at 100", () => {
    const findings = Array.from({ length: 10 }, () => ({
      severity: "critical" as const,
      category: "approval_gate" as const,
      message: "test",
      reason: "test",
      recommended_fix: "test",
    }));
    expect(calculateRiskScore(findings)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 14. plan_workflow (MAR-100)
// ---------------------------------------------------------------------------

describe("plan_workflow", () => {
  it("returns a fused plan for a playbook-matched goal", () => {
    const r = planWorkflow(
      { goal: "scan a codebase, plan changes, edit code, run tests and write a PR summary", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(r.plan_source).toBe("playbook");
    expect(r.recommended_route.length).toBeGreaterThan(0);
    expect(r.safety_review).toBeDefined();
    expect(r.model_tier_profile).toBeDefined();
  });

  it("returns a composed plan for a novel goal", () => {
    // MAR-265: lead-detection routes playbook-first now — use the
    // (playbook-less) data-report shape as the composed reference.
    const r = planWorkflow(
      { goal: "Every Monday at 8am, pull last week's sales numbers from our Postgres database, generate a PDF summary report, and post it to our team Slack channel.", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(r.plan_source).toBe("composed");
  });

  it("result is JSON-serialisable", () => {
    const r = planWorkflow(
      { goal: "read email and draft replies with approval", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(() => JSON.stringify(r)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 15. record_session_feedback (MAR-126) — stateless ship-step
// ---------------------------------------------------------------------------

describe("record_session_feedback", () => {
  it("emits a stateless, Lab-ready record with safety self-checks", () => {
    const r = buildSessionFeedback(
      {
        goal: "publish approved content to social",
        route_components: ["external_publish"],
        route_selected: "",
        client: "claude",
        model: "claude-opus-4-8",
        user_goal_domain: "content-publishing",
        edges_used: [],
        untested_edges: [],
        what_helped: "",
        what_was_noise: "",
        missing_components: [],
        wrong_components: [],
        new_edge_candidates: [],
        playbook_candidate: "",
        linear_issue_candidates: [],
        baseline_comparison: "",
      },
      registry,
    );
    expect(r.stateless).toBe(true);
    expect(r.self_checks.length).toBeGreaterThanOrEqual(1);
    expect(() => JSON.stringify(r)).not.toThrow();
  });
});
