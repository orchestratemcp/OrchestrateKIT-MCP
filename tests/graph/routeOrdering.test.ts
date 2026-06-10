import { describe, it, expect } from "vitest";
import {
  computeExecutionOrder,
  detectAvoidViolations,
} from "../../src/graph/routeOrdering.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const { components, edges } = loadRegistry();

function pick(ids: string[]) {
  return ids.map((id) => {
    const c = components.find((c) => c.id === id);
    if (!c) throw new Error(`Component not found: ${id}`);
    return c;
  });
}

/**
 * MAR-90 (MCP-16) — execution_order is runtime-correct, not raw topology.
 */
describe("computeExecutionOrder — MAR-90", () => {
  it("places human_approval_gate before an irreversible write (external_publish)", () => {
    const ordered = computeExecutionOrder(
      pick([
        "external_publish",
        "human_approval_gate",
        "schema_validation",
        "copy_generation",
        "audit_log",
      ]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("human_approval_gate")).toBeLessThan(
      ids.indexOf("external_publish"),
    );
  });

  it("places schema_validation before external_publish", () => {
    const ordered = computeExecutionOrder(
      pick(["external_publish", "schema_validation", "human_approval_gate"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("schema_validation")).toBeLessThan(
      ids.indexOf("external_publish"),
    );
  });

  it("puts audit_log last", () => {
    const ordered = computeExecutionOrder(
      pick(["external_publish", "human_approval_gate", "audit_log", "copy_generation"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids[ids.length - 1]).toBe("audit_log");
  });

  it("external_publish is NOT placed at step 2 (index 1) when earlier steps exist", () => {
    const ordered = computeExecutionOrder(
      pick([
        "content_idea_intake",
        "copy_generation",
        "external_publish",
        "human_approval_gate",
        "schema_validation",
        "audit_log",
      ]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("external_publish")).toBeGreaterThan(1);
  });

  it("respects must_run_before chain: codebase_scan → code_editing → test_runner", () => {
    const ordered = computeExecutionOrder(
      pick(["test_runner", "code_editing", "codebase_scan"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("codebase_scan")).toBeLessThan(ids.indexOf("code_editing"));
    expect(ids.indexOf("code_editing")).toBeLessThan(ids.indexOf("test_runner"));
  });

  it("returns every input component exactly once", () => {
    const input = pick(["external_publish", "human_approval_gate", "audit_log"]);
    const ordered = computeExecutionOrder(input, edges);
    expect(ordered.length).toBe(input.length);
    expect(new Set(ordered.map((c) => c.id)).size).toBe(input.length);
  });
});

describe("detectAvoidViolations — MAR-90", () => {
  it("flags a critical avoid_when violation for data_scraper + external_publish", () => {
    const ids = new Set(["data_scraper", "external_publish"]);
    const violations = detectAvoidViolations(ids, edges);
    expect(violations.length).toBeGreaterThan(0);
    const critical = violations.find((v) => v.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical!.from).toBe("data_scraper");
    expect(critical!.to).toBe("external_publish");
  });

  it("returns no violations when avoid_when endpoints are not both present", () => {
    const ids = new Set(["data_scraper", "data_normalizer", "schema_validation"]);
    const violations = detectAvoidViolations(ids, edges);
    expect(violations.length).toBe(0);
  });
});
