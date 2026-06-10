import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { RouteOverlapResult } from "./playbookOverlap.js";

export type ScoreBreakdown = {
  capability_coverage: number;
  tested_edge_score: number;
  safety_score: number;
  simplicity_score: number;
  source_confidence: number;
  risk_penalty: number;
  untested_edge_penalty: number;
  complexity_penalty: number;
};

export type RouteScore = {
  route_score: number;
  confidence: number;
  breakdown: ScoreBreakdown;
};

export type ScoringInput = {
  /** Components in the candidate route */
  components: Component[];
  /** Edges within the route */
  internalEdges: Edge[];
  /** Number of capability hints matched */
  matchedCapabilities: number;
  /** Number of capability hints requested (from must_have + goal) */
  requestedCapabilities: number;
  /** Whether all required approval gates are present */
  safetyGatesCovered: boolean;
  /** Number of required safety gates that are missing */
  missingSafetyGates: number;
  /** Overlapping known routes */
  routeOverlaps: RouteOverlapResult[];
};

/**
 * Produces a deterministic route score in the range [0, 100] (integer)
 * and a confidence in [0.0, 1.0].
 *
 * Score breakdown weights:
 *   capability_coverage  max +25   matched / requested
 *   tested_edge_score    max +15   tested edges / total edges
 *   safety_score         max +20   gates present when needed
 *   simplicity_score     max +15   penalise large routes
 *   source_confidence    max +15   avg confidence of overlapping known routes
 *   risk_penalty         max -15   for high/critical components
 *   untested_edge_penalty max -10  for edges with tested=false
 *   complexity_penalty   max -10   for routes with >8 components
 */
export function scoreRoute(input: ScoringInput): RouteScore {
  const {
    components,
    internalEdges,
    matchedCapabilities,
    requestedCapabilities,
    safetyGatesCovered,
    missingSafetyGates,
    routeOverlaps,
  } = input;

  // --- Positive scores ---

  const capability_coverage =
    requestedCapabilities > 0
      ? Math.min(25, Math.round((matchedCapabilities / requestedCapabilities) * 25))
      : 20;

  const testedEdges = internalEdges.filter((e) => e.tested).length;
  const tested_edge_score =
    internalEdges.length > 0
      ? Math.round((testedEdges / internalEdges.length) * 15)
      : 5;

  const safety_score =
    missingSafetyGates === 0
      ? safetyGatesCovered
        ? 20
        : 15
      : Math.max(0, 20 - missingSafetyGates * 7);

  const n = components.length;
  const simplicity_score = n <= 4 ? 15 : n <= 6 ? 13 : n <= 8 ? 10 : n <= 10 ? 7 : 4;

  const avgConfidence =
    routeOverlaps.length > 0
      ? routeOverlaps.reduce((sum, r) => sum + r.overlap_fraction, 0) /
        routeOverlaps.length
      : 0;
  const source_confidence = Math.round(avgConfidence * 15);

  // --- Penalties ---

  const highRiskCount = components.filter(
    (c) => c.risk_level === "high" || c.risk_level === "critical",
  ).length;
  const risk_penalty = -Math.min(15, highRiskCount * 3);

  const untestedEdges = internalEdges.filter((e) => !e.tested).length;
  const untested_edge_penalty = -Math.min(10, untestedEdges * 2);

  const complexity_penalty = n > 8 ? -Math.min(10, (n - 8) * 2) : 0;

  const raw =
    capability_coverage +
    tested_edge_score +
    safety_score +
    simplicity_score +
    source_confidence +
    risk_penalty +
    untested_edge_penalty +
    complexity_penalty;

  const route_score = Math.max(0, Math.min(100, raw));
  const confidence = Math.round((route_score / 100) * 100) / 100;

  return {
    route_score,
    confidence,
    breakdown: {
      capability_coverage,
      tested_edge_score,
      safety_score,
      simplicity_score,
      source_confidence,
      risk_penalty,
      untested_edge_penalty,
      complexity_penalty,
    },
  };
}
