/**
 * MAR-100 — plan_workflow meta-tool.
 *
 * Verifies the single-call planner: precision-aware playbook routing (MAR-98),
 * the inlined safety review, the model-tier profile (MAR-116), and the fused
 * output shape.
 */
import { describe, it, expect } from "vitest";
import {
  planWorkflow,
  assessGoalInput,
  buildNeedsGoalResult,
  hasUnattendedWaiver,
  hasExplicitApprovalRequirement,
  buildClarifyingQuestions,
} from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string) {
  return planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
}

// MAR-224: technical/deep render the full report (tiers, credentials, worker
// pipeline, loop contract, provenance block). Tests asserting on those sections
// must request that depth — the default is now the concise Layer-1 markdown.
function planTech(goal: string) {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "technical" },
    registry,
  );
}

describe("planWorkflow — worker build pipeline (MAR-166)", () => {
  it("attaches the planner → coder → reviewer → tester build team to a plan", () => {
    const r = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    expect(r.worker_pipeline.workers.map((w) => w.worker_id)).toEqual([
      "planner",
      "coder",
      "reviewer",
      "tester",
    ]);
    expect(r.worker_pipeline.handoffs.map((h) => `${h.from}->${h.to}`)).toContain(
      "planner->coder",
    );
  });

  it("renders a Build team section in the technical markdown (MAR-224)", () => {
    const r = planTech("read emails, detect leads, research the company and draft a reply");
    expect(r.summary_markdown).toContain("Build team (worker pipeline)");
  });
});

describe("planWorkflow — bounded loop contract (MAR-167)", () => {
  it("surfaces loop_guidance when the route is loop-shaped", () => {
    const r = planTech(
      "trigger an agent on a webhook that loops: a coder writes code, a tester runs " +
        "tests, and an independent reviewer keeps iterating until approved",
    );
    expect(r.recommended_route.some((s) => s.component_id === "loop_controller")).toBe(true);
    expect(r.loop_guidance).not.toBeNull();
    expect(r.loop_guidance!.playbook_id).toBe("dynamic_worker_loop");
    expect(r.loop_guidance!.loop_contract.max_iterations).toBeGreaterThan(0);
    expect(r.loop_guidance!.loop_contract.reviewer_independent).toBe(true);
    expect(r.summary_markdown).toContain("Loop contract & guardrails");
  });

  it("leaves loop_guidance null for a non-loop goal", () => {
    const r = plan("read emails, detect leads and draft a reply");
    expect(r.loop_guidance).toBeNull();
    expect(r.summary_markdown).not.toContain("Loop contract & guardrails");
  });
});

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

  // MAR-128: this goal overlaps content_approval_pipeline at precision 0.78
  // (recall 1.0) — above the floor — but explicitly asks to notify a reviewer,
  // a primary-domain (output) capability the playbook omits. The coverage guard
  // appends it to the playbook route so the capability is delivered (the playbook
  // lead is preserved; it must not be silently dropped).
  it("appends an explicit reviewer-notification match the playbook omits", () => {
    const r = plan(
      "Write blog copy from the brief, send it to a reviewer to approve, and publish to the blog.",
    );
    expect(r.plan_source).toBe("playbook");
    expect(r.recommended_route.map((s) => s.component_id)).toContain(
      "reviewer_notification",
    );
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
    const r = planTech("start from a content brief, generate copy, design visuals, approve and publish");
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

  it("summary_markdown names the validated playbook on the playbook path (Layer-1)", () => {
    const r = plan("start from a content brief, generate copy, design visuals, approve and publish");
    // MAR-224: Layer-1 surfaces it as "Recommended: validated playbook `id`"
    expect(r.summary_markdown).toContain("validated playbook");
    expect(r.summary_markdown).toContain(r.playbook!.id);
  });

  it("technical depth leads with the full playbook banner", () => {
    const r = planTech("start from a content brief, generate copy, design visuals, approve and publish");
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
    // MAR-207: all edges now tested; guard validates structure for future additions
    for (const e of r.untested_edges) {
      expect(typeof e.id).toBe("string");
      expect(["low", "medium", "high", "critical"]).toContain(e.severity);
      expect(r.summary_markdown).toContain(`\`${e.id}\` (${e.severity})`);
    }
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
    expect(r.enforced_approval_gates).toEqual([]);
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
    expect(r.enforced_approval_gates).toEqual([]);
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
    expect(r.enforced_approval_gates).toEqual(["human_approval_gate"]);
    expect(r.approval_gate_advisory).toBeNull();
  });
});

