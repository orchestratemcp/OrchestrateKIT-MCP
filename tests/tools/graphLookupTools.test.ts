import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import {
  okResponse,
  notFoundResponse,
  statusWarnings,
  toMcpContent,
} from "../../src/tools/graphToolFormatters.js";

// ---------------------------------------------------------------------------
// graphToolFormatters unit tests
// ---------------------------------------------------------------------------

describe("graphToolFormatters", () => {
  describe("okResponse", () => {
    it("sets status to ok", () => {
      const r = okResponse("# Test", { id: "x" });
      expect(r.status).toBe("ok");
    });

    it("includes summary_markdown and data", () => {
      const r = okResponse("# Test", { id: "x" });
      expect(r.summary_markdown).toBe("# Test");
      expect(r.data).toEqual({ id: "x" });
    });

    it("defaults warnings and next_recommended_tools to empty arrays", () => {
      const r = okResponse("ok", {});
      expect(r.warnings).toEqual([]);
      expect(r.next_recommended_tools).toEqual([]);
    });

    it("accepts custom warnings and next_recommended_tools", () => {
      const r = okResponse("ok", {}, ["warn"], ["next_tool"]);
      expect(r.warnings).toEqual(["warn"]);
      expect(r.next_recommended_tools).toEqual(["next_tool"]);
    });
  });

  describe("notFoundResponse", () => {
    it("sets status to not_found", () => {
      const r = notFoundResponse("component", "missing_id");
      expect(r.status).toBe("not_found");
    });

    it("includes entity type and id in markdown", () => {
      const r = notFoundResponse("component", "missing_id");
      expect(r.summary_markdown).toContain("missing_id");
    });

    it("has a non-empty warnings array", () => {
      const r = notFoundResponse("edge", "bad_edge");
      expect(r.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("statusWarnings", () => {
    it("returns empty array for published status", () => {
      expect(statusWarnings("published", "component", "x")).toEqual([]);
    });

    it("returns empty array for validated status", () => {
      expect(statusWarnings("validated", "component", "x")).toEqual([]);
    });

    it("returns warning for beta status", () => {
      const w = statusWarnings("beta", "component", "my_comp");
      expect(w.length).toBe(1);
      expect(w[0]).toContain("beta");
    });

    it("returns warning for deprecated status", () => {
      const w = statusWarnings("deprecated", "component", "old_comp");
      expect(w.length).toBe(1);
      expect(w[0]).toContain("deprecated");
    });
  });

  describe("toMcpContent", () => {
    it("wraps response as MCP text content", () => {
      const r = okResponse("hello", { x: 1 });
      const mcp = toMcpContent(r);
      expect(mcp.content[0].type).toBe("text");
      expect(() => JSON.parse(mcp.content[0].text)).not.toThrow();
    });

    it("round-trips the response through JSON", () => {
      const r = okResponse("md", { id: "test" }, ["warn"]);
      const mcp = toMcpContent(r);
      const parsed = JSON.parse(mcp.content[0].text);
      expect(parsed.status).toBe("ok");
      expect(parsed.data.id).toBe("test");
      expect(parsed.warnings).toEqual(["warn"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests against real registry data (MAR-38 seed)
// ---------------------------------------------------------------------------

describe("registry data — list_graph_components logic", () => {
  const registry = loadRegistry();

  it("registry has at least 20 components", () => {
    expect(registry.components.length).toBeGreaterThanOrEqual(20);
  });

  it("filters by category correctly", () => {
    const safety = registry.components.filter((c) => c.category === "safety");
    expect(safety.length).toBeGreaterThanOrEqual(1);
    for (const c of safety) {
      expect(c.category).toBe("safety");
    }
  });

  it("filters by risk_level correctly", () => {
    const high = registry.components.filter((c) => c.risk_level === "high");
    expect(high.length).toBeGreaterThanOrEqual(1);
    for (const c of high) {
      expect(c.risk_level).toBe("high");
    }
  });

  it("capability substring match finds source_retrieval", () => {
    const needle = "retrieve";
    const matches = registry.components.filter((c) =>
      c.capabilities.some((cap) => cap.toLowerCase().includes(needle)),
    );
    const ids = matches.map((c) => c.id);
    expect(ids).toContain("source_retrieval");
  });

  it("every component has at least one capability", () => {
    for (const c of registry.components) {
      expect(c.capabilities.length, `${c.id} capabilities`).toBeGreaterThan(0);
    }
  });

  it("every component has at least one failure mode", () => {
    for (const c of registry.components) {
      expect(c.failure_modes.length, `${c.id} failure_modes`).toBeGreaterThan(0);
    }
  });
});

describe("registry data — get_graph_component logic", () => {
  const registry = loadRegistry({ includeBeta: true });

  it("finds human_approval_gate by id", () => {
    const c = registry.components.find((c) => c.id === "human_approval_gate");
    expect(c).toBeDefined();
    expect(c!.category).toBe("safety");
  });

  it("finds outgoing edges for external_publish", () => {
    const outgoing = registry.edges.filter((e) => e.from === "external_publish");
    expect(outgoing.length).toBeGreaterThan(0);
  });

  it("finds incoming edges to human_approval_gate", () => {
    const incoming = registry.edges.filter((e) => e.to === "human_approval_gate");
    expect(incoming.length).toBeGreaterThanOrEqual(3);
  });
});

describe("registry data — list_graph_edges logic", () => {
  const registry = loadRegistry();

  it("registry has at least 40 edges", () => {
    expect(registry.edges.length).toBeGreaterThanOrEqual(40);
  });

  it("filters edges by relation type", () => {
    const requires = registry.edges.filter((e) => e.relation === "requires");
    expect(requires.length).toBeGreaterThanOrEqual(3);
    for (const e of requires) {
      expect(e.relation).toBe("requires");
    }
  });

  it("filters edges by severity", () => {
    const critical = registry.edges.filter((e) => e.severity === "critical");
    expect(critical.length).toBeGreaterThanOrEqual(2);
  });

  it("filters edges by from_component_id", () => {
    const from = registry.edges.filter((e) => e.from === "data_scraper");
    expect(from.length).toBeGreaterThan(0);
  });

  it("every edge has a non-empty reason", () => {
    for (const e of registry.edges) {
      expect(e.reason.length, `${e.id} reason`).toBeGreaterThan(0);
    }
  });
});

/**
 * MAR-92 — InlineEdgeSummary from graphToolFormatters
 */
describe("graphToolFormatters — toInlineEdgeSummary (MAR-92)", () => {
  it("maps all required fields from a full edge", async () => {
    const { toInlineEdgeSummary } = await import("../../src/tools/graphToolFormatters.js");
    const registry = loadRegistry();
    const edge = registry.edges.find((e) => e.id === "external_publish__requires__human_approval_gate");
    expect(edge).toBeDefined();
    const summary = toInlineEdgeSummary(edge!);
    expect(summary.edge_id).toBe(edge!.id);
    expect(summary.from).toBe(edge!.from);
    expect(summary.to).toBe(edge!.to);
    expect(summary.relation).toBe(edge!.relation);
    expect(typeof summary.severity).toBe("string");
    expect(typeof summary.tested).toBe("boolean");
    expect(Array.isArray(summary.test_refs)).toBe(true);
    expect(typeof summary.condition).toBe("string");
    expect(typeof summary.test_action).toBe("string");
  });

  it("test_action is empty string when edge is tested", async () => {
    const { toInlineEdgeSummary } = await import("../../src/tools/graphToolFormatters.js");
    const registry = loadRegistry();
    const testedEdge = registry.edges.find((e) => e.tested === true);
    if (testedEdge) {
      const summary = toInlineEdgeSummary(testedEdge);
      expect(summary.test_action).toBe("");
    }
  });

  it("test_action is non-empty when edge is untested", async () => {
    const { toInlineEdgeSummary } = await import("../../src/tools/graphToolFormatters.js");
    const registry = loadRegistry();
    const untestedEdge = registry.edges.find((e) => !e.tested);
    // MAR-207: all 78 edges now tested — skip body if coverage is 100%
    if (!untestedEdge) return;
    const summary = toInlineEdgeSummary(untestedEdge);
    expect(summary.test_action.length).toBeGreaterThan(0);
  });
});

describe("registry data — routes logic", () => {
  const registry = loadRegistry();

  it("registry has 12 routes", () => {
    // 5 original + dynamic_worker_loop_route_v1 (MAR-167)
    // + email_lead_crm_route_v1 (MAR-265)
    // + competitor_price_monitor_route_v1 (MAR-266)
    // + pr_review_readonly_route_v1 (MAR-267)
    // + morning_email_triage_route_v1 (MAR-301)
    // + invoice_intake_po_match_route_v1 (MAR-302)
    // + scheduled_data_report_route_v1 (MAR-303)
    expect(registry.routes.length).toBe(12);
  });

  it("research_route_v1 exists and has components", () => {
    const r = registry.routes.find((r) => r.id === "research_route_v1");
    expect(r).toBeDefined();
    expect(r!.components.length).toBeGreaterThan(0);
  });

  it("all routes have confidence between 0 and 1", () => {
    for (const r of registry.routes) {
      expect(r.confidence, `${r.id} confidence`).toBeGreaterThanOrEqual(0);
      expect(r.confidence, `${r.id} confidence`).toBeLessThanOrEqual(1);
    }
  });

  it("all routes reference only known component ids", () => {
    const componentIds = new Set(registry.components.map((c) => c.id));
    for (const route of registry.routes) {
      for (const cid of route.components) {
        expect(componentIds.has(cid), `route ${route.id} refs unknown component ${cid}`).toBe(true);
      }
    }
  });
});
