/**
 * MAR-107 — Edge validation fixtures
 *
 * One describe block per tested edge. Each block name is the edge ID so that
 * test_refs in the YAML files map directly to this file.
 */
import { describe, it, expect } from "vitest";
import { augmentWithSafety } from "../../src/graph/safetyAugmenter.js";
import {
  computeExecutionOrder,
  detectAvoidViolations,
} from "../../src/graph/routeOrdering.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();
const { components, edges } = registry;

function pick(ids: string[]) {
  return ids.map((id) => {
    const c = components.find((c) => c.id === id);
    if (!c) throw new Error(`Component not found in registry: ${id}`);
    return c;
  });
}

// ── requires: human_approval_gate (critical) ───────────────────────────────

describe("edge: external_publish__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when external_publish is present", () => {
    const result = augmentWithSafety(pick(["external_publish"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });

  it("gate is not duplicated when already present in the selected set", () => {
    const result = augmentWithSafety(
      pick(["external_publish", "human_approval_gate"]),
      edges,
      components,
    );
    const gateCount = result.components.filter((c) => c.id === "human_approval_gate").length;
    expect(gateCount).toBe(1);
  });
});

describe("edge: optional_email_send__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when optional_email_send is present", () => {
    const result = augmentWithSafety(pick(["optional_email_send"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

describe("edge: crm_note_write__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when crm_note_write is present", () => {
    const result = augmentWithSafety(pick(["crm_note_write"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

describe("edge: calendar_write__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when calendar_write is present", () => {
    const result = augmentWithSafety(pick(["calendar_write"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

// ── avoid_when (critical) ──────────────────────────────────────────────────

describe("edge: data_scraper__avoid__external_publish", () => {
  it("detectAvoidViolations flags a critical violation when both endpoints are selected", () => {
    const violations = detectAvoidViolations(
      new Set(["data_scraper", "external_publish"]),
      edges,
    );
    const v = violations.find(
      (v) => v.from === "data_scraper" && v.to === "external_publish",
    );
    expect(v).toBeDefined();
    expect(v!.severity).toBe("critical");
  });

  it("no violation when external_publish is absent from the route", () => {
    const violations = detectAvoidViolations(
      new Set(["data_scraper", "data_normalizer", "schema_validation"]),
      edges,
    );
    const v = violations.find(
      (v) => v.from === "data_scraper" && v.to === "external_publish",
    );
    expect(v).toBeUndefined();
  });
});

// ── requires: citation_checker (high) ─────────────────────────────────────

describe("edge: research_synthesis__requires__citation_checker", () => {
  it("edge is present in registry with relation requires and severity high", () => {
    const edge = edges.find((e) => e.id === "research_synthesis__requires__citation_checker");
    expect(edge).toBeDefined();
    expect(edge!.relation).toBe("requires");
    expect(edge!.severity).toBe("high");
  });

  it("composeRoute for a research + citations goal includes citation_checker", () => {
    const result = composeRoute(
      {
        goal: "research a topic and synthesise findings with verified citations",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("citation_checker");
  });
});

// ── must_run_before (high) ─────────────────────────────────────────────────

describe("edge: schema_validation__before__external_publish", () => {
  it("computeExecutionOrder places schema_validation before external_publish", () => {
    const ordered = computeExecutionOrder(
      pick(["external_publish", "schema_validation", "human_approval_gate"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("schema_validation")).toBeLessThan(ids.indexOf("external_publish"));
  });
});

describe("edge: code_editing__before__test_runner", () => {
  it("computeExecutionOrder places code_editing before test_runner", () => {
    const ordered = computeExecutionOrder(
      pick(["test_runner", "code_editing", "codebase_scan"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("code_editing")).toBeLessThan(ids.indexOf("test_runner"));
  });
});

describe("edge: codebase_scan__before__code_editing", () => {
  it("computeExecutionOrder places codebase_scan before code_editing", () => {
    const ordered = computeExecutionOrder(
      pick(["code_editing", "codebase_scan", "test_runner"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("codebase_scan")).toBeLessThan(ids.indexOf("code_editing"));
  });
});

// ── produces_input_for (high) ──────────────────────────────────────────────

describe("edge: plan_generation__produces__code_editing", () => {
  it("computeExecutionOrder places plan_generation before code_editing", () => {
    const ordered = computeExecutionOrder(
      pick(["code_editing", "plan_generation", "codebase_scan", "test_runner"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("plan_generation")).toBeLessThan(ids.indexOf("code_editing"));
  });
});

describe("edge: source_retrieval__produces__source_ranking", () => {
  it("computeExecutionOrder places source_retrieval before source_ranking", () => {
    const ordered = computeExecutionOrder(
      pick(["source_ranking", "source_retrieval", "research_synthesis"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("source_retrieval")).toBeLessThan(ids.indexOf("source_ranking"));
  });
});

// ── safer_with (high) ─────────────────────────────────────────────────────

describe("edge: copy_generation__safer_with__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when copy_generation is present", () => {
    const result = augmentWithSafety(pick(["copy_generation"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});