// MAR-229: an explicit approval REQUIREMENT (or a negated "unattended") must NOT
// be misread as a waiver — the gate must stay ENFORCED. Inverse of MAR-132.
describe("planWorkflow — MAR-229 explicit-approval is not a waiver", () => {
  it("the live repro: 'must approve … (attended, not unattended)' ENFORCES the gate", () => {
    const r = plan(
      "Read new leads from my email inbox, draft a reply, update the CRM, and post a notice " +
        "to our Slack sales channel — but a human must approve before anything is sent or " +
        "posted externally (attended, not unattended).",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("human_approval_gate");
    expect(r.enforced_approval_gates).toEqual(["human_approval_gate"]);
    expect(r.approval_gate_advisory).toBeNull();
  });

  it("'never run unattended — a human must approve' ENFORCES the gate", () => {
    const r = plan(
      "post updates to our Slack channel; never run unattended — a human must approve every send",
    );
    expect(r.enforced_approval_gates).toEqual(["human_approval_gate"]);
    expect(r.approval_gate_advisory).toBeNull();
  });

  it("over-fire guard: a genuine waiver still downgrades to advisory (MAR-132 preserved)", () => {
    const r = plan(
      "onboard a new hire: send a welcome email and create a calendar reminder; fully automated, no approval gate needed",
    );
    expect(r.enforced_approval_gates).toEqual([]);
    expect(r.approval_gate_advisory).not.toBeNull();
  });

  it("hasUnattendedWaiver / hasExplicitApprovalRequirement classify the phrase table", () => {
    // [goal, expectedWaiver, expectedExplicitApprovalRequirement]
    const cases: [string, boolean, boolean][] = [
      ["a human must approve before sending (attended, not unattended)", false, true],
      ["never run unattended — a human must approve every send", false, true],
      ["draft replies but require approval before sending", false, true],
      // non-waiver via NEGATION only — no explicit requirement phrase
      ["not fully automated — keep a human reviewing", false, false],
      ["run this fully unattended, no human approval needed", true, false],
      ["post to Slack automatically, no gate, fully automated", true, false],
      ["leave it unattended overnight", true, false],
      ["onboard a hire; fully automated, no approval gate needed", true, false],
    ];
    for (const [goal, expectedWaiver, expectedReq] of cases) {
      expect(hasUnattendedWaiver(goal), `waiver: ${goal}`).toBe(expectedWaiver);
      expect(hasExplicitApprovalRequirement(goal), `reqApproval: ${goal}`).toBe(expectedReq);
    }
  });

  it("does not false-flag 'no human in the loop' as an approval requirement", () => {
    expect(hasExplicitApprovalRequirement("runs unattended, no human in the loop")).toBe(false);
    expect(hasUnattendedWaiver("runs unattended, no human in the loop")).toBe(true);
  });
});

// MAR-225: bounded multiple-choice clarifying questions for missing
// architecture-affecting constraints (run trigger / write-permission / outbound).
describe("planWorkflow — MAR-225 clarifying questions", () => {
  it("buildClarifyingQuestions: vague goal + write+outbound route asks all 3, each with a 'Not sure yet' option", () => {
    const qs = buildClarifyingQuestions(
      "go through my inbox and handle the leads automatically",
      ["email_read", "crm_note_write", "slack_notification"],
    );
    expect(qs.map((q) => q.id).sort()).toEqual(["outbound_send", "run_trigger", "write_permission"]);
    expect(qs.length).toBeLessThanOrEqual(3);
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options[q.options.length - 1].toLowerCase()).toContain("not sure");
    }
  });

  it("buildClarifyingQuestions: a fully-specified goal asks nothing (no nagging)", () => {
    const qs = buildClarifyingQuestions(
      "on a daily schedule, update the CRM and post a summary to slack",
      ["scheduled_trigger", "crm_note_write", "slack_notification"],
    );
    expect(qs).toEqual([]);
  });

  it("buildClarifyingQuestions: read-only statement suppresses the write question", () => {
    const qs = buildClarifyingQuestions(
      "read the records and give me a summary, read-only, no changes",
      ["crm_note_write"],
    );
    expect(qs.map((q) => q.id)).not.toContain("write_permission");
  });

  it("buildClarifyingQuestions: a named trigger suppresses the trigger question", () => {
    const qs = buildClarifyingQuestions(
      "every hour, automatically check the page",
      ["page_monitor"],
    );
    expect(qs.map((q) => q.id)).not.toContain("run_trigger");
  });

  it("a fully-specified goal yields empty clarifying_questions on the real plan", () => {
    const r = plan(
      "Read new leads from my email inbox, draft a reply, update the CRM, notify Slack — a human must approve before anything is sent externally.",
    );
    expect(r.clarifying_questions).toEqual([]);
  });

  it("an under-specified goal yields ≤3 questions and surfaces them in the markdown", () => {
    const r = plan("go through my inbox and handle the sales leads automatically");
    expect(r.clarifying_questions.length).toBeGreaterThan(0);
    expect(r.clarifying_questions.length).toBeLessThanOrEqual(3);
    // each question appears in the Layer-1 markdown
    for (const q of r.clarifying_questions) {
      expect(r.summary_markdown).toContain(q.question);
    }
    expect(r.summary_markdown).toContain("Quick checks to pin down the plan");
  });

  it("clarifying_questions is stateless structured data (id/question/options)", () => {
    const r = plan("go through my inbox and handle the sales leads automatically");
    for (const q of r.clarifying_questions) {
      expect(typeof q.id).toBe("string");
      expect(typeof q.question).toBe("string");
      expect(Array.isArray(q.options)).toBe(true);
    }
  });
});

