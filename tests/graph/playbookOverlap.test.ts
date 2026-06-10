import { describe, it, expect } from "vitest";
import { findOverlappingPlaybooks } from "../../src/graph/playbookOverlap.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const { playbooks } = loadRegistry();

/**
 * Helper: build a minimal synthetic Playbook-shaped object for unit math tests
 * without hitting the registry loader.
 */
function makePb(id: string, componentIds: string[]) {
  return {
    id,
    version: "0.1.0",
    status: "published" as const,
    title: id,
    summary: id,
    workflow_type: "test",
    golden_path_route_id: "",
    components: componentIds,
    edges: [],
    stack_id: "default_orchestratekit_stack",
    risk_level: "medium" as const,
    best_for: [],
    avoid_when: [],
    recommended_architecture: undefined,
    llm_driven_steps: [],
    deterministic_steps: [],
    permissions: {},
    guardrails: [],
    failure_modes: [],
    evals: [],
    implementation_steps: [],
    sources: [],
  };
}

describe("findOverlappingPlaybooks — precision/Jaccard/extra/missing (MAR-91)", () => {
  it("computes recall, precision and jaccard correctly on a clean match", () => {
    const pb = makePb("test_pb", ["a", "b", "c", "d"]);
    const candidate = new Set(["a", "b", "c", "d"]);
    const [result] = findOverlappingPlaybooks(candidate, [pb], 0.5);
    expect(result).toBeDefined();
    expect(result!.overlap_fraction).toBe(1.0); // recall = 4/4
    expect(result!.precision).toBe(1.0); // precision = 4/4
    expect(result!.jaccard).toBe(1.0); // jaccard = 4/4
    expect(result!.extra_components).toEqual([]);
    expect(result!.missing_components).toEqual([]);
  });

  it("computes recall correctly when candidate is a strict superset (noisy route)", () => {
    const pb = makePb("test_pb", ["a", "b", "c", "d"]);
    const candidate = new Set(["a", "b", "c", "d", "noise1", "noise2", "noise3", "noise4"]);
    const [result] = findOverlappingPlaybooks(candidate, [pb], 0.5);
    expect(result).toBeDefined();
    // recall = 4/4 = 1.0
    expect(result!.overlap_fraction).toBe(1.0);
    // precision = 4/8 = 0.5
    expect(result!.precision).toBe(0.5);
    // jaccard = 4 / (4 + 8 - 4) = 4/8 = 0.5
    expect(result!.jaccard).toBe(0.5);
    expect(result!.extra_components.sort()).toEqual(["noise1", "noise2", "noise3", "noise4"]);
    expect(result!.missing_components).toEqual([]);
  });

  it("computes missing_components when candidate lacks playbook components", () => {
    const pb = makePb("test_pb", ["a", "b", "c", "d"]);
    const candidate = new Set(["a", "b"]);
    const [result] = findOverlappingPlaybooks(candidate, [pb], 0.4);
    expect(result).toBeDefined();
    expect(result!.overlap_fraction).toBe(0.5); // recall = 2/4
    expect(result!.missing_components.sort()).toEqual(["c", "d"]);
    expect(result!.extra_components).toEqual([]);
  });

  it("computes both extra and missing when candidate partially overlaps", () => {
    const pb = makePb("test_pb", ["a", "b", "c"]);
    const candidate = new Set(["a", "b", "x", "y"]);
    const [result] = findOverlappingPlaybooks(candidate, [pb], 0.5);
    expect(result).toBeDefined();
    expect(result!.overlap_fraction).toBeCloseTo(0.67, 1); // recall ≈ 2/3
    expect(result!.precision).toBe(0.5); // 2/4
    expect(result!.missing_components).toEqual(["c"]);
    expect(result!.extra_components.sort()).toEqual(["x", "y"]);
  });

  it("jaccard is always <= min(recall, precision)", () => {
    const pb = makePb("test_pb", ["a", "b", "c", "d"]);
    const candidate = new Set(["a", "b", "x"]);
    const [result] = findOverlappingPlaybooks(candidate, [pb], 0.3);
    if (result) {
      expect(result.jaccard).toBeLessThanOrEqual(result.overlap_fraction);
      expect(result.jaccard).toBeLessThanOrEqual(result.precision);
    }
  });

  it("returns no results below minOverlap threshold", () => {
    const pb = makePb("test_pb", ["a", "b", "c", "d"]);
    const candidate = new Set(["a"]); // recall = 0.25
    const results = findOverlappingPlaybooks(candidate, [pb], 0.5);
    expect(results).toHaveLength(0);
  });
});

/**
 * MAR-91 — integration tests against the real registry.
 */
describe("findOverlappingPlaybooks — real registry (MAR-91)", () => {
  it("email_calendar_assistant overlap result has all required fields", () => {
    // route that covers most of the email/calendar playbook
    const candidate = new Set([
      "email_read", "intent_classifier", "email_draft",
      "optional_email_send", "calendar_lookup", "calendar_write",
      "human_approval_gate", "audit_log",
    ]);
    const results = findOverlappingPlaybooks(candidate, playbooks, 0.5);
    const emailMatch = results.find((r) => r.playbook_id === "email_calendar_assistant");
    expect(emailMatch).toBeDefined();
    expect(typeof emailMatch!.precision).toBe("number");
    expect(typeof emailMatch!.jaccard).toBe("number");
    expect(Array.isArray(emailMatch!.extra_components)).toBe(true);
    expect(Array.isArray(emailMatch!.missing_components)).toBe(true);
    expect(emailMatch!.overlap_fraction).toBeGreaterThanOrEqual(0.8);
  });
});
