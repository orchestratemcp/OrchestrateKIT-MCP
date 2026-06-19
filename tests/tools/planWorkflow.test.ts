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

  // MAR-133 (Dogfood Round 3 G4): a composed candidate must NEVER be labelled
  // "validated". composeRoute's looser internal playbook-first flag could set
  // route_status="validated" while plan_workflow's stricter gate fell back to
  // plan_source="composed" / playbook=null — a self-contradicting output. The
  // status must agree with the route plan_workflow actually returns.
  it("never reports route_status 'validated' on a composed (no-playbook) plan", () => {
    // This exact goal reproduced the contradiction: compose said "validated",
    // plan chose the composed path.
    const r = plan(
      "Take a blog post, generate 3 social media variants, have a human approve them, then notify the team.",
    );
    expect(r.plan_source).toBe("composed");
    expect(r.playbook).toBeNull();
    expect(r.route_status).not.toBe("validated");
  });

  it("route_status agrees with plan_source across a spread of goals", () => {
    const goals = [
      "Take a blog post, generate 3 social media variants, have a human approve them, then notify the team.",
      "start from a content brief, generate copy, design visuals, approve and publish",
      "scan a codebase, plan changes, edit code, run tests and write a PR summary",
      "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval",
      "every morning pull data from the warehouse and post a summary to Slack",
    ];
    for (const g of goals) {
      const r = plan(g);
      // "validated" is reserved for the playbook path; the composed path is at
      // most a "candidate" (or "blocked_candidate"). The playbook path is
      // "validated" unless a critical avoid_when conflict blocks it.
      if (r.plan_source === "composed") {
        expect(["candidate", "blocked_candidate"]).toContain(r.route_status);
      } else {
        expect(["validated", "blocked_candidate"]).toContain(r.route_status);
        expect(r.playbook).not.toBeNull();
      }
    }
  });

  // MAR-133: every untested edge carries a deterministic registry severity, and
  // the summary surfaces it — clients no longer have to infer HIGH/MEDIUM/LOW.
  it("untested_edges entries carry id + a valid severity, rendered in markdown", () => {
    const r = plan(
      "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval",
    );
    expect(r.untested_edges.length).toBeGreaterThan(0);
    for (const e of r.untested_edges) {
      expect(typeof e.id).toBe("string");
      expect(["low", "medium", "high", "critical"]).toContain(e.severity);
    }
    const first = r.untested_edges[0]!;
    expect(r.summary_markdown).toContain(`\`${first.id}\` (${first.severity})`);
  });
});