// MAR-226: standardized, machine-consumable next-action menu.
describe("planWorkflow — MAR-226 next-action menu", () => {
  const at = (goal: string, build_target?: "cowork" | "cursor" | "chatgpt_gpt" | "code") =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], build_target }, registry);

  it("every plan has a non-empty menu of {id,label,action} with stable ids", () => {
    const r = plan("read emails, detect leads and draft a reply for approval");
    expect(r.next_action_menu.length).toBeGreaterThan(0);
    for (const a of r.next_action_menu) {
      expect(typeof a.id).toBe("string");
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.action.length).toBeGreaterThan(0);
    }
    // always offers the drill-into-technical action mapped to output_depth
    const tech = r.next_action_menu.find((a) => a.id === "show_technical_plan");
    expect(tech).toBeDefined();
    expect(tech!.action).toContain('output_depth: "technical"');
  });

  it("build_target gates the build path (cowork → cowork prompt, cursor → build brief, gpt → gpt prompt)", () => {
    const cowork = at("read emails and draft a reply", "cowork").next_action_menu;
    expect(cowork.find((a) => a.id === "generate_prompt")!.label).toContain("CoWork");
    expect(cowork.find((a) => a.id === "export_build_brief")).toBeUndefined();

    const cursor = at("read emails and draft a reply", "cursor").next_action_menu;
    expect(cursor.find((a) => a.id === "export_build_brief")).toBeDefined();
    expect(cursor.find((a) => a.id === "generate_prompt")).toBeUndefined();

    const gpt = at("read emails and draft a reply", "chatgpt_gpt").next_action_menu;
    expect(gpt.find((a) => a.id === "generate_prompt")!.label).toContain("ChatGPT");
  });

  it("a playbook-backed plan offers open_playbook; a composed plan does not", () => {
    const pb = plan("scan a codebase, plan changes, edit code, run tests and write a PR summary");
    expect(pb.plan_source).toBe("playbook");
    const open = pb.next_action_menu.find((a) => a.id === "open_playbook");
    expect(open).toBeDefined();
    expect(open!.action).toContain(pb.playbook!.id);

    const composed = plan(
      "read emails, detect leads, research the sender company, write a CRM note and draft a follow-up with approval",
    );
    expect(composed.plan_source).toBe("composed");
    expect(composed.next_action_menu.find((a) => a.id === "open_playbook")).toBeUndefined();
  });

  it("the Layer-1 markdown renders the menu under 'Next — pick one'", () => {
    const r = plan("read emails and draft a reply for approval");
    expect(r.summary_markdown).toContain("**Next — pick one:**");
    for (const a of r.next_action_menu) {
      expect(r.summary_markdown).toContain(a.label);
    }
  });

  it("menu is tagged advisory; legacy suggested_next_actions stays for back-compat", () => {
    const r = plan("read emails and draft a reply for approval");
    expect(r.provenance.field_tags.next_action_menu).toBe("advisory");
    expect(Array.isArray(r.suggested_next_actions)).toBe(true);
    expect(r.suggested_next_actions.length).toBeGreaterThan(0);
  });
});

