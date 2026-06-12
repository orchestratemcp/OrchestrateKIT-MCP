import { describe, it, expect } from "vitest";
import {
  ComponentSchema,
  MODEL_TIERS,
  CONTEXT_NEEDS,
  COMPRESSION_STRATEGIES,
} from "../../src/registry/componentSchema.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

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

describe("ComponentSchema — MAR-116: model-tier metadata", () => {
  it("defaults model_tier to none", () => {
    const r = ComponentSchema.safeParse(validComponent);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model_tier).toBe("none");
  });

  it("defaults fallback_tier to none", () => {
    const r = ComponentSchema.safeParse(validComponent);
    if (!r.success) return;
    expect(r.data.fallback_tier).toBe("none");
  });

  it("defaults context_need to minimal", () => {
    const r = ComponentSchema.safeParse(validComponent);
    if (!r.success) return;
    expect(r.data.context_need).toBe("minimal");
  });

  it("defaults compression_strategy to none", () => {
    const r = ComponentSchema.safeParse(validComponent);
    if (!r.success) return;
    expect(r.data.compression_strategy).toBe("none");
  });

  it("accepts all valid model_tier values", () => {
    for (const model_tier of MODEL_TIERS) {
      const r = ComponentSchema.safeParse({ ...validComponent, model_tier });
      expect(r.success, `model_tier=${model_tier}`).toBe(true);
    }
  });

  it("accepts all valid context_need values", () => {
    for (const context_need of CONTEXT_NEEDS) {
      const r = ComponentSchema.safeParse({ ...validComponent, context_need });
      expect(r.success, `context_need=${context_need}`).toBe(true);
    }
  });

  it("accepts all valid compression_strategy values", () => {
    for (const compression_strategy of COMPRESSION_STRATEGIES) {
      const r = ComponentSchema.safeParse({ ...validComponent, compression_strategy });
      expect(r.success, `compression_strategy=${compression_strategy}`).toBe(true);
    }
  });

  it("rejects invalid model_tier value", () => {
    const r = ComponentSchema.safeParse({ ...validComponent, model_tier: "turbo" });
    expect(r.success).toBe(false);
  });

  it("production registry: every component has valid model-tier fields", () => {
    const { components } = loadRegistry();
    for (const c of components) {
      expect(MODEL_TIERS as readonly string[], `${c.id} model_tier`).toContain(c.model_tier);
      expect(CONTEXT_NEEDS as readonly string[], `${c.id} context_need`).toContain(c.context_need);
      expect(COMPRESSION_STRATEGIES as readonly string[], `${c.id} compression_strategy`).toContain(c.compression_strategy);
    }
  });
});
