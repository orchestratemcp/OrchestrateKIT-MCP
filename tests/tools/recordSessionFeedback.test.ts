import { describe, it, expect } from "vitest";
import { buildSessionFeedback } from "../../src/tools/recordSessionFeedback.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

/**
 * record_session_feedback (MAR-126 / SHIP-01) — the stateless "ship" step.
 */

const registry = loadRegistry();

function baseInput(overrides: Partial<Parameters<typeof buildSessionFeedback>[0]> = {}) {
  return {
    goal: "Publish approved content to social with an audit trail",
    route_components: ["copy_generation", "external_publish", "human_approval_gate"],
    route_selected: "",
    client: "claude",
    model: "claude-opus-4-8",
    user_goal_domain: "content-publishing",
    edges_used: [],
    untested_edges: [],
    what_helped: "surfaced the approval gate",
    what_was_noise: "",
    missing_components: [],
    wrong_components: [],
    new_edge_candidates: [],
    playbook_candidate: "",
    linear_issue_candidates: [],
    baseline_comparison: "",
    ...overrides,
  };
}

describe("record_session_feedback", () => {
  it("is stateless and maps input to the Lab session schema", () => {
    const r = buildSessionFeedback(baseInput(), registry);
    expect(r.stateless).toBe(true);
    expect(r.session.prompt).toBe("Publish approved content to social with an audit trail");
    expect(r.session.componentsSelected).toEqual([
      "copy_generation",
      "external_publish",
      "human_approval_gate",
    ]);
    expect(r.session.client).toBe("claude");
    expect(r.session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.instruction).toContain("stored nothing");
  });

  it("averages per-dimension ratings into modelOutputRating", () => {
    const r = buildSessionFeedback(
      baseInput({ ratings: { route_quality: 5, safety: 4, brevity: 3 } }),
      registry,
    );
    // (5 + 4 + 3) / 3 = 4
    expect(r.session.modelOutputRating).toBe(4);
  });

  it("falls back to overall_rating when no per-dimension ratings given", () => {
    const r = buildSessionFeedback(baseInput({ overall_rating: 2 }), registry);
    expect(r.session.modelOutputRating).toBe(2);
  });

  it("flags a missing required dependency (registry-driven self-check)", () => {
    // external_publish requires human_approval_gate + schema_validation.
    const r = buildSessionFeedback(
      baseInput({ route_components: ["external_publish"] }),
      registry,
    );
    const required = r.self_checks.filter((c) => c.severity === "high").map((c) => c.message);
    expect(required.join(" ")).toContain("human_approval_gate");
    expect(required.join(" ")).toContain("schema_validation");
  });

  it("does not flag a satisfied required dependency", () => {
    const r = buildSessionFeedback(
      baseInput({
        route_components: ["external_publish", "human_approval_gate", "schema_validation"],
      }),
      registry,
    );
    const reqMsgs = r.self_checks
      .filter((c) => c.severity === "high")
      .map((c) => c.message)
      .join(" ");
    expect(reqMsgs).not.toContain("requires `human_approval_gate`");
    expect(reqMsgs).not.toContain("requires `schema_validation`");
  });

  it("surfaces recommended_with safeguards as medium self-checks", () => {
    // external_publish is recommended_with audit_log + retry_policy.
    const r = buildSessionFeedback(
      baseInput({
        route_components: ["external_publish", "human_approval_gate", "schema_validation"],
      }),
      registry,
    );
    const medium = r.self_checks.filter((c) => c.severity === "medium").map((c) => c.message);
    expect(medium.join(" ")).toContain("audit_log");
  });

  it("does not nudge a non-publishing route toward external_publish", () => {
    // Regression: retry_policy / schema_validation / audit_log used to declare
    // recommended_with external_publish (backwards), so a data pipeline with no
    // publish step got false "safer with external_publish" self-checks.
    const r = buildSessionFeedback(
      baseInput({
        goal: "Nightly scrape, normalize, validate and load to Postgres",
        user_goal_domain: "data-pipeline",
        route_components: [
          "data_scraper",
          "retry_policy",
          "data_normalizer",
          "deduplication",
          "schema_validation",
          "audit_log",
        ],
      }),
      registry,
    );
    const allMessages = r.self_checks.map((c) => c.message).join(" ");
    expect(allMessages).not.toContain("external_publish");
  });

  it("reports unknown component ids", () => {
    const r = buildSessionFeedback(
      baseInput({ route_components: ["external_publish", "not_a_real_component"] }),
      registry,
    );
    expect(r.unknown_components).toContain("not_a_real_component");
  });

  it("produces a JSON-serialisable, paste-ready result", () => {
    const r = buildSessionFeedback(baseInput({ playbook_candidate: "weekly-social" }), registry);
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.paste_ready_markdown).toContain("componentsSelected");
    expect(r.paste_ready_markdown).toContain("playbookCandidate: weekly-social");
  });
});