// MAR-148 item-2: the two approval-gate fields must not contradict each other.
// `enforced_approval_gates` = gates present in the route; `safety_review.
// approval_gates_required` = gates the review says are needed. When they differ
// it is a legible GAP (needed but not enforced), not a self-contradiction.
describe("planWorkflow — approval-gate field self-consistency (MAR-148)", () => {
  // A write goal that explicitly waives the gate (unattended) reproduces the
  // G2 shape: review still requires a gate, but the route does not enforce one.
  const g2 = plan(
    "When a Stripe webhook fires, update the customer LTV field in Airtable. " +
      "Runs unattended, no human in the loop.",
  );

  it("enforced_approval_gates exists and required_approval_gates is gone", () => {
    expect(Array.isArray(g2.enforced_approval_gates)).toBe(true);
    expect((g2 as Record<string, unknown>).required_approval_gates).toBeUndefined();
  });

  it("a required-but-unenforced gate renders as a ❌ gap in the header, not a contradiction", () => {
    // The two fields genuinely differ here (the point of the test) ...
    if (
      g2.enforced_approval_gates.length === 0 &&
      g2.safety_review.approval_gates_required.length > 0
    ) {
      const header = g2.summary_markdown.split("\n\n")[0];
      // ... and the header names the gap explicitly rather than claiming "none".
      expect(header).toContain("REQUIRED but NOT enforced");
      expect(header).not.toContain("approval:       ✅ none needed");
    }
  });

  it("an enforced gate reads as enforced, never as a missing requirement", () => {
    const r = plan(
      "start from a content brief, generate copy, design visuals, approve and publish to our blog",
    );
    expect(r.enforced_approval_gates).toContain("human_approval_gate");
    const header = r.summary_markdown.split("\n\n")[0];
    expect(header).toContain("✅ enforced — human_approval_gate");
    expect(header).not.toContain("REQUIRED but NOT enforced");
  });
});