describe("planWorkflow — MAR-132 unattended / no-gate handling", () => {
  it("s7: an unattended monitor+Slack goal gets an advisory gate (Slack is an external write)", () => {
    const r = plan(
      "monitor a competitor pricing page on an hourly schedule and alert me on Slack when it changes; runs unattended, no human in the loop",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    // slack_notification is an external write → gate kept but downgraded to advisory
    expect(ids).toContain("slack_notification");
    expect(ids).toContain("human_approval_gate");
    expect(r.required_approval_gates).toEqual([]);
    expect(r.approval_gate_advisory).not.toBeNull();
    expect(r.approval_gate_advisory!.gate).toBe("human_approval_gate");
    expect(r.approval_gate_advisory!.write_components).toContain("slack_notification");
  });

  it("s10: an explicit no-gate waiver over a real write keeps the gate as advisory", () => {
    const r = plan(
      "onboard a new hire: send a welcome email and create a calendar reminder; fully automated, no approval gate needed",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    // gate is KEPT in the route ...
    expect(ids).toContain("human_approval_gate");
    // ... but downgraded from required to advisory, naming the real write(s)
    expect(r.required_approval_gates).toEqual([]);
    expect(r.approval_gate_advisory).not.toBeNull();
    expect(r.approval_gate_advisory!.gate).toBe("human_approval_gate");
    expect(r.approval_gate_advisory!.write_components.length).toBeGreaterThan(0);
    expect(r.summary_markdown.toLowerCase()).toContain("advisory");
  });

  it("control: a real write WITHOUT a waiver still hard-requires the gate", () => {
    const r = plan(
      "start from a content brief, generate copy, design visuals, approve and publish to our blog",
    );
    expect(r.recommended_route.map((s) => s.component_id)).toContain("human_approval_gate");
    expect(r.required_approval_gates).toEqual(["human_approval_gate"]);
    expect(r.approval_gate_advisory).toBeNull();
  });
});

// MAR-101: output_depth wired in plan_workflow
describe("planWorkflow — output_depth (MAR-101)", () => {
  const goal = "start from a content brief, generate copy, design visuals, approve and publish";

  it("brief mode produces a shorter summary_markdown than standard", () => {
    const brief = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    const standard = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" }, registry);
    expect(brief.summary_markdown.length).toBeLessThan(standard.summary_markdown.length);
  });

  it("brief mode summary includes numbered steps", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    // each step is numbered "1." "2." etc.
    const stepCount = r.recommended_route.length;
    expect(r.summary_markdown).toContain(`${stepCount}.`);
  });

  it("brief mode summary includes safety status", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    const statusUpper = r.safety_review.status.toUpperCase();
    expect(r.summary_markdown).toContain(statusUpper);
  });

  it("brief mode still returns the full recommended_route array", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    expect(r.recommended_route.length).toBeGreaterThan(0);
    for (const s of r.recommended_route) {
      expect(typeof s.component_id).toBe("string");
      expect(typeof s.component_name).toBe("string");
    }
  });

  it("brief mode on playbook path mentions the playbook", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    expect(r.plan_source).toBe("playbook");
    expect(r.summary_markdown).toContain(r.playbook!.id);
  });

  it("standard mode is default (no output_depth param)", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
    // standard mode includes "Model-tier profile" section
    expect(r.summary_markdown).toContain("Model-tier profile");
  });
});

// MAR-101: scannable front-matter status block leads every plan output
describe("planWorkflow — status front-matter header (MAR-101)", () => {
  const playbookGoal = "start from a content brief, generate copy, design visuals, approve and publish";
  const composedGoal =
    "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval";

  it("summary_markdown opens with a front-matter fence", () => {
    const r = plan(playbookGoal);
    expect(r.summary_markdown.startsWith("---\n")).toBe(true);
  });

  it("header surfaces route_status, safety, blocking, approval, untested_edges", () => {
    const r = plan(playbookGoal);
    const header = r.summary_markdown.split("\n\n")[0];
    for (const key of [
      "route_status:",
      "safety:",
      "blocking:",
      "approval:",
      "untested_edges:",
    ]) {
      expect(header, key).toContain(key);
    }
  });

  it("header route_status matches the output route_status field", () => {
    const r = plan(playbookGoal);
    const header = r.summary_markdown.split("\n\n")[0];
    expect(header).toContain(`route_status:`);
    expect(header).toContain(r.route_status);
  });

  it("header untested_edges count matches the output array length", () => {
    const r = plan(composedGoal);
    const header = r.summary_markdown.split("\n\n")[0];
    expect(header).toContain(`untested_edges:`);
    expect(header).toMatch(new RegExp(`untested_edges:\\s+\\S+\\s+${r.untested_edges.length}\\b`));
  });

  it("a composed candidate is NOT labelled validated in the header", () => {
    const r = plan(composedGoal);
    expect(r.plan_source).toBe("composed");
    const header = r.summary_markdown.split("\n\n")[0];
    expect(header).toContain("route_status:");
    expect(header).not.toMatch(/route_status:\s+✅ validated/);
  });

  it("the header is present in brief mode too", () => {
    const r = planWorkflow(
      { goal: playbookGoal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
    expect(r.summary_markdown.startsWith("---\n")).toBe(true);
    expect(r.summary_markdown.split("\n\n")[0]).toContain("route_status:");
  });
});
