import { describe, it, expect } from "vitest";
import { EdgeSchema } from "../../src/registry/edgeSchema.js";

const validEdge = {
  id: "a__requires__b",
  from: "component_a",
  to: "component_b",
  relation: "requires",
  status: "published",
  reason: "Component A requires B to process its output.",
  severity: "medium",
};

describe("EdgeSchema", () => {
  it("accepts a minimal valid edge", () => {
    const result = EdgeSchema.safeParse(validEdge);
    expect(result.success).toBe(true);
  });

  it("defaults tested to false", () => {
    const result = EdgeSchema.safeParse(validEdge);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tested).toBe(false);
  });

  it("defaults condition to empty string", () => {
    const result = EdgeSchema.safeParse(validEdge);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.condition).toBe("");
  });

  it("rejects missing required field: from", () => {
    const result = EdgeSchema.safeParse({ ...validEdge, from: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects invalid relation value", () => {
    const result = EdgeSchema.safeParse({ ...validEdge, relation: "breaks" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid relations", () => {
    const relations = [
      "requires", "compatible_with", "conflicts_with", "alternative_to",
      "safer_with", "tested_with", "produces_input_for", "consumes_output_from",
      "must_run_before", "can_run_parallel", "requires_human_approval_when",
      "recommended_for", "avoid_when",
    ] as const;
    for (const relation of relations) {
      const r = EdgeSchema.safeParse({ ...validEdge, relation });
      expect(r.success, `relation=${relation}`).toBe(true);
    }
  });
});
