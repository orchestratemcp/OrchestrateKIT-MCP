import type { InlineEdgeSummary } from "../tools/graphToolFormatters.js";
import type { AvoidViolation } from "./routeOrdering.js";
import type { ScoreBreakdown } from "./routeScoring.js";

export type RouteStatus = "validated" | "candidate" | "blocked_candidate";

export type ConfidenceLabel = "high" | "medium" | "low";

export type RouteValidationInput = {
  isPlaybookFirst: boolean;
  playbookId?: string;
  hasCriticalAvoidViolation: boolean;
  missing_capabilities: string[];
  untestedCriticalEdges: InlineEdgeSummary[];
  compose_noise: Array<{ component_id: string; reason: string }>;
  avoid_when_violations: AvoidViolation[];
  missingSafetyGates: boolean;
  confidence: number;
  route_score: number;
  breakdown: ScoreBreakdown;
};

export type RouteValidationResult = {
  route_status: RouteStatus;
  blocking_gaps: string[];
  why_not_validated: string;
  confidence_label: ConfidenceLabel;
};

export function confidenceLabelFromScore(confidence: number): ConfidenceLabel {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

/**
 * Derive route_status, blocking_gaps, why_not_validated and confidence_label
 * from compose artifacts (MAR-93).
 */
export function computeRouteValidation(input: RouteValidationInput): RouteValidationResult {
  const blocking_gaps: string[] = [];

  if (input.missing_capabilities.length > 0) {
    for (const cap of input.missing_capabilities) {
      blocking_gaps.push(`Missing capability: ${cap} (no matching component in registry)`);
    }
  }

  if (input.untestedCriticalEdges.length > 0) {
    const ids = input.untestedCriticalEdges.map((e) => e.edge_id).join(", ");
    blocking_gaps.push(
      `${input.untestedCriticalEdges.length} untested critical edge(s): ${ids}`,
    );
  }

  for (const noise of input.compose_noise) {
    blocking_gaps.push(
      `Matcher noise: \`${noise.component_id}\` — ${noise.reason}`,
    );
  }

  for (const v of input.avoid_when_violations) {
    if (v.severity === "critical") {
      blocking_gaps.push(
        `Critical avoid_when conflict: \`${v.from}\` must not co-exist with \`${v.to}\``,
      );
    } else {
      blocking_gaps.push(
        `Domain/safety conflict: \`${v.from}\` avoid_when \`${v.to}\``,
      );
    }
  }

  if (input.missingSafetyGates) {
    blocking_gaps.push(
      "Missing required human_approval_gate for external write/send/publish action",
    );
  }

  if (input.breakdown.untested_edge_penalty < 0) {
    blocking_gaps.push(
      `Low tested-edge coverage (penalty ${input.breakdown.untested_edge_penalty})`,
    );
  }

  const confidence_label = confidenceLabelFromScore(input.confidence);

  let route_status: RouteStatus;
  let why_not_validated: string;

  if (input.hasCriticalAvoidViolation) {
    route_status = "blocked_candidate";
    const critical = input.avoid_when_violations.filter((v) => v.severity === "critical");
    why_not_validated =
      `Route is blocked by ${critical.length} critical avoid_when conflict(s). ` +
      `Remove conflicting component(s) or use a validated playbook. ` +
      (blocking_gaps.length > 0
        ? `Gaps: ${blocking_gaps.slice(0, 3).join("; ")}.`
        : "");
  } else if (input.isPlaybookFirst && input.playbookId) {
    route_status = "validated";
    why_not_validated =
      `Matched validated playbook \`${input.playbookId}\` at ≥80% recall — ` +
      `use get_playbook({ id: "${input.playbookId}" }) as primary reference; compose fills gaps only.`;
  } else {
    route_status = "candidate";
    const parts: string[] = [
      "This is a keyword-matched candidate route, not a validated playbook.",
    ];
    if (blocking_gaps.length > 0) {
      parts.push(`${blocking_gaps.length} blocking gap(s) must be resolved before treating this as production-ready.`);
    } else {
      parts.push("No critical blockers detected, but route has not been benchmark-tested.");
    }
    parts.push(`Confidence ${confidence_label} (score ${input.route_score}/100).`);
    why_not_validated = parts.join(" ");
  }

  return {
    route_status,
    blocking_gaps,
    why_not_validated,
    confidence_label,
  };
}

export function formatScoreBreakdownMarkdown(
  breakdown: ScoreBreakdown,
  route_score: number,
): string {
  const lines = [
    `### Score breakdown`,
    ``,
    `- capability_coverage: ${breakdown.capability_coverage >= 0 ? "+" : ""}${breakdown.capability_coverage}`,
    `- tested_edge_score: ${breakdown.tested_edge_score >= 0 ? "+" : ""}${breakdown.tested_edge_score}`,
    `- safety_score: ${breakdown.safety_score >= 0 ? "+" : ""}${breakdown.safety_score}`,
    `- simplicity_score: ${breakdown.simplicity_score >= 0 ? "+" : ""}${breakdown.simplicity_score}`,
    `- source_confidence: ${breakdown.source_confidence >= 0 ? "+" : ""}${breakdown.source_confidence}`,
    `- risk_penalty: ${breakdown.risk_penalty}`,
    `- untested_edge_penalty: ${breakdown.untested_edge_penalty}`,
    `- complexity_penalty: ${breakdown.complexity_penalty}`,
    `- **Total route score:** ${route_score}/100`,
  ];
  return lines.join("\n");
}
