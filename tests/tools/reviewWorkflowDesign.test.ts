import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { findOverlappingPlaybooks } from "../../src/graph/playbookOverlap.js";
import { calculateRiskScore, deriveStatus } from "../../src/review/types.js";
import { ALL_RULES } from "../../src/review/rules/index.js";
import { approvalGateRules } from "../../src/review/rules/approvalGateRules.js";
import { stateRules } from "../../src/review/rules/stateRules.js";
import { architectureRules } from "../../src/review/rules/architectureRules.js";
import { graphRules } from "../../src/review/rules/graphRules.js";
import type { ReviewContext, ReviewFinding } from "../../src/review/types.js";

const registry = loadRegistry({ includeBeta: true });

// ---------------------------------------------------------------------------
// Minimal context builder
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    goal: "test workflow",
    workflowName: "Test",
    proposedArchitecture: "",
    componentIds: [],
    agents: [],
    userTools: [],
    integrations: [],
    hasPersistentState: false,
    humanApprovalDeclared: false,
    humanApprovalRequired: false,
    riskLevel: undefined,
    resolvedComponents: [],
    resolvedEdges: [],
    resolvedRoute: undefined,
    resolvedPlaybooks: [],
    hasExternalWrite: false,
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

// ---------------------------------------------------------------------------
// Integration: key AC scenarios via rule engine directly
// ---------------------------------------------------------------------------

