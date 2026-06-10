import { describe, it, expect } from "vitest";
import { scoreRoute, type ScoringInput } from "../../src/graph/routeScoring.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const { components, edges } = loadRegistry();

function makeScoringInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    components: components.slice(0, 4),
    internalEdges: [],
    matchedCapabilities: 3,
    requestedCapabilities: 4,
    safetyGatesCovered: true,
    missingSafetyGates: 0,
    routeOverlaps: [],
    ...overrides,
  };
}

describe("scoreRoute", () => {
  it("returns route_score between 0 and 100", () => {
    const { route_score } = scoreRoute(makeScoringInput());
    expect(route_score).toBeGreaterThanOrEqual(0);
    expect(route_score).toBeLessThanOrEqual(100);
  });

  it("returns confidence between 0 and 1", () => {
    const { confidence } = scoreRoute(makeScoringInput());
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("missing safety gates reduce safety_score", () => {
    const safe = scoreRoute(makeScoringInput({ missingSafetyGates: 0, safetyGatesCovered: true }));
    const unsafe = scoreRoute(makeScoringInput({ missingSafetyGates: 2, safetyGatesCovered: false }));
    expect(safe.breakdown.safety_score).toBeGreaterThan(unsafe.breakdown.safety_score);
  });

  it("more tested edges give higher tested_edge_score", () => {
    const testedEdges = edges.filter((e) => e.tested);
    const untestedEdges = edges.filter((e) => !e.tested);

    const withTested = scoreRoute(
      makeScoringInput({ internalEdges: testedEdges.slice(0, 5) }),
    );
    const withUntested = scoreRoute(
      makeScoringInput({ internalEdges: untestedEdges.slice(0, 5) }),
    );
    expect(withTested.breakdown.tested_edge_score).toBeGreaterThanOrEqual(
      withUntested.breakdown.tested_edge_score,
    );
  });

  it("larger routes get lower simplicity_score", () => {
    const small = scoreRoute(makeScoringInput({ components: components.slice(0, 3) }));
    const large = scoreRoute(makeScoringInput({ components: components.slice(0, 11) }));
    expect(small.breakdown.simplicity_score).toBeGreaterThan(large.breakdown.simplicity_score);
  });

  it("score_breakdown sums to approximately route_score", () => {
    const { route_score, breakdown } = scoreRoute(makeScoringInput());
    const sum =
      breakdown.capability_coverage +
      breakdown.tested_edge_score +
      breakdown.safety_score +
      breakdown.simplicity_score +
      breakdown.source_confidence +
      breakdown.risk_penalty +
      breakdown.untested_edge_penalty +
      breakdown.complexity_penalty;
    expect(Math.abs(route_score - Math.max(0, Math.min(100, sum)))).toBeLessThanOrEqual(1);
  });

  it("route_overlap boosts source_confidence", () => {
    const withOverlap = scoreRoute(
      makeScoringInput({
        routeOverlaps: [{ route_id: "r1", route_name: "R1", overlap_fraction: 0.9, precision: 0.9, jaccard: 0.9, shared_components: [], extra_components: [], missing_components: [] }],
      }),
    );
    const withoutOverlap = scoreRoute(makeScoringInput({ routeOverlaps: [] }));
    expect(withOverlap.breakdown.source_confidence).toBeGreaterThan(
      withoutOverlap.breakdown.source_confidence,
    );
  });

  it("returns deterministic results for same input", () => {
    const input = makeScoringInput();
    const a = scoreRoute(input);
    const b = scoreRoute(input);
    expect(a.route_score).toBe(b.route_score);
    expect(a.confidence).toBe(b.confidence);
  });
});
