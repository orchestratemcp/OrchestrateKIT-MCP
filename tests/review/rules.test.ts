import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { approvalGateRules } from "../../src/review/rules/approvalGateRules.js";
import { stateRules } from "../../src/review/rules/stateRules.js";
import { toolSafetyRules } from "../../src/review/rules/toolSafetyRules.js";
import { architectureRules } from "../../src/review/rules/architectureRules.js";
import { graphRules } from "../../src/review/rules/graphRules.js";
import { credentialRules } from "../../src/review/rules/credentialRules.js";
import { calculateRiskScore, deriveStatus, type ReviewContext } from "../../src/review/types.js";

const registry = loadRegistry({ includeBeta: true });

// ---------------------------------------------------------------------------
// Context builder helper
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
// calculateRiskScore + deriveStatus
// ---------------------------------------------------------------------------

describe("calculateRiskScore", () => {
  it("returns 0 for no findings", () => {
    expect(calculateRiskScore([])).toBe(0);
  });

  it("adds 25 for critical findings", () => {
    expect(calculateRiskScore([{ severity: "critical", category: "approval_gate", message: "", reason: "", recommended_fix: "" }])).toBe(25);
  });

  it("caps at 100", () => {
    const findings = Array.from({ length: 10 }, () => ({
      severity: "critical" as const,
      category: "approval_gate" as const,
      message: "",
      reason: "",
      recommended_fix: "",
    }));
    expect(calculateRiskScore(findings)).toBe(100);
  });
});

describe("deriveStatus", () => {
  it("returns pass for score 0, no findings", () => {
    expect(deriveStatus(0, [])).toBe("pass");
  });

  it("returns fail for any critical finding", () => {
    const findings = [{ severity: "critical" as const, category: "approval_gate" as const, message: "", reason: "", recommended_fix: "" }];
    expect(deriveStatus(25, findings)).toBe("fail");
  });

  it("returns fail for any high finding", () => {
    const findings = [{ severity: "high" as const, category: "architecture" as const, message: "", reason: "", recommended_fix: "" }];
    expect(deriveStatus(15, findings)).toBe("fail");
  });

  it("returns warnings for medium findings below threshold", () => {
    const findings = [{ severity: "medium" as const, category: "state" as const, message: "", reason: "", recommended_fix: "" }];
    expect(deriveStatus(8, findings)).toBe("warnings");
  });
});

// ---------------------------------------------------------------------------
// approvalGateRules
// ---------------------------------------------------------------------------

