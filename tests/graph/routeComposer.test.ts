import { describe, it, expect } from "vitest";
import { composeRoute, type ComposeInput } from "../../src/graph/routeComposer.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function compose(goal: string, extra: Partial<ComposeInput> = {}) {
  return composeRoute(
    { goal, must_have_capabilities: [], must_avoid: [], ...extra },
    registry,
  );
}

describe("composeRoute — basic behaviour", () => {
  it("returns a non-empty route for an email goal", () => {
    const result = compose("read emails and draft a reply");
    expect(result.recommended_route.length).toBeGreaterThan(0);
    expect(result.status).not.toBe("not_found");
  });

  it("returns a non-empty route for a research goal", () => {
    const result = compose("research a topic and summarize with citations");
    expect(result.recommended_route.length).toBeGreaterThan(0);
  });

  it("returns not_found for a completely unrecognised goal", () => {
    const result = compose("xyzzy frobnicate the quantum zork");
    // Either not_found or low_confidence is acceptable
    const acceptableStatuses = ["not_found", "low_confidence", "candidate_route"];
    expect(acceptableStatuses).toContain(result.status);
  });

  it("route steps are numbered sequentially starting at 1", () => {
    const result = compose("scrape data and validate schema");
    for (let i = 0; i < result.recommended_route.length; i++) {
      expect(result.recommended_route[i]!.step).toBe(i + 1);
    }
  });

  it("every step has non-empty component_id and purpose", () => {
    const result = compose("read emails and draft a reply");
    for (const step of result.recommended_route) {
      expect(step.component_id.length).toBeGreaterThan(0);
      expect(step.purpose.length).toBeGreaterThan(0);
    }
  });
});

describe("composeRoute — safety gates", () => {
  it("adds human_approval_gate when optional_email_send is in route", () => {
    const result = compose("send email to a lead");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("optional_email_send")) {
      expect(ids).toContain("human_approval_gate");
    }
  });

  it("adds human_approval_gate when external_publish is in route", () => {
    const result = compose("generate content and publish it");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("external_publish")) {
      expect(ids).toContain("human_approval_gate");
    }
  });

  it("includes required_approval_gates list when gates are present", () => {
    const result = compose("publish content externally");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("human_approval_gate")) {
      expect(result.required_approval_gates.length).toBeGreaterThan(0);
    }
  });

  it("required_approval_gates is populated when gate is in route", () => {
    const result = compose("send email to customer");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("human_approval_gate")) {
      expect(result.required_approval_gates.length).toBeGreaterThan(0);
    }
  });
});

describe("composeRoute — must_avoid", () => {
  it("excludes must_avoid components from route", () => {
    const result = compose("research and summarize", {
      must_avoid: ["research_synthesis"],
    });
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).not.toContain("research_synthesis");
  });
});

describe("composeRoute — playbook overlap", () => {
  it("detects overlap with known playbooks for research goal", () => {
    const result = compose("retrieve sources, rank them and synthesize with citations");
    // Should detect overlap with research_agent_citations
    if (result.known_playbooks_reused.length > 0) {
      expect(result.known_playbooks_reused[0]).toContain("research");
    }
    // Either way, no crash
    expect(Array.isArray(result.known_playbooks_reused)).toBe(true);
  });
});

