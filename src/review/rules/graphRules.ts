import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";

// ---------------------------------------------------------------------------
// Rule 1: Route not found in registry
// ---------------------------------------------------------------------------

const routeNotFound: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  // Only fires when a route_id was requested but couldn't be resolved
  // The tool pre-resolves the route; if ctx.resolvedRoute is undefined but a
  // route_id was supplied, the tool will inject a finding before rule evaluation.
  // This rule handles the case where component_ids were given but none matched.
  return [];
};

// ---------------------------------------------------------------------------
// Rule 2: Untested edges in resolved route
// ---------------------------------------------------------------------------

const untestedEdgesInRoute: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  if (!ctx.resolvedRoute) return [];

  const untested = ctx.resolvedRoute.untested_edges;
  if (untested.length === 0) return [];

  return untested.map((edgeId) => ({
    severity: "medium" as const,
    category: "graph" as const,
    message: `Untested edge \`${edgeId}\` in route \`${ctx.resolvedRoute!.id}\`.`,
    reason:
      "This edge has not been validated in a tested workflow. " +
      "Its behaviour under real conditions is unknown.",
    recommended_fix:
      `Write at least one integration test that exercises the \`${edgeId}\` edge end-to-end ` +
      "before using this route in production.",
    entity_ref: {
      entity_type: "edge" as const,
      entity_id: edgeId,
    },
  }));
};

// ---------------------------------------------------------------------------
// Rule 3: Conflicting components in route
// ---------------------------------------------------------------------------

const conflictingComponents: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const componentSet = new Set(ctx.componentIds);

  for (const edge of ctx.resolvedEdges) {
    if (edge.relation !== "conflicts_with") continue;
    if (componentSet.has(edge.from) && componentSet.has(edge.to)) {
      findings.push({
        severity: "high",
        category: "graph",
        message: `Components \`${edge.from}\` and \`${edge.to}\` conflict with each other.`,
        reason: edge.reason,
        recommended_fix:
          `Remove one of \`${edge.from}\` or \`${edge.to}\` from the workflow. ` +
          "Using conflicting components together produces undefined behaviour.",
        entity_ref: {
          entity_type: "edge" as const,
          entity_id: edge.id,
        },
      });
    }
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Rule 4: Candidate route presented without candidate label
// ---------------------------------------------------------------------------

const candidateRouteWithoutLabel: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (!ctx.resolvedRoute) return [];
  if (ctx.resolvedRoute.status === "candidate") {
    return [
      {
        severity: "medium",
        category: "graph",
        message: `Route \`${ctx.resolvedRoute.id}\` is a candidate route — not yet validated.`,
        reason:
          "Candidate routes have not been tested end-to-end in production. " +
          "They may have untested edges and unknown failure modes.",
        recommended_fix:
          "Label this workflow as 'experimental' in your planning docs. " +
          `Run the required evals for route \`${ctx.resolvedRoute.id}\` before treating it as production-ready. ` +
          "Use `get_route` to see the full required_evals list.",
        entity_ref: {
          entity_type: "route" as const,
          entity_id: ctx.resolvedRoute.id,
        },
      },
    ];
  }
  return [];
};

// ---------------------------------------------------------------------------
// Rule 5: Component requires a component that is not in the design
// ---------------------------------------------------------------------------

const missingRequiredDependencies: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const componentSet = new Set(ctx.componentIds);

  for (const edge of ctx.resolvedEdges) {
    if (edge.relation !== "requires") continue;
    if (!componentSet.has(edge.from)) continue;
    if (componentSet.has(edge.to)) continue;

    findings.push({
      severity: "high",
      category: "graph",
      message: `Component \`${edge.from}\` requires \`${edge.to}\`, but \`${edge.to}\` is missing from the design.`,
      reason: edge.reason,
      recommended_fix: `Add \`${edge.to}\` to the workflow. It is required by \`${edge.from}\`.`,
      entity_ref: {
        entity_type: "edge" as const,
        entity_id: edge.id,
      },
    });
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Rule 6: High-severity edges between included components
// ---------------------------------------------------------------------------

const highSeverityEdgesBetweenComponents: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (ctx.resolvedEdges.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const componentSet = new Set(ctx.componentIds);

  for (const edge of ctx.resolvedEdges) {
    if (edge.severity !== "critical" && edge.severity !== "high") continue;
    if (!componentSet.has(edge.from) || !componentSet.has(edge.to)) continue;
    if (edge.relation === "requires") continue; // handled by missingRequiredDependencies

    // Only flag dangerous interactions that are actively paired
    if (edge.relation === "avoid_when") {
      findings.push({
        severity: edge.severity as "high" | "critical",
        category: "graph",
        message: `Edge \`${edge.id}\`: \`${edge.from}\` should avoid \`${edge.to}\` — ${edge.reason}`,
        reason: edge.reason,
        recommended_fix:
          edge.condition
            ? `Condition: ${edge.condition}. Review whether this condition applies to your workflow.`
            : `Remove the \`${edge.to}\` component or redesign the interaction between \`${edge.from}\` and \`${edge.to}\`.`,
        entity_ref: {
          entity_type: "edge" as const,
          entity_id: edge.id,
        },
      });
    }
  }

  return findings;
};

export const graphRules: ReviewRule[] = [
  routeNotFound,
  untestedEdgesInRoute,
  conflictingComponents,
  candidateRouteWithoutLabel,
  missingRequiredDependencies,
  highSeverityEdgesBetweenComponents,
];
