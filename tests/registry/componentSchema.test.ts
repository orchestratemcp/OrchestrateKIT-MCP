import { describe, it, expect } from "vitest";
import { ComponentSchema } from "../../src/registry/componentSchema.js";

const validComponent = {
  id: "source_retrieval",
  name: "Source Retrieval",
  status: "published",
  category: "input",
  summary: "Fetches documents based on a query.",
  risk_level: "low",
};

describe("ComponentSchema", () => {
  it("accepts a minimal valid component", () => {
    const result = ComponentSchema.safeParse(validComponent);
    expect(result.success).toBe(true);
  });

  it("infers default arrays as empty", () => {
    const result = ComponentSchema.safeParse(validComponent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.capabilities).toEqual([]);
    expect(result.data.requires).toEqual([]);
    expect(result.data.sources).toEqual([]);
  });

  it("rejects missing required field: id", () => {
    const result = ComponentSchema.safeParse({ ...validComponent, id: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = ComponentSchema.safeParse({ ...validComponent, status: "active" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category value", () => {
    const result = ComponentSchema.safeParse({ ...validComponent, category: "unknown_cat" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid risk_level value", () => {
    const result = ComponentSchema.safeParse({ ...validComponent, risk_level: "extreme" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["draft", "beta", "validated", "published", "deprecated"] as const) {
      const r = ComponentSchema.safeParse({ ...validComponent, status });
      expect(r.success, `status=${status}`).toBe(true);
    }
  });

  it("accepts all valid categories", () => {
    const categories = ["input", "processing", "state", "safety", "tool", "output", "eval", "orchestration", "integration"] as const;
    for (const category of categories) {
      const r = ComponentSchema.safeParse({ ...validComponent, category });
      expect(r.success, `category=${category}`).toBe(true);
    }
  });
});
