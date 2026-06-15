/**
 * MAR-100 — plan_workflow meta-tool.
 *
 * Verifies the single-call planner: precision-aware playbook routing (MAR-98),
 * the inlined safety review, the model-tier profile (MAR-116), and the fused
 * output shape.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string) {
  return planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
}

describe("planWorkflow — playbook routing (MAR-98 split)", () => {
  it("routes a codebase goal to the codebase playbook", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    expect(r.plan_source).toBe("playbook");
    expect(r.playbook?.id).toBe("codebase_agent_workflow");
  });

  it("routes a content goal to the content playbook", () => {
    const r = plan("start from a content brief, generate copy, design visuals, approve and publish");
    expect(r.plan_source).toBe("playbook");
    expect(r.playbook?.id).toBe("content_approval_pipeline");
  });

  it("routes a research goal to the research playbook", () => {
    const r = plan("retrieve sources, rank them, synthesise with citations and check freshness");
    expect(r.plan_source).toBe("playbook");
    expect(r.playbook?.id).toBe("research_agent_citations");
  });

  // MAR-130: the email assistant is the genuine match nearest the 0.72 precision
  // floor (precision ≈ 0.73). It MUST still route to playbook — this guards the
  // upper side of the floor so a future tweak can't silently break real matches.
  it("routes a genuine email/calendar goal to the email playbook", () => {
    const r = plan(
      "read my email inbox, classify intent, draft replies and calendar invites, and only send or book after approval",
    );
    expect(r.plan_source).toBe("playbook");
    expect(r.playbook?.id).toBe("email_calendar_assistant");
  });

  it("keeps a novel CRM goal on the composed path (low precision)", () => {
    const r = plan(
      "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval",
    );
    expect(r.plan_source).toBe("composed");
    expect(r.playbook).toBeNull();
  });

  // MAR-130 regression: email_calendar_assistant over-matched CRM / invoice / HR
  // (precision 0.63–0.70) and overrode the route, dropping the primary-domain
  // component. The 0.72 precision floor must downgrade these to composed.
  it.each([
    ["CRM", "when a new lead comes in, log a note to our CRM and draft a follow-up email for approval"],
    ["invoice", "read incoming invoice emails, extract the totals, and send a reminder email when one is overdue"],
    ["HR", "onboard a new hire: schedule their intro meetings and send a welcome email"],
  ])("does not over-match %s to email_calendar_assistant", (_label, goal) => {
    const r = plan(goal);
    expect(r.playbook?.id).not.toBe("email_calendar_assistant");
  });

  it("keeps a novel monitor goal on the composed path", () => {
    const r = plan(
      "monitor product docs pages, summarise changes, extract content ideas, approve and publish",
    );
    expect(r.plan_source).toBe("composed");
    expect(r.playbook).toBeNull();
  });
});

describe("planWorkflow — playbook path builds the golden-path route", () => {
  it("playbook route uses the playbook's components in execution order", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    const ids = r.recommended_route.map((s) => s.component_id);
    // codebase_agent_workflow golden path includes these
    expect(ids).toContain("codebase_scan");
    expect(ids).toContain("code_editing");
    expect(ids).toContain("test_runner");
    // codebase_scan must precede code_editing
    expect(ids.indexOf("codebase_scan")).toBeLessThan(ids.indexOf("code_editing"));
  });

  it("playbook meta reports recall and precision", () => {
    const r = plan("retrieve sources, rank them, synthesise with citations and check freshness");
    expect(r.playbook).not.toBeNull();
    expect(r.playbook!.recall).toBeGreaterThanOrEqual(0.6);
    expect(r.playbook!.precision).toBeGreaterThanOrEqual(0.6);
    expect(r.playbook!.route_id.length).toBeGreaterThan(0);
  });
});

describe("planWorkflow — inlined safety review", () => {
  it("returns a safety_review with a status and risk score", () => {
    const r = plan("read email, classify intent, draft replies and calendar invites with approval");
    expect(["pass", "warnings", "fail"]).toContain(r.safety_review.status);
    expect(typeof r.safety_review.risk_score).toBe("number");
  });

  it("does not flag a bypassed avoid_when edge as blocking (MAR-115 consistency)", () => {
    // The monitor goal composes research_synthesis + external_publish, but the
    // route also carries citation_checker + human_approval_gate, which satisfies
    // bypass_when_all_present — so it must NOT appear as a blocking issue.
    const r = plan(
      "monitor product docs pages, summarise changes, extract content ideas, approve and publish",
    );
    expect(r.avoid_when_violations.length).toBe(0);
    const flagged = r.safety_review.blocking_issues.some((b) =>
      b.includes("research_synthesis__avoid__external_publish"),
    );
    expect(flagged).toBe(false);
  });
});

describe("planWorkflow — model-tier profile (MAR-116)", () => {
  it("research playbook plan puts research_synthesis in frontier tier", () => {
    const r = plan("retrieve sources, rank them, synthesise with citations and check freshness");
    expect(r.model_tier_profile.frontier).toContain("research_synthesis");
  });

  it("every route step appears in exactly one tier bucket", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    const buckets = [
      ...r.model_tier_profile.frontier,
      ...r.model_tier_profile.standard,
      ...r.model_tier_profile.small,
      ...r.model_tier_profile.none,
    ];
    for (const s of r.recommended_route) {
      expect(buckets.filter((b) => b === s.component_id).length).toBe(1);
    }
  });

  it("each step carries per-step model-tier metadata", () => {
    const r = plan("retrieve sources, rank them, synthesise with citations");
    for (const s of r.recommended_route) {
      expect(typeof s.model_tier).toBe("string");
      expect(typeof s.fallback_tier).toBe("string");
      expect(typeof s.context_need).toBe("string");
      expect(typeof s.compression_strategy).toBe("string");
    }
  });
});

describe("planWorkflow — credential advisory (MAR-117)", () => {
  it("surfaces credential requirements + secret-manager rec for a publish plan", () => {
    const r = plan("start from a content brief, generate copy, design visuals, approve and publish");
    const comps = r.credential_advisory.components_requiring_credentials.map((c) => c.component_id);
    expect(comps).toContain("external_publish");
    expect(r.credential_advisory.secret_manager_recommendation).not.toBeNull();
    expect(r.summary_markdown).toContain("Credentials & permissions");
  });

  it("has an empty credential advisory for a code-only plan", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    expect(r.credential_advisory.components_requiring_credentials.length).toBe(0);
    expect(r.credential_advisory.secret_manager_recommendation).toBeNull();
  });
});

describe("planWorkflow — output shape", () => {
  it("result is JSON-serialisable and has the fused fields", () => {
    const r = plan("read email, classify intent and draft replies with approval");
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.summary_markdown.length).toBeGreaterThan(0);
    expect(Array.isArray(r.recommended_route)).toBe(true);
    expect(Array.isArray(r.untested_edges)).toBe(true);
    expect(Array.isArray(r.next_steps)).toBe(true);
    expect(r.stack).toBeDefined();
  });

  it("summary_markdown leads with the playbook banner on the playbook path", () => {
    const r = plan("start from a content brief, generate copy, design visuals, approve and publish");
    expect(r.summary_markdown).toContain("use validated playbook");
    expect(r.summary_markdown).toContain(r.playbook!.id);
  });

  it("summary_markdown labels a composed candidate as a candidate", () => {
    const r = plan(
      "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval",
    );
    expect(r.summary_markdown.toLowerCase()).toContain("candidate");
  });

  it("playbook-path next_steps point to get_playbook", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    expect(r.next_steps.some((s) => s.includes("get_playbook"))).toBe(true);
  });
});
