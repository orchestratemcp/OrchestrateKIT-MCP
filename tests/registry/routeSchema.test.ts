import { describe, it, expect } from "vitest";
import { RouteSchema } from "../../src/registry/routeSchema.js";

const validRoute = {
  id: "research_route_v1",
  name: "Research Route v1",
  status: "published",
  summary: "Basic research workflow.",
  risk_level: "low",
  confidence: 0.9,
};

describe("RouteSchema", () => {
  it("accepts a minimal valid route", () => {
    const result = RouteSchema.safeParse(validRoute);
    expect(result.success).toBe(true);
  });

  it("rejects confidence outside 0–1", () => {
    expect(RouteSchema.safeParse({ ...validRoute, confidence: 1.5 }).success).toBe(false);
    expect(RouteSchema.safeParse({ ...validRoute, confidence: -0.1 }).success).toBe(false);
  });

  it("accepts confidence of exactly 0 and 1", () => {
    expect(RouteSchema.safeParse({ ...validRoute, confidence: 0 }).success).toBe(true);
    expect(RouteSchema.safeParse({ ...validRoute, confidence: 1 }).success).toBe(true);
  });

  it("rejects invalid status (route uses candidate not draft)", () => {
    const result = RouteSchema.safeParse({ ...validRoute, status: "draft" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid route statuses", () => {
    for (const status of ["candidate", "beta", "validated", "published", "deprecated"] as const) {
      const r = RouteSchema.safeParse({ ...validRoute, status });
      expect(r.success, `status=${status}`).toBe(true);
    }
  });

  it("defaults arrays to empty", () => {
    const result = RouteSchema.safeParse(validRoute);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.components).toEqual([]);
    expect(result.data.edges).toEqual([]);
    expect(result.data.warnings).toEqual([]);
  });
});