describe("approvalGateRules — external write without approval", () => {
  it("fires critical when goal mentions publish and no approval gate", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(ctx({ goal: "publish blog posts to social media", hasExternalWrite: false })),
    );
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("fires critical when hasExternalWrite and no approval gate", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(ctx({ hasExternalWrite: true, hasHumanApprovalGate: false })),
    );
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("does NOT fire when hasHumanApprovalGate is true", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(ctx({ hasExternalWrite: true, hasHumanApprovalGate: true, humanApprovalRequired: true })),
    );
    const criticalApproval = findings.filter(
      (f) => f.category === "approval_gate" && f.severity === "critical",
    );
    expect(criticalApproval).toHaveLength(0);
  });

  it("fires critical when human_approval.required=false with external write", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(
        ctx({
          hasExternalWrite: true,
          humanApprovalDeclared: true,
          humanApprovalRequired: false,
        }),
      ),
    );
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("fires high when risk_level=critical and no approval gate", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(ctx({ riskLevel: "critical", hasHumanApprovalGate: false })),
    );
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("fires when integration is 'email'", () => {
    const findings = approvalGateRules.flatMap((r) =>
      r(ctx({ integrations: ["email"], hasExternalWrite: false, goal: "send notifications" })),
    );
    expect(findings.some((f) => f.category === "approval_gate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stateRules
// ---------------------------------------------------------------------------

describe("stateRules — multi-step without state", () => {
  it("fires medium for multi-step workflow without persistent state", () => {
    const findings = stateRules.flatMap((r) =>
      r(ctx({ isMultiStep: true, hasPersistentState: false })),
    );
    expect(findings.some((f) => f.severity === "medium" && f.category === "state")).toBe(true);
  });

  it("does NOT fire when hasPersistentState is true", () => {
    const findings = stateRules.flatMap((r) =>
      r(ctx({ isMultiStep: true, hasPersistentState: true })),
    );
    const stateIssue = findings.find(
      (f) => f.message.includes("persistent state"),
    );
    expect(stateIssue).toBeUndefined();
  });

  it("fires medium for external call without retry policy", () => {
    const findings = stateRules.flatMap((r) =>
      r(
        ctx({
          hasExternalWrite: true,
          hasRetryPolicy: false,
          integrations: ["email"],
        }),
      ),
    );
    expect(findings.some((f) => f.message.toLowerCase().includes("retry"))).toBe(true);
  });

  it("does NOT fire retry rule when hasRetryPolicy is true", () => {
    const findings = stateRules.flatMap((r) =>
      r(ctx({ hasExternalWrite: true, hasRetryPolicy: true })),
    );
    const retryIssue = findings.find((f) => f.message.includes("retry"));
    expect(retryIssue).toBeUndefined();
  });

  it("fires low for missing audit log for sensitive actions", () => {
    const findings = stateRules.flatMap((r) =>
      r(ctx({ hasExternalWrite: true, hasAuditLog: false })),
    );
    expect(findings.some((f) => f.message.toLowerCase().includes("audit"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toolSafetyRules
// ---------------------------------------------------------------------------

describe("toolSafetyRules", () => {
  it("fires low for tool with no description", () => {
    const findings = toolSafetyRules.flatMap((r) =>
      r(ctx({ userTools: [{ name: "my_tool", permissions: [], side_effects: [] }] })),
    );
    expect(findings.some((f) => f.message.includes("no description"))).toBe(true);
  });

  it("fires low for tool with very short description", () => {
    const findings = toolSafetyRules.flatMap((r) =>
      r(ctx({ userTools: [{ name: "my_tool", description: "short", permissions: [], side_effects: [] }] })),
    );
    expect(findings.some((f) => f.message.includes("short description"))).toBe(true);
  });

  it("does NOT fire for tool with adequate description", () => {
    const findings = toolSafetyRules.flatMap((r) =>
      r(
        ctx({
          userTools: [
            {
              name: "my_tool",
              description: "This tool reads emails and classifies their intent.",
              permissions: [],
              side_effects: [],
            },
          ],
        }),
      ),
    );
    const descIssue = findings.find((f) => f.message.includes("description"));
    expect(descIssue).toBeUndefined();
  });

  it("fires medium for write tool without permissions", () => {
    const findings = toolSafetyRules.flatMap((r) =>
      r(
        ctx({
          userTools: [
            {
              name: "send_email_tool",
              description: "Sends an email to the user",
              permissions: [],
              side_effects: ["sends email"],
            },
          ],
        }),
      ),
    );
    expect(findings.some((f) => f.severity === "medium" && f.message.includes("permissions"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// architectureRules
// ---------------------------------------------------------------------------

describe("architectureRules", () => {
  it("fires medium when >2 agents for simple workflow", () => {
    const findings = architectureRules.flatMap((r) =>
      r(
        ctx({
          agents: [
            { name: "a1", responsibility: "does stuff", tools: [] },
            { name: "a2", responsibility: "does more", tools: [] },
            { name: "a3", responsibility: "also stuff", tools: [] },
          ],
          componentIds: ["data_scraper", "schema_validation"],
          isMultiStep: false,
          isSimpleWorkflow: true,
        }),
      ),
    );
    expect(findings.some((f) => f.severity === "medium" && f.category === "architecture")).toBe(true);
  });

  it("fires low for missing eval coverage", () => {
    const findings = architectureRules.flatMap((r) =>
      r(ctx({ goal: "scrape and process data" })),
    );
    expect(findings.some((f) => f.category === "eval")).toBe(true);
  });

  it("does NOT fire eval warning when goal mentions tests", () => {
    const findings = architectureRules.flatMap((r) =>
      r(ctx({ goal: "scrape data with eval fixtures and test coverage" })),
    );
    const evalIssue = findings.find((f) => f.category === "eval");
    expect(evalIssue).toBeUndefined();
  });

  it("fires high for research without citation checker", () => {
    const findings = architectureRules.flatMap((r) =>
      r(
        ctx({
          hasResearch: true,
          hasCitationChecker: false,
          componentIds: ["research_synthesis"],
        }),
      ),
    );
    expect(findings.some((f) => f.severity === "high" && f.message.includes("citation"))).toBe(true);
  });

  it("does NOT fire citation warning when hasCitationChecker is true", () => {
    const findings = architectureRules.flatMap((r) =>
      r(ctx({ hasResearch: true, hasCitationChecker: true })),
    );
    const citationIssue = findings.find((f) => f.message.includes("citation"));
    expect(citationIssue).toBeUndefined();
  });

  it("fires high for data_scraper without schema_validation", () => {
    const findings = architectureRules.flatMap((r) =>
      r(ctx({ hasDataScraper: true, hasSchemaValidation: false })),
    );
    expect(findings.some((f) => f.severity === "high" && f.message.includes("schema_validation"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// graphRules
// ---------------------------------------------------------------------------

describe("graphRules — candidate route", () => {
  it("fires medium when route status is candidate", () => {
    const candidateRoute = registry.routes.find((r) => r.status === "candidate");
    if (!candidateRoute) return; // skip if none in registry

    const findings = graphRules.flatMap((r) =>
      r(ctx({ resolvedRoute: candidateRoute, componentIds: candidateRoute.components })),
    );
    expect(findings.some((f) => f.severity === "medium" && f.category === "graph")).toBe(true);
  });
});

describe("graphRules — untested edges in route", () => {
  it("fires medium for each untested edge", () => {
    const routeWithUntested = registry.routes.find((r) => r.untested_edges.length > 0);
    if (!routeWithUntested) return; // skip if none

    const findings = graphRules.flatMap((r) =>
      r(ctx({ resolvedRoute: routeWithUntested })),
    );
    const untestedFindings = findings.filter(
      (f) => f.entity_ref?.entity_type === "edge" && f.severity === "medium",
    );
    expect(untestedFindings.length).toBe(routeWithUntested.untested_edges.length);
  });
});

describe("graphRules — missing required dependencies", () => {
  it("fires high for component with requires edge where dependency is absent", () => {
    // Find a requires edge in registry and simulate having from but not to
    const requiresEdge = registry.edges.find((e) => e.relation === "requires");
    if (!requiresEdge) return;

    const resolvedEdges = registry.edges.filter(
      (e) => e.from === requiresEdge.from || e.to === requiresEdge.from,
    );

    const findings = graphRules.flatMap((r) =>
      r(
        ctx({
          componentIds: [requiresEdge.from],
          resolvedEdges,
        }),
      ),
    );
    // Should fire because requiresEdge.to is not in componentIds
    expect(findings.some((f) => f.severity === "high" && f.category === "graph")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MAR-117 — credentialRules
// ---------------------------------------------------------------------------

describe("credentialRules — external integration without credential path", () => {
  it("fires a medium finding for an external write with no auth_failure_handler", () => {
    const findings = credentialRules.flatMap((r) =>
      r(ctx({ componentIds: ["external_publish", "human_approval_gate"] })),
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("medium");
    expect(findings[0]!.category).toBe("tool_safety");
    expect(findings[0]!.recommended_fix).toContain("auth_failure_handler");
    expect(findings[0]!.recommended_fix).toContain("secret manager");
  });

  it("does NOT fire when auth_failure_handler is present", () => {
    const findings = credentialRules.flatMap((r) =>
      r(ctx({
        componentIds: ["external_publish", "auth_failure_handler"],
        hasAuthFailureHandler: true,
      })),
    );
    expect(findings.length).toBe(0);
  });

  it("fires for data_scraper (credentialed read-side pull)", () => {
    const findings = credentialRules.flatMap((r) =>
      r(ctx({ componentIds: ["data_scraper", "data_normalizer"] })),
    );
    expect(findings.length).toBe(1);
  });

  it("does NOT fire for a purely internal route", () => {
    const findings = credentialRules.flatMap((r) =>
      r(ctx({ componentIds: ["deduplication", "schema_validation"] })),
    );
    expect(findings.length).toBe(0);
  });

  it("is a warning, not blocking — does not push status to fail on its own", () => {
    const findings = credentialRules.flatMap((r) =>
      r(ctx({ componentIds: ["calendar_write"] })),
    );
    const score = calculateRiskScore(findings);
    expect(deriveStatus(score, findings)).toBe("warnings");
  });
});
