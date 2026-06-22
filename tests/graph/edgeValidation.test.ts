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

// ═══════════════════════════════════════════════════════════════════════════
// MAR-164 — edge-validation sprint: 20 priority untested edges → tested:true.
// Assertions are behavioral (the augmenter / execution-orderer / composer
// actually enacts the edge), not "edge exists". Most are matcher-independent
// (augmentWithSafety / computeExecutionOrder on a fixed component set) so they
// stay green as the matcher evolves; the two `requires` cases use composeRoute
// with goals whose `to` component can ONLY arrive via the requires edge.
// ═══════════════════════════════════════════════════════════════════════════

/** safer_with → auth_failure_handler: present component pulls a credential-failure path. */
const AUTH_HANDLER_EDGES: Array<[string, string]> = [
  ["external_publish__safer_with__auth_failure_handler", "external_publish"],
  ["optional_email_send__safer_with__auth_failure_handler", "optional_email_send"],
  ["calendar_write__safer_with__auth_failure_handler", "calendar_write"],
  ["crm_note_write__safer_with__auth_failure_handler", "crm_note_write"],
  ["slack_notification__safer_with__auth_failure_handler", "slack_notification"],
  ["webhook_trigger__safer_with__auth_failure_handler", "webhook_trigger"],
  ["airtable_lookup__safer_with__auth_failure_handler", "airtable_lookup"],
  ["stripe_data_read__safer_with__auth_failure_handler", "stripe_data_read"],
];

for (const [edgeId, from] of AUTH_HANDLER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety injects auth_failure_handler when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("auth_failure_handler");
      expect(result.added_auth_handler).toBe(true);
    });
  });
}

/** safer_with → human_approval_gate: the safer_with edge alone triggers the gate (augmenter Rule 2). */
const SAFER_GATE_EDGES: Array<[string, string]> = [
  ["email_draft__safer_with__human_approval_gate", "email_draft"],
  ["design_brief_generation__safer_with__human_approval_gate", "design_brief_generation"],
  ["pr_summary__safer_with__human_approval_gate", "pr_summary"],
];

for (const [edgeId, from] of SAFER_GATE_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety injects human_approval_gate when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
    });
  });
}

/** recommended_for → audit_log: an external-write action pulls an audit trail. */
const AUDIT_EDGES: Array<[string, string]> = [
  ["audit_log__recommended__external_publish", "external_publish"],
  ["audit_log__recommended__optional_email_send", "optional_email_send"],
  ["audit_log__recommended__calendar_write", "calendar_write"],
  ["audit_log__recommended__slack_notification", "slack_notification"],
];

for (const [edgeId, from] of AUDIT_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety adds audit_log when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("audit_log");
      expect(result.added_audit).toBe(true);
    });
  });
}

/** requires → audit_log: saga_compensation must keep an audit trail of every reversal. */
describe("edge: saga_compensation__requires__audit_log", () => {
  it("augmentWithSafety adds audit_log when saga_compensation is present", () => {
    const result = augmentWithSafety(pick(["saga_compensation"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("audit_log");
  });
});

/** produces_input_for / must_run_before: the orderer puts `from` before `to`. */
const ORDER_EDGES: Array<[string, string, string, string[]]> = [
  // [edgeId, from, to, componentSet]
  [
    "codebase_scan__produces__plan_generation",
    "codebase_scan",
    "plan_generation",
    ["plan_generation", "codebase_scan", "code_editing", "test_runner"],
  ],
  [
    "content_idea_intake__produces__copy_generation",
    "content_idea_intake",
    "copy_generation",
    ["copy_generation", "content_idea_intake", "design_brief_generation"],
  ],
  [
    "source_ranking__produces__research_synthesis",
    "source_ranking",
    "research_synthesis",
    ["research_synthesis", "source_ranking", "source_retrieval"],
  ],
  [
    "pdf_extraction__produces__data_normalizer",
    "pdf_extraction",
    "data_normalizer",
    ["data_normalizer", "pdf_extraction"],
  ],
];

for (const [edgeId, from, to, set] of ORDER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`computeExecutionOrder places ${from} before ${to}`, () => {
      const ids = computeExecutionOrder(pick(set), edges).map((c) => c.id);
      expect(ids.indexOf(from)).toBeLessThan(ids.indexOf(to));
    });
  });
}

/** requires (composeRoute Step 3): the required component is pulled in even though
 *  the goal never names it and no keyword matches it directly. */
describe("edge: page_monitor__requires__state_store", () => {
  it("composeRoute for a page-monitor goal pulls in state_store", () => {
    const result = composeRoute(
      {
        goal: "Monitor a web page for changes and alert me when it changes.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("page_monitor");
    expect(ids).toContain("state_store");
  });
});

describe("edge: research_synthesis__requires__source_freshness_check", () => {
  it("composeRoute for a research goal pulls in source_freshness_check", () => {
    const result = composeRoute(
      {
        goal: "research a topic and synthesise the findings into a grounded summary",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("research_synthesis");
    expect(ids).toContain("source_freshness_check");
  });
});
