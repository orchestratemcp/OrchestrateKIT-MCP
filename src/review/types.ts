import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { Route } from "../registry/routeSchema.js";
import type { Playbook } from "../registry/playbookSchema.js";

// ---------------------------------------------------------------------------
// User-supplied tool / agent descriptors
// ---------------------------------------------------------------------------

export type UserTool = {
  name: string;
  description?: string;
  permissions?: string[];
  side_effects?: string[];
};

export type UserAgent = {
  name: string;
  responsibility: string;
  tools?: string[];
};

export type UserStateSpec = {
  has_persistent_state?: boolean;
  store?: string;
  notes?: string;
};

export type UserApprovalSpec = {
  required?: boolean;
  approval_points?: string[];
};

// ---------------------------------------------------------------------------
// Review context — passed to every rule
// ---------------------------------------------------------------------------

export type ReviewContext = {
  // From user input
  goal: string;
  workflowName: string;
  proposedArchitecture: string;
  componentIds: string[];
  agents: UserAgent[];
  userTools: UserTool[];
  integrations: string[];
  hasPersistentState: boolean;
  humanApprovalDeclared: boolean;
  humanApprovalRequired: boolean;
  riskLevel: string | undefined;

  // Resolved from registry
  resolvedComponents: Component[];
  resolvedEdges: Edge[];
  resolvedRoute: Route | undefined;
  resolvedPlaybooks: Playbook[];

  // Derived flags (pre-computed for rule convenience)
  hasExternalWrite: boolean;    // any of: external_publish, optional_email_send, calendar_write
  hasResearch: boolean;         // research_synthesis, source_ranking, source_retrieval
  hasDataScraper: boolean;
  hasSchemaValidation: boolean;
  hasCitationChecker: boolean;
  hasHumanApprovalGate: boolean; // human_approval_gate in resolved components
  hasAuditLog: boolean;
  hasRetryPolicy: boolean;
  isMultiStep: boolean;          // >3 components or >2 agents
  isSimpleWorkflow: boolean;     // <=3 components or <=2 agents
};

// ---------------------------------------------------------------------------
// Review finding — output of a single rule
// ---------------------------------------------------------------------------

export type ReviewSeverity = "low" | "medium" | "high" | "critical";
export type ReviewCategory =
  | "approval_gate"
  | "state"
  | "tool_safety"
  | "architecture"
  | "graph"
  | "eval";

export type GraphEntityRef = {
  entity_type: "component" | "edge" | "route" | "playbook";
  entity_id: string;
};

export type ReviewFinding = {
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  reason: string;
  recommended_fix: string;
  entity_ref?: GraphEntityRef;
};

// ---------------------------------------------------------------------------
// Rule type
// ---------------------------------------------------------------------------

export type ReviewRule = (ctx: ReviewContext) => ReviewFinding[];

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

const SEVERITY_SCORES: Record<ReviewSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

export function calculateRiskScore(findings: ReviewFinding[]): number {
  const raw = findings.reduce((sum, f) => sum + SEVERITY_SCORES[f.severity], 0);
  return Math.min(raw, 100);
}

export function deriveStatus(
  riskScore: number,
  findings: ReviewFinding[],
): "pass" | "warnings" | "fail" {
  const hasBlocking = findings.some(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  if (riskScore >= 50 || hasBlocking) return "fail";
  if (riskScore > 0) return "warnings";
  return "pass";
}