// MAR-224: layered output_depth (guided/brief Layer-1 default → standard → technical/deep)
describe("planWorkflow — output_depth layering (MAR-224)", () => {
  const goal = "start from a content brief, generate copy, design visuals, approve and publish";

  it("brief (default) is concise: shorter than standard, shorter than technical", () => {
    const brief = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    const standard = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" }, registry);
    const technical = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "technical" }, registry);
    expect(brief.summary_markdown.length).toBeLessThan(standard.summary_markdown.length);
    expect(standard.summary_markdown.length).toBeLessThan(technical.summary_markdown.length);
  });

  it("default (no output_depth) renders the guided Layer-1 shape — no full step list", () => {
    const def = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
    const guided = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "guided" }, registry);
    expect(def.summary_markdown).toBe(guided.summary_markdown);
    expect(def.summary_markdown).not.toContain("**Steps:**");
    expect(def.summary_markdown).not.toContain("Model-tier profile");
  });

  it("brief shows the recommended route as a one-line chain, not numbered blocks", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    expect(r.summary_markdown).toContain("**Recommended:**");
    expect(r.summary_markdown).not.toContain("**Steps:**");
  });

  it("brief still returns the full recommended_route array in JSON", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    expect(r.recommended_route.length).toBeGreaterThan(0);
    for (const s of r.recommended_route) {
      expect(typeof s.component_id).toBe("string");
      expect(typeof s.component_name).toBe("string");
    }
  });

  it("brief on playbook path mentions the playbook id", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" }, registry);
    expect(r.plan_source).toBe("playbook");
    expect(r.summary_markdown).toContain(r.playbook!.id);
  });

  it("standard adds the numbered step list but withholds the technical block", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "standard" }, registry);
    expect(r.summary_markdown).toContain("**Steps:**");
    expect(r.summary_markdown).not.toContain("Model-tier profile");
  });

  it("technical includes the model-tier section", () => {
    const r = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], output_depth: "technical" }, registry);
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

describe("assessGoalInput — goal-guard (MAR-162)", () => {
  // ── must PASS: real plain-English goals (no false positives) ──
  const REAL_GOALS = [
    "read emails, detect sales leads, research the company and draft a reply for approval",
    "scan a codebase, plan changes, edit code, run tests and write a PR summary",
    "read my email inbox, classify intent, draft replies and calendar invites, and only send or book after approval",
    "Monitor a competitor's pricing page hourly and alert me on Slack when the price changes.",
    "Deduplicate records in a dataset.",
    "build an AI agent that reads emails and drafts replies",
    "create a pipeline that scrapes data, normalizes it, and validates the schema",
    "every morning at 8am, pull yesterday's signups from the database and post a summary to Slack",
    "when the user submits a form, validate it and send a confirmation email",
  ];

  for (const goal of REAL_GOALS) {
    it(`accepts a real goal: "${goal.slice(0, 40)}…"`, () => {
      expect(assessGoalInput(goal), goal).toEqual({ ok: true });
    });
  }

  // ── must BLOCK: echoed preamble / tool names / content-free asks ──
  const NON_GOALS = [
    "OrchestrateMCP is a workflow-design advisor. It helps you plan safer AI agent workflows.",
    "Before you plan: gather the user's constraints (read-only? unattended? outbound sends?).",
    "call plan_workflow with the user's goal in plain english",
    "Help the user design a safe AI workflow.",
    "plan a workflow",
    "design my agent",
    "build an automation",
    "I need a workflow",
    "what can you do",
    "workflow",
    // MAR-145 (ChatGPT dogfood): trailing filler used to dodge the guard.
    "Set up an agent workflow for me.",
    "build me an agent please",
  ];

  for (const goal of NON_GOALS) {
    it(`blocks a non-goal: "${goal.slice(0, 40)}…"`, () => {
      const a = assessGoalInput(goal);
      expect(a.ok, goal).toBe(false);
    });
  }

  it("buildNeedsGoalResult returns a needs_goal payload with an example", () => {
    const r = buildNeedsGoalResult("looks like preamble");
    expect(r.status).toBe("needs_goal");
    expect(r.reason).toBe("looks like preamble");
    expect(r.example.length).toBeGreaterThan(10);
    expect(r.summary_markdown).toContain("need the actual workflow goal");
    expect(r.summary_markdown).toContain(r.example);
  });
});