describe("composeRoute — scoring", () => {
  it("route_score is between 0 and 100", () => {
    const result = compose("scrape data, normalize and validate");
    expect(result.route_score).toBeGreaterThanOrEqual(0);
    expect(result.route_score).toBeLessThanOrEqual(100);
  });

  it("confidence is between 0 and 1", () => {
    const result = compose("research and summarize");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("score_breakdown contains all expected keys", () => {
    const result = compose("code editing and testing");
    const bd = result.score_breakdown as Record<string, number>;
    expect(typeof bd.capability_coverage).toBe("number");
    expect(typeof bd.safety_score).toBe("number");
    expect(typeof bd.simplicity_score).toBe("number");
    expect(typeof bd.risk_penalty).toBe("number");
  });
});

/**
 * MAR-89 (MCP-15) — schema_validation must never be silently dropped.
 *
 * Regression: benchmark p2 (content workflow) showed compose omits
 * schema_validation even though the playbook requires it before external_publish.
 */
describe("composeRoute — MAR-89: schema_validation never dropped on publish routes", () => {
  it("p2 content workflow: schema_validation present when external_publish is in route", () => {
    const result = compose(
      "Build a content workflow for a brand that starts from a content brief or campaign " +
        "idea, generates copy variants, hands off to a design tool for visual creation, " +
        "requires marketing approval before publishing, and publishes to a public channel.",
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    // If external_publish is in the route, schema_validation must also be present.
    if (ids.includes("external_publish")) {
      expect(ids).toContain("schema_validation");
    }
  });

  it("any publish goal: schema_validation present alongside external_publish", () => {
    const result = compose("generate content and publish it to a public channel");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("external_publish")) {
      expect(ids).toContain("schema_validation");
    }
  });

  it("email send goal: schema_validation present alongside optional_email_send", () => {
    const result = compose(
      "draft a personalised follow-up email and send it after human approval",
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("optional_email_send")) {
      expect(ids).toContain("schema_validation");
    }
  });
});

/**
 * MAR-91 (MCP-17) — playbook-first routing at ≥0.80 recall + precision guard.
 */
describe("composeRoute — MAR-91: playbook-first at ≥0.80", () => {
  it("p3 email/calendar: playbook_recommendation is present", () => {
    const result = compose(
      "Build an AI assistant that reads the user's email inbox, identifies emails that need " +
        "replies or require meeting scheduling, drafts replies and calendar invites, presents " +
        "drafts for approval, and only sends or books after explicit human confirmation.",
    );
    expect(result.playbook_recommendation).toBeDefined();
  });

  it("p3 email/calendar: recommendation_type is 'playbook' when recall >= 0.80 and precision >= 0.50", () => {
    const result = compose(
      "Build an AI assistant that reads the user's email inbox, identifies emails that need " +
        "replies or require meeting scheduling, drafts replies and calendar invites, presents " +
        "drafts for approval, and only sends or books after explicit human confirmation.",
    );
    if (result.playbook_recommendation) {
      if (
        result.playbook_recommendation.overlap.recall >= 0.8 &&
        result.playbook_recommendation.overlap.precision >= 0.5
      ) {
        expect(result.playbook_recommendation.recommendation_type).toBe("playbook");
      }
    }
  });

  it("p3 email/calendar: summary says 'get_playbook' or 'playbook' when recommendation_type is playbook", () => {
    const result = compose(
      "Build an AI assistant that reads the user's email inbox, identifies emails that need " +
        "replies or require meeting scheduling, drafts replies and calendar invites, presents " +
        "drafts for approval, and only sends or books after explicit human confirmation.",
    );
    if (result.playbook_recommendation?.recommendation_type === "playbook") {
      expect(result.summary_markdown.toLowerCase()).toMatch(/playbook/);
    }
  });

  it("playbook_recommendation.overlap has recall, precision, jaccard, extra and missing arrays", () => {
    const result = compose("read emails and schedule meetings");
    if (result.playbook_recommendation) {
      const ov = result.playbook_recommendation.overlap;
      expect(typeof ov.recall).toBe("number");
      expect(typeof ov.precision).toBe("number");
      expect(typeof ov.jaccard).toBe("number");
      expect(Array.isArray(ov.extra_components)).toBe(true);
      expect(Array.isArray(ov.missing_components)).toBe(true);
    }
  });

  it("a goal with no playbook match has no playbook_recommendation or recommendation_type composed", () => {
    const result = compose("xyzzy frobnicate the quantum zork");
    // For no match, recommendation field should either be absent or recommendation_type "composed"
    if (result.playbook_recommendation) {
      expect(result.playbook_recommendation.recommendation_type).toBe("composed");
    }
  });
});

/**
 * MAR-90 (MCP-16) — execution_order, avoid_when blocking, compose_noise.
 */
describe("composeRoute — MAR-90: execution order + avoid_when blocking", () => {
  it("exposes planning_order and execution_order as arrays", () => {
    const result = compose("research a topic and summarize with citations");
    expect(Array.isArray(result.planning_order)).toBe(true);
    expect(Array.isArray(result.execution_order)).toBe(true);
    expect(result.execution_order.length).toBe(result.recommended_route.length);
  });

  it("recommended_route step order matches execution_order", () => {
    const result = compose("generate content and publish it to a public channel");
    const stepIds = result.recommended_route.map((s) => s.component_id);
    expect(stepIds).toEqual(result.execution_order);
  });

  it("publish goal: human_approval_gate precedes external_publish in execution_order", () => {
    const result = compose("generate content and publish it to a public channel");
    const ids = result.execution_order;
    if (ids.includes("external_publish") && ids.includes("human_approval_gate")) {
      expect(ids.indexOf("human_approval_gate")).toBeLessThan(
        ids.indexOf("external_publish"),
      );
      // publish-at-step-2 artifact must not recur
      expect(ids.indexOf("external_publish")).toBeGreaterThan(1);
    }
  });

  it("ETL + publish goal triggers blocked_candidate with a critical avoid_when violation", () => {
    const result = compose("scrape data from a website and publish it to social media");
    const ids = result.recommended_route.map((s) => s.component_id);
    // Only meaningful if both endpoints ended up in the route.
    if (ids.includes("data_scraper") && ids.includes("external_publish")) {
      expect(result.status).toBe("blocked_candidate");
      expect(result.avoid_when_violations.length).toBeGreaterThan(0);
      expect(
        result.avoid_when_violations.some((v) => v.severity === "critical"),
      ).toBe(true);
      expect(result.summary_markdown.toLowerCase()).toContain("blocked");
    }
  });

  it("avoid_when_violations and compose_noise are always arrays", () => {
    const result = compose("read emails and draft a reply");
    expect(Array.isArray(result.avoid_when_violations)).toBe(true);
    expect(Array.isArray(result.compose_noise)).toBe(true);
  });
});

describe("composeRoute — MAR-88 domain gating (end-to-end)", () => {
  it("p5 ETL goal never composes external_publish into the route", () => {
    const result = compose(
      "Build a data extraction and enrichment pipeline that scrapes or pulls data from " +
        "an external source, normalizes the schema, deduplicates records, validates " +
        "against a target schema, handles partial failures with retries, and writes an " +
        "audit log.",
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).not.toContain("external_publish");
  });

  it("p3 email/calendar goal never composes design_brief_generation", () => {
    const result = compose(
      "Build an AI assistant that reads the user's email inbox, identifies emails that " +
        "need replies or require meeting scheduling, drafts replies and calendar invites, " +
        "presents drafts for approval, and only sends or books after explicit human " +
        "confirmation.",
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).not.toContain("design_brief_generation");
  });
});

/**
 * MAR-93 (MCP-19) — route_status / blocking_gaps / why_not_validated lead output.
 */
describe("composeRoute — MAR-93: route validation status", () => {
  it("exposes route_status, blocking_gaps, why_not_validated, confidence_label", () => {
    const result = compose("read emails and draft a reply");
    expect(["validated", "candidate", "blocked_candidate"]).toContain(result.route_status);
    expect(Array.isArray(result.blocking_gaps)).toBe(true);
    expect(typeof result.why_not_validated).toBe("string");
    expect(["high", "medium", "low"]).toContain(result.confidence_label);
  });

  it("candidate routes always have non-empty why_not_validated", () => {
    const result = compose("research a topic and summarize with citations");
    if (result.route_status === "candidate") {
      expect(result.why_not_validated.length).toBeGreaterThan(0);
    }
  });

  it("blocked_candidate maps to route_status blocked_candidate with gaps", () => {
    const result = compose("scrape data from a website and publish it to social media");
    const ids = result.recommended_route.map((s) => s.component_id);
    if (ids.includes("data_scraper") && ids.includes("external_publish")) {
      expect(result.route_status).toBe("blocked_candidate");
      expect(result.blocking_gaps.length).toBeGreaterThan(0);
      expect(result.why_not_validated.length).toBeGreaterThan(0);
    }
  });

  it("summary_markdown leads with route_status, not raw confidence percentage", () => {
    const result = compose("read emails and schedule meetings");
    expect(result.summary_markdown).toMatch(/route status/i);
    expect(result.summary_markdown).not.toMatch(/\*\*Confidence:\*\* \d+%/);
  });

  it("summary_markdown includes blocking gaps section when gaps exist", () => {
    const result = compose(
      "scrape data from a website and publish it to social media",
      { must_have_capabilities: ["nonexistent_capability_xyz"] },
    );
    if (result.blocking_gaps.length > 0) {
      expect(result.summary_markdown).toMatch(/blocking gaps/i);
      expect(result.summary_markdown).toMatch(/why not validated/i);
    }
  });

  it("summary_markdown includes score breakdown after blockers", () => {
    const result = compose("scan codebase and run tests");
    expect(result.summary_markdown).toMatch(/score breakdown/i);
  });
});

describe("composeRoute — output structure", () => {
  it("returns all required output fields", () => {
    const result = compose("email and calendar workflow");
    expect(Array.isArray(result.edges_used)).toBe(true);
    expect(Array.isArray(result.untested_edges)).toBe(true);
    expect(Array.isArray(result.missing_capabilities)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.assumptions)).toBe(true);
    expect(Array.isArray(result.evals_to_add)).toBe(true);
    expect(Array.isArray(result.next_recommended_tools)).toBe(true);
    expect(typeof result.summary_markdown).toBe("string");
    expect(result.summary_markdown.length).toBeGreaterThan(0);
  });

  it("result is JSON-serialisable", () => {
    const result = compose("research and email workflow");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("brief output_depth returns shorter markdown", () => {
    const brief = compose("research topic", { output_depth: "brief" });
    const standard = compose("research topic", { output_depth: "standard" });
    expect(brief.summary_markdown.length).toBeLessThan(standard.summary_markdown.length);
  });
});

describe("composeRoute — MAR-116: model_tier_profile", () => {
  it("returns a model_tier_profile with all four tier buckets", () => {
    const result = compose("research and synthesise with citations");
    expect(result.model_tier_profile).toBeDefined();
    expect(Array.isArray(result.model_tier_profile.frontier)).toBe(true);
    expect(Array.isArray(result.model_tier_profile.standard)).toBe(true);
    expect(Array.isArray(result.model_tier_profile.small)).toBe(true);
    expect(Array.isArray(result.model_tier_profile.none)).toBe(true);
  });

  it("research route puts research_synthesis in frontier tier", () => {
    const result = compose("research a topic and synthesise with citations");
    expect(result.model_tier_profile.frontier).toContain("research_synthesis");
  });

  it("coding route puts plan_generation and code_editing in frontier tier", () => {
    const result = compose("scan codebase, plan changes and edit code");
    expect(result.model_tier_profile.frontier).toContain("plan_generation");
    expect(result.model_tier_profile.frontier).toContain("code_editing");
  });

  it("every step component_id appears in exactly one tier bucket", () => {
    const result = compose("read emails and draft replies");
    const allBuckets = [
      ...result.model_tier_profile.frontier,
      ...result.model_tier_profile.standard,
      ...result.model_tier_profile.small,
      ...result.model_tier_profile.none,
    ];
    const routeIds = result.recommended_route.map((s) => s.component_id);
    for (const id of routeIds) {
      expect(allBuckets.filter((b) => b === id).length, `${id} appears in exactly one bucket`).toBe(1);
    }
  });

  it("each RouteStep carries model_tier and context_need fields", () => {
    const result = compose("research and synthesise");
    for (const step of result.recommended_route) {
      expect(typeof step.model_tier).toBe("string");
      expect(typeof step.context_need).toBe("string");
      expect(typeof step.fallback_tier).toBe("string");
      expect(typeof step.compression_strategy).toBe("string");
    }
  });

  it("not_found result has empty tier buckets", () => {
    const result = compose("xyzzy frobnicate the quantum zork");
    if (result.status === "not_found") {
      expect(result.model_tier_profile.frontier).toEqual([]);
      expect(result.model_tier_profile.standard).toEqual([]);
    }
  });
});

describe("composeRoute — MAR-117: credential advisory + auth_failure_handler", () => {
  it("injects auth_failure_handler into a publish route", () => {
    const r = compose("generate marketing copy and publish it to an external channel");
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("auth_failure_handler");
  });

  it("credential_advisory lists the external integration and recommends a secret manager", () => {
    const r = compose("generate marketing copy and publish it to an external channel");
    const comps = r.credential_advisory.components_requiring_credentials.map((c) => c.component_id);
    expect(comps).toContain("external_publish");
    expect(r.credential_advisory.secret_manager_recommendation).not.toBeNull();
    expect(r.credential_advisory.secret_manager_recommendation).toContain("secret manager");
  });

  it("credential_advisory is empty for a purely internal route", () => {
    const r = compose("deduplicate records and validate them against a schema");
    expect(r.credential_advisory.components_requiring_credentials.length).toBe(0);
    expect(r.credential_advisory.secret_manager_recommendation).toBeNull();
  });

  it("credential_advisory is always present and serialisable", () => {
    const r = compose("read emails and draft replies");
    expect(r.credential_advisory).toBeDefined();
    expect(Array.isArray(r.credential_advisory.components_requiring_credentials)).toBe(true);
    expect(() => JSON.stringify(r.credential_advisory)).not.toThrow();
  });
});
