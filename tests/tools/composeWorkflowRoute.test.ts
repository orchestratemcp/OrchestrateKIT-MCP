import { describe, it, expect } from "vitest";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

describe("composeWorkflowRoute integration", () => {
  it("email + research lead workflow produces useful route", () => {
    const result = composeRoute(
      {
        goal: "read emails, detect leads, research the company and draft a follow-up email",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    expect(result.status).not.toBe("not_found");
    expect(result.recommended_route.length).toBeGreaterThanOrEqual(3);

    const ids = result.recommended_route.map((s) => s.component_id);
    // Should include email and research components
    expect(ids.some((id) => id.includes("email"))).toBe(true);
    expect(ids.some((id) => id.includes("source") || id.includes("research"))).toBe(true);
  });

  it("data scraping workflow produces useful route", () => {
    const result = composeRoute(
      {
        goal: "scrape product data, normalize and validate before storage",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    expect(result.status).not.toBe("not_found");
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("data_scraper");
    expect(ids).toContain("data_normalizer");
  });

  it("coding workflow includes test_runner", () => {
    const result = composeRoute(
      {
        goal: "scan codebase, plan changes, implement and run tests",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("codebase_scan");
    expect(ids).toContain("test_runner");
  });

  it("send email without approval gate triggers warning", () => {
    const result = composeRoute(
      {
        goal: "read email and send reply",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    const ids = result.recommended_route.map((s) => s.component_id);
    // If optional_email_send is in route, human_approval_gate must also be there
    if (ids.includes("optional_email_send")) {
      expect(ids).toContain("human_approval_gate");
    }
  });

  it("two different goals produce different routes", () => {
    const email = composeRoute(
      { goal: "read and reply to emails", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const code = composeRoute(
      { goal: "scan codebase and implement changes", must_have_capabilities: [], must_avoid: [] },
      registry,
    );

    const emailIds = new Set(email.recommended_route.map((s) => s.component_id));
    const codeIds = new Set(code.recommended_route.map((s) => s.component_id));

    // The routes should not be identical
    expect(emailIds).not.toEqual(codeIds);
  });

  it("MAR-92: edges_used items are inline edge objects with required fields", () => {
    const result = composeRoute(
      { goal: "scan codebase, plan changes, implement and run tests", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(Array.isArray(result.edges_used)).toBe(true);
    if (result.edges_used.length > 0) {
      const first = result.edges_used[0] as Record<string, unknown>;
      expect(typeof first["edge_id"]).toBe("string");
      expect(typeof first["relation"]).toBe("string");
      expect(typeof first["severity"]).toBe("string");
      expect(typeof first["tested"]).toBe("boolean");
      expect(Array.isArray(first["test_refs"])).toBe(true);
      expect(typeof first["condition"]).toBe("string");
      expect(typeof first["test_action"]).toBe("string");
    }
  });

  it("MAR-95 p6 CRM: route includes crm_note_write and human_approval_gate, excludes external_publish", () => {
    const result = composeRoute(
      {
        goal:
          "read email inbox, identify sales leads, research the company, write a CRM note, " +
          "draft a follow-up email for human review, only send after explicit approval",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("crm_note_write");
    expect(ids).toContain("human_approval_gate");
    expect(ids).not.toContain("external_publish");
  });

  // MAR-115 p6: human_approval_gate must appear BEFORE crm_note_write in execution order
  it("MAR-115 p6: human_approval_gate precedes crm_note_write in execution_order", () => {
    const result = composeRoute(
      {
        goal:
          "read email inbox, identify sales leads, research the company, write a CRM note, " +
          "draft a follow-up email for human review, only send after explicit approval",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    const order = result.execution_order;
    const gateIdx = order.indexOf("human_approval_gate");
    const crmIdx = order.indexOf("crm_note_write");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(crmIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeLessThan(crmIdx);
  });

  // MAR-115 p7: research_synthesis + external_publish must NOT be blocked_candidate
  // when citation_checker and human_approval_gate are both present (bypass satisfied)
  it("MAR-115 p7: monitor+publish route is NOT blocked_candidate when citation_checker and gate are present", () => {
    const result = composeRoute(
      {
        goal:
          "monitor product docs for changes, synthesise a digest, and publish approved content externally",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    // The avoid_when edge research_synthesis→external_publish is bypassed when
    // citation_checker and human_approval_gate are both present.
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("research_synthesis") && ids.includes("external_publish")) {
      expect(result.status).not.toBe("blocked_candidate");
    }
  });

  // MAR-115 p1: research goal with "published" must not inject content_idea_intake
  it("MAR-115 p1: research goal with 'published' does not inject content_idea_intake", () => {
    const result = composeRoute(
      {
        goal:
          "Build a research workflow that retrieves sources from multiple origins, " +
          "checks freshness and ranks by recency, synthesizes a grounded summary " +
          "with inline citations, adds retries when source retrieval fails, and " +
          "requires human review before the summary is published.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).not.toContain("content_idea_intake");
    expect(ids).not.toContain("design_brief_generation");
    expect(ids).toContain("research_synthesis");
    expect(ids).toContain("citation_checker");
  });

  it("result is fully JSON-serialisable", () => {
    const result = composeRoute(
      { goal: "research and summarize", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.status).toBeDefined();
    expect(typeof parsed.route_score).toBe("number");
    expect(typeof parsed.confidence).toBe("number");
    expect(Array.isArray(parsed.recommended_route)).toBe(true);
  });
});
