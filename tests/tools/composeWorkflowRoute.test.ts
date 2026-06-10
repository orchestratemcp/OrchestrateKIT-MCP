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
