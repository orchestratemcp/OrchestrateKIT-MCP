import { describe, it, expect } from "vitest";
import {
  computeRouteValidation,
  confidenceLabelFromScore,
  formatScoreBreakdownMarkdown,
} from "../../src/graph/routeValidationStatus.js";

const emptyBreakdown = {
  capability_coverage: 20,
  tested_edge_score: 5,
  safety_score: 20,
  simplicity_score: 15,
  source_confidence: 0,
  risk_penalty: 0,
  untested_edge_penalty: -4,
  complexity_penalty: 0,
};

describe("confidenceLabelFromScore", () => {
  it("maps >=0.7 to high", () => {
    expect(confidenceLabelFromScore(0.75)).toBe("high");
  });
  it("maps 0.5-0.69 to medium", () => {
    expect(confidenceLabelFromScore(0.6)).toBe("medium");
  });
  it("maps <0.5 to low", () => {
    expect(confidenceLabelFromScore(0.4)).toBe("low");
  });
});

describe("computeRouteValidation", () => {
  it("returns validated when playbook-first", () => {
    const r = computeRouteValidation({
      isPlaybookFirst: true,
      playbookId: "email_calendar_assistant",
      hasCriticalAvoidViolation: false,
      missing_capabilities: [],
      untestedCriticalEdges: [],
      compose_noise: [],
      avoid_when_violations: [],
      missingSafetyGates: false,
      confidence: 0.85,
      route_score: 85,
      breakdown: emptyBreakdown,
    });
    expect(r.route_status).toBe("validated");
    expect(r.why_not_validated).toContain("email_calendar_assistant");
  });

  it("returns blocked_candidate with non-empty why when critical avoid_when", () => {
    const r = computeRouteValidation({
      isPlaybookFirst: false,
      hasCriticalAvoidViolation: true,
      missing_capabilities: [],
      untestedCriticalEdges: [],
      compose_noise: [],
      avoid_when_violations: [
        {
          from: "data_scraper",
          to: "external_publish",
          severity: "critical",
          edge_id: "data_scraper__avoid__external_publish",
          reason: "ETL scrapers must not publish raw data externally",
        },
      ],
      missingSafetyGates: false,
      confidence: 0.6,
      route_score: 60,
      breakdown: emptyBreakdown,
    });
    expect(r.route_status).toBe("blocked_candidate");
    expect(r.blocking_gaps.some((g) => g.includes("Critical avoid_when"))).toBe(true);
    expect(r.why_not_validated.length).toBeGreaterThan(0);
  });

  it("candidate always has non-empty why_not_validated", () => {
    const r = computeRouteValidation({
      isPlaybookFirst: false,
      hasCriticalAvoidViolation: false,
      missing_capabilities: ["crm_write"],
      untestedCriticalEdges: [],
      compose_noise: [],
      avoid_when_violations: [],
      missingSafetyGates: false,
      confidence: 0.55,
      route_score: 55,
      breakdown: emptyBreakdown,
    });
    expect(r.route_status).toBe("candidate");
    expect(r.why_not_validated.length).toBeGreaterThan(0);
    expect(r.blocking_gaps.some((g) => g.includes("crm_write"))).toBe(true);
  });
});

describe("formatScoreBreakdownMarkdown", () => {
  it("includes total route score", () => {
    const md = formatScoreBreakdownMarkdown(emptyBreakdown, 56);
    expect(md).toContain("Score breakdown");
    expect(md).toContain("56/100");
  });
});