describe("review_workflow_design — missing approval gate detection", () => {
  it("detects missing gate for email send workflow via safety augmenter", () => {
    const composed = composeRoute(
      { goal: "send email notifications after processing", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const compIds = composed.recommended_route.map((s) => s.component_id);
    const hasEmail = compIds.some((id) =>
      ["optional_email_send", "external_publish"].includes(id),
    );
    const hasGate = compIds.includes("human_approval_gate");
    if (hasEmail) {
      expect(hasGate).toBe(true);
    }
  });

  it("ALL_RULES produces critical finding for external_publish without gate", () => {
    const testCtx = ctx({
      goal: "publish content to website",
      componentIds: ["external_publish"],
      resolvedComponents: registry.components.filter((c) => c.id === "external_publish"),
      resolvedEdges: registry.edges.filter(
        (e) => e.from === "external_publish" || e.to === "external_publish",
      ),
      hasExternalWrite: true,
      hasHumanApprovalGate: false,
    });

    const findings: ReviewFinding[] = ALL_RULES.flatMap((r) => r(testCtx));
    expect(findings.some((f) => f.category === "approval_gate" && f.severity === "critical")).toBe(true);
    expect(calculateRiskScore(findings)).toBeGreaterThanOrEqual(25);
    expect(deriveStatus(calculateRiskScore(findings), findings)).toBe("fail");
  });

  it("approval gate rules pass when human_approval_gate is present", () => {
    const testCtx = ctx({
      goal: "publish content",
      hasExternalWrite: true,
      hasHumanApprovalGate: true,
      humanApprovalRequired: true,
      humanApprovalDeclared: true,
    });
    const findings: ReviewFinding[] = approvalGateRules.flatMap((r) => r(testCtx));
    expect(findings.filter((f) => f.category === "approval_gate" && f.severity === "critical")).toHaveLength(0);
  });
});

describe("review_workflow_design — simple pipeline overdesign warning", () => {
  it("warns when 3+ agents for a simple 2-component workflow", () => {
    const testCtx = ctx({
      goal: "simple content pipeline",
      componentIds: ["content_idea_intake", "copy_generation"],
      agents: [
        { name: "a1", responsibility: "intake", tools: [] },
        { name: "a2", responsibility: "generate", tools: [] },
        { name: "a3", responsibility: "review", tools: [] },
      ],
      isSimpleWorkflow: true,
    });
    const findings: ReviewFinding[] = architectureRules.flatMap((r) => r(testCtx));
    expect(findings.some((f) => f.severity === "medium" && f.category === "architecture")).toBe(true);
  });

  it("does NOT warn for 2 agents", () => {
    const testCtx = ctx({
      goal: "content pipeline",
      componentIds: ["content_idea_intake", "copy_generation"],
      agents: [
        { name: "a1", responsibility: "intake", tools: [] },
        { name: "a2", responsibility: "generate", tools: [] },
      ],
      isSimpleWorkflow: true,
    });
    const findings: ReviewFinding[] = architectureRules.flatMap((r) => r(testCtx));
    const multiAgentIssue = findings.find((f) => f.message.includes("agents"));
    expect(multiAgentIssue).toBeUndefined();
  });
});

describe("review_workflow_design — persistent state missing", () => {
  it("warns for multi-step workflow without state", () => {
    const testCtx = ctx({
      goal: "multi-step data pipeline",
      componentIds: ["data_scraper", "data_normalizer", "deduplication", "schema_validation"],
      hasPersistentState: false,
      hasDataScraper: true,
      hasSchemaValidation: true,
      isMultiStep: true,
      isSimpleWorkflow: false,
    });
    const findings: ReviewFinding[] = stateRules.flatMap((r) => r(testCtx));
    expect(findings.some((f) => f.category === "state" && f.message.includes("persistent state"))).toBe(true);
  });

  it("does NOT warn when hasPersistentState is true", () => {
    const testCtx = ctx({
      goal: "multi-step pipeline",
      isMultiStep: true,
      hasPersistentState: true,
    });
    const findings: ReviewFinding[] = stateRules.flatMap((r) => r(testCtx));
    const stateIssue = findings.find((f) => f.message.includes("persistent state"));
    expect(stateIssue).toBeUndefined();
  });
});

describe("review_workflow_design — graph-aware analysis", () => {
  it("uses research_route_v1 to find untested edges (if any)", () => {
    const route = registry.routes.find((r) => r.id === "research_route_v1");
    expect(route).toBeDefined();

    const testCtx = ctx({
      goal: "research with citations",
      componentIds: route!.components,
      resolvedComponents: registry.components.filter((c) => route!.components.includes(c.id)),
      resolvedEdges: registry.edges.filter(
        (e) => route!.components.includes(e.from) || route!.components.includes(e.to),
      ),
      resolvedRoute: route,
      hasResearch: route!.components.some((id) =>
        ["research_synthesis", "source_ranking"].includes(id),
      ),
      hasCitationChecker: route!.components.includes("citation_checker"),
      isMultiStep: route!.components.length > 3,
      isSimpleWorkflow: route!.components.length <= 3,
    });

    const findings: ReviewFinding[] = graphRules.flatMap((r) => r(testCtx));
    const untestedCount = route!.untested_edges.length;
    const untestedFindings = findings.filter((f) => f.entity_ref?.entity_type === "edge");
    expect(untestedFindings.length).toBe(untestedCount);
  });

  it("flags missing required dependency when edge.relation=requires is violated", () => {
    const requiresEdge = registry.edges.find((e) => e.relation === "requires");
    if (!requiresEdge) return;

    const testCtx = ctx({
      componentIds: [requiresEdge.from], // from is present, to is missing
      resolvedEdges: registry.edges.filter(
        (e) => e.from === requiresEdge.from || e.to === requiresEdge.from,
      ),
    });

    const findings: ReviewFinding[] = graphRules.flatMap((r) => r(testCtx));
    expect(findings.some((f) => f.severity === "high" && f.category === "graph")).toBe(true);
  });
});

describe("review_workflow_design — matches known playbooks", () => {
  it("detects data_extraction_enrichment for data scraping workflow", () => {
    const ids = new Set(["data_scraper", "data_normalizer", "deduplication", "schema_validation"]);
    const overlaps = findOverlappingPlaybooks(ids, registry.playbooks, 0.4);
    const matched = overlaps.map((o) => o.playbook_id);
    expect(matched).toContain("data_extraction_enrichment");
  });

  it("detects research_agent_citations for research workflow", () => {
    const ids = new Set(["source_retrieval", "source_ranking", "research_synthesis"]);
    const overlaps = findOverlappingPlaybooks(ids, registry.playbooks, 0.4);
    const matched = overlaps.map((o) => o.playbook_id);
    expect(matched).toContain("research_agent_citations");
  });
});

describe("review_workflow_design — status derivation", () => {
  it("pass → no findings", () => {
    expect(deriveStatus(0, [])).toBe("pass");
  });

  it("warnings → only low/medium findings", () => {
    const findings: ReviewFinding[] = [
      { severity: "low", category: "eval", message: "", reason: "", recommended_fix: "" },
      { severity: "medium", category: "state", message: "", reason: "", recommended_fix: "" },
    ];
    expect(deriveStatus(calculateRiskScore(findings), findings)).toBe("warnings");
  });

  it("fail → any high finding", () => {
    const findings: ReviewFinding[] = [
      { severity: "high", category: "architecture", message: "", reason: "", recommended_fix: "" },
    ];
    expect(deriveStatus(calculateRiskScore(findings), findings)).toBe("fail");
  });

  it("fail → risk_score >= 50 (two criticals)", () => {
    const findings: ReviewFinding[] = [
      { severity: "critical", category: "approval_gate", message: "1", reason: "", recommended_fix: "" },
      { severity: "critical", category: "approval_gate", message: "2", reason: "", recommended_fix: "" },
    ];
    const score = calculateRiskScore(findings);
    expect(score).toBe(50);
    expect(deriveStatus(score, findings)).toBe("fail");
  });
});

describe("review_workflow_design — ALL_RULES collection", () => {
  it("has at least 15 rules total", () => {
    expect(ALL_RULES.length).toBeGreaterThanOrEqual(15);
  });

  it("runs all rules without throwing on empty context", () => {
    const testCtx = ctx();
    expect(() => ALL_RULES.flatMap((r) => r(testCtx))).not.toThrow();
  });

  it("runs all rules without throwing on fully populated context", () => {
    const route = registry.routes[0];
    const testCtx = ctx({
      goal: "complex workflow with all features",
      componentIds: route?.components ?? [],
      resolvedComponents: registry.components.slice(0, 5),
      resolvedEdges: registry.edges.slice(0, 10),
      resolvedRoute: route,
      agents: [{ name: "agent1", responsibility: "does everything", tools: [] }],
      userTools: [{ name: "send_email", description: "Sends email notifications to users", permissions: ["write:email"], side_effects: ["sends email"] }],
      integrations: ["email", "calendar"],
      hasExternalWrite: true,
      hasResearch: true,
      hasDataScraper: true,
      isMultiStep: true,
      isSimpleWorkflow: false,
    });
    expect(() => ALL_RULES.flatMap((r) => r(testCtx))).not.toThrow();
  });
});
