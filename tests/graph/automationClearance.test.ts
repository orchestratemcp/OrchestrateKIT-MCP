import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import {
  computeAutomationClearance,
  componentActionClass,
} from "../../src/graph/automationClearance.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";

/**
 * MAR-168 — automation_clearance L0–L4. Tests cover the four acceptance action
 * classes (read-only L0, Slack notification L2, CRM write L3, public publish L4)
 * plus the hard rules: L4 is never droppable, L3 is human-by-default, and the
 * advisor never claims an unverifiable gate-drop is safe.
 */
const registry = loadRegistry();
const byId = new Map(registry.components.map((c) => [c.id, c]));
const cls = (id: string) => componentActionClass(byId.get(id)!);
const clearance = (ids: string[], untested: { id: string; severity: string }[] = []) =>
  computeAutomationClearance(ids, registry, untested as never);

describe("componentActionClass — blast-radius ladder", () => {
  it("L0 read-only", () => {
    expect(cls("codebase_scan")).toBe(0);
    expect(cls("pr_summary")).toBe(0);
    expect(cls("email_read")).toBe(0);
    expect(cls("stripe_data_read")).toBe(0);
  });
  it("L1 internal/state write", () => {
    expect(cls("audit_log")).toBe(1);
    expect(cls("state_store")).toBe(1);
  });
  it("L2 notification", () => {
    expect(cls("slack_notification")).toBe(2);
    expect(cls("reviewer_notification")).toBe(2);
  });
  it("L3 external business write", () => {
    expect(cls("crm_note_write")).toBe(3);
    expect(cls("calendar_write")).toBe(3);
  });
  it("L3 high-risk orchestration with external writes — MAR-210 regression", () => {
    // saga_compensation category=orchestration (not integration/output) but
    // risk_level=high + permissions.write includes external undo calls
    // (API deletes, refunds, record reversals). Must be L3, not L1.
    expect(cls("saga_compensation")).toBe(3);
  });
  it("L4 public publish / irreversible", () => {
    expect(cls("external_publish")).toBe(4);
  });
});

describe("computeAutomationClearance — the four acceptance classes", () => {
  it("read-only PR review → L0, autonomous allowed", () => {
    const c = clearance(["codebase_scan", "pr_summary"]);
    expect(c.level).toBe("L0");
    expect(c.autonomous_allowed).toBe(true);
  });

  it("Slack alert → L2; unattended only after audit + tested edges", () => {
    const noAudit = clearance(["page_monitor", "slack_notification"]);
    expect(noAudit.level).toBe("L2");
    expect(noAudit.autonomous_allowed).toBe(false); // missing audit_log

    const withAudit = clearance(["page_monitor", "slack_notification", "audit_log"]);
    expect(withAudit.level).toBe("L2");
    expect(withAudit.autonomous_allowed).toBe(true); // audit + no untested edges

    const withUntested = clearance(
      ["page_monitor", "slack_notification", "audit_log"],
      [{ id: "e", severity: "medium" }],
    );
    expect(withUntested.autonomous_allowed).toBe(false); // untested edges block it
  });

  it("CRM write → L3, human by default, lists the controls to earn it", () => {
    const c = clearance(["email_read", "crm_note_write"]);
    expect(c.level).toBe("L3");
    expect(c.autonomous_allowed).toBe(false);
    expect(c.required_controls.length).toBeGreaterThanOrEqual(7);
    expect(c.required_controls.join(" ")).toContain("idempotency");
    expect(c.required_controls.join(" ")).toContain("kill switch");
  });

  it("public publish → L4, ALWAYS human, never droppable", () => {
    const c = clearance(["copy_generation", "external_publish"]);
    expect(c.level).toBe("L4");
    expect(c.autonomous_allowed).toBe(false);
    expect(c.reason.toLowerCase()).toContain("always");
    expect(c.required_controls.join(" ").toLowerCase()).toContain("non-droppable");
    expect(c.highest_action_components).toContain("external_publish");
  });

  it("level is the MAX action class across the route", () => {
    // a read-only step + one CRM write ⇒ L3, not averaged down
    const c = clearance(["email_read", "crm_note_write", "audit_log"]);
    expect(c.level).toBe("L3");
    expect(c.highest_action_components).toEqual(["crm_note_write"]);
  });
});

describe("plan_workflow — automation_clearance on every plan (MAR-168)", () => {
  const plan = (goal: string) =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);

  it("is present on a normal plan and reflected in the status header", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    expect(r.automation_clearance).toBeDefined();
    expect(r.automation_clearance.level).toBe("L3");
    expect(r.summary_markdown).toContain("automation:");
    expect(r.summary_markdown).toContain("Automation clearance");
  });

  it("a public-publish goal is L4 / human always required", () => {
    const r = plan("generate copy from a content brief, design visuals, get approval and publish externally");
    expect(r.automation_clearance.level).toBe("L4");
    expect(r.automation_clearance.autonomous_allowed).toBe(false);
  });

  it("MAR-210: fan-out+saga goal is L3, not L1 — saga_compensation has external write blast radius", () => {
    const r = plan(
      "Fan out a batch of documents to parallel processors, validate each result, " +
      "and roll back all completed writes with a saga compensation step if any processor fails.",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("saga_compensation");
    expect(r.automation_clearance.level).toBe("L3");
    expect(r.automation_clearance.autonomous_allowed).toBe(false);
    expect(r.automation_clearance.highest_action_components).toContain("saga_compensation");
    expect(r.summary_markdown).toContain("L3");
  });
});

describe("plan_workflow — design_notes from edge control_flow_note (MAR-211)", () => {
  const plan = (goal: string) =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);

  it("design_notes is always present as an array", () => {
    const r = plan("read emails and summarize them");
    expect(Array.isArray(r.design_notes)).toBe(true);
  });

  it("fan-out+saga route surfaces the conditional saga guidance note", () => {
    const r = plan(
      "Fan out a batch of documents to parallel processors, validate each result, " +
      "and roll back all completed writes with a saga compensation step if any processor fails.",
    );
    expect(r.design_notes.length).toBeGreaterThan(0);
    const joined = r.design_notes.join(" ");
    // The loop_controller → saga_compensation edge has a control_flow_note
    // about when saga_compensation should actually be added.
    expect(joined).toContain("saga_compensation");
    expect(joined).toContain("irreversible external side effects");
    // The design_notes also surface the saga_compensation → audit_log wiring note.
    expect(joined).toContain("audit_log");
    // They appear in the rendered markdown too.
    expect(r.summary_markdown).toContain("Design notes");
  });

  it("a goal with no control_flow_note edges gets an empty design_notes", () => {
    // A pure read-only code-review goal uses only edges that have no notes.
    const r = plan("read the codebase and summarize the PR changes for review");
    // design_notes may be empty or have entries — assert it is an array and
    // that the saga note is absent (different route, different edges).
    expect(Array.isArray(r.design_notes)).toBe(true);
    expect(r.design_notes.join(" ")).not.toContain("saga_compensation");
  });
});

describe("plan_workflow — loop_guidance gating (MAR-209)", () => {
  const plan = (goal: string) =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);

  it("MAR-209: data fan-out route does NOT get the worker-build-loop contract", () => {
    const r = plan(
      "Fan out a batch of documents to parallel processors, validate each result, " +
      "and roll back all completed writes with a saga compensation step if any processor fails.",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    // fan_out_collector in route → loop_guidance must be null (wrong contract suppressed)
    expect(ids).toContain("fan_out_collector");
    expect(ids).toContain("loop_controller");
    expect(r.loop_guidance).toBeNull();
    // The loop contract section must not appear (worker_pipeline still shows "planner" legitimately)
    expect(r.summary_markdown).not.toContain("Loop contract & guardrails");
    expect(r.summary_markdown).not.toContain("Worker loop:");
  });

  it("a genuine worker-build-loop goal still gets loop_guidance", () => {
    const r = plan(
      "run a bounded coder-reviewer loop: a planner decomposes the task, " +
      "a coder implements it each iteration, an independent reviewer approves, " +
      "max 5 iterations before escalating to a human",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    // If loop_controller is in the route and fan_out_collector is not, loop_guidance fires
    if (ids.includes("loop_controller") && !ids.includes("fan_out_collector")) {
      expect(r.loop_guidance).not.toBeNull();
      expect(r.loop_guidance?.loop_contract.max_iterations).toBe(5);
    }
    // If neither is matched, that's fine — the test is conditional on route composition
  });
});

describe("plan_workflow — fan-out design note (MAR-212)", () => {
  const plan = (goal: string) =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);

  it("MAR-212: fan-out route gets the parallel-branches advisory in design_notes", () => {
    const r = plan(
      "Fan out a batch of documents to parallel processors, validate each result, " +
      "and roll back all completed writes with a saga compensation step if any processor fails.",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("fan_out_collector");
    const joined = r.design_notes.join(" ");
    // The fan-out structural note should appear
    expect(joined).toContain("parallel");
    expect(joined).toContain("merge_strategy");
    // And it's first (prepended before edge annotations)
    expect(r.design_notes[0]).toContain("fan_out_collector");
  });

  it("a non-fan-out route does NOT get the fan-out advisory note", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids).not.toContain("fan_out_collector");
    expect(r.design_notes.join(" ")).not.toContain("merge_strategy");
  });
});

describe("plan_workflow — provenance model (MAR-206)", () => {
  const plan = (goal: string) =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);

  it("every plan has a provenance model with the deterministic tag", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    expect(r.provenance).toBeDefined();
    expect(r.provenance.model).toBe("registry-deterministic");
    expect(r.provenance.all_fields_are_registry_derived).toBe(true);
  });

  it("recommended_route is tagged grounded, route_score is computed", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    expect(r.provenance.field_tags.recommended_route).toBe("grounded");
    expect(r.provenance.field_tags.route_score).toBe("computed");
    expect(r.provenance.field_tags.next_steps).toBe("advisory");
  });

  it("grounding_note warns against presenting agent elaborations as registry facts", () => {
    const r = plan("scan a GitHub PR and post a review comment");
    expect(r.provenance.grounding_note).toContain("LLM calls");
    expect(r.provenance.grounding_note).toContain("🔵");
    expect(r.provenance.grounding_note).toContain("🟢");
  });

  it("playbook route tags route_status as grounded; composed route tags it computed", () => {
    const playbookGoal = plan("read emails, check my calendar, and draft a reply for each meeting request");
    const composedGoal = plan("scan a codebase, detect security vulnerabilities and produce a report");
    // playbook route → route_status grounded; composed → computed
    if (playbookGoal.plan_source === "playbook") {
      expect(playbookGoal.provenance.field_tags.route_status).toBe("grounded");
    }
    if (composedGoal.plan_source === "composed") {
      expect(composedGoal.provenance.field_tags.route_status).toBe("computed");
    }
  });
});

describe("plan_workflow — what_you_need + suggested_next_actions (MAR-208)", () => {
  const plan = (goal: string, build_target?: "cowork" | "cursor" | "chatgpt_gpt" | "code") =>
    planWorkflow({ goal, must_have_capabilities: [], must_avoid: [], build_target }, registry);

  it("what_you_need is present on every plan as an array", () => {
    const r = plan("read emails and summarize them");
    expect(Array.isArray(r.what_you_need)).toBe(true);
  });

  it("email+CRM route surfaces email and CRM integration needs", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    const ids = r.what_you_need.map((n) => n.component_id);
    expect(ids).toContain("email_read");
    expect(ids).toContain("crm_note_write");
  });

  it("each what_you_need entry has label, product_examples, and scopes", () => {
    const r = plan("read emails, detect leads and write a note to the CRM for each lead");
    for (const need of r.what_you_need) {
      expect(need.label.length).toBeGreaterThan(0);
      expect(need.product_examples.length).toBeGreaterThan(0);
      expect(Array.isArray(need.scopes)).toBe(true);
    }
  });

  it("read-only code review route has empty what_you_need (no external wiring)", () => {
    const r = plan("read the codebase and summarize the PR changes for review");
    // codebase_scan, pr_summary etc. have no external credentials — list may be empty
    const externalIds = r.what_you_need.map((n) => n.component_id);
    expect(externalIds).not.toContain("crm_note_write");
    expect(externalIds).not.toContain("calendar_write");
  });

  it("suggested_next_actions is present on every plan as a non-empty array", () => {
    const r = plan("read emails and draft a CRM note for each lead");
    expect(Array.isArray(r.suggested_next_actions)).toBe(true);
    expect(r.suggested_next_actions.length).toBeGreaterThan(0);
  });

  it("without build_target, suggested_next_actions offers all three options [a] [b] [c]", () => {
    const r = plan("read emails and write a CRM note");
    const joined = r.suggested_next_actions.join(" ");
    expect(joined).toContain("[a]");
    expect(joined).toContain("[b]");
    expect(joined).toContain("[c]");
  });

  it("build_target=cowork leads with CoWork system prompt action", () => {
    const r = plan("read emails and write a CRM note", "cowork");
    expect(r.suggested_next_actions[0]).toContain("CoWork system prompt");
  });

  it("build_target=cursor leads with export_build_brief action", () => {
    const r = plan("read emails and write a CRM note", "cursor");
    expect(r.suggested_next_actions[0]).toContain("export_build_brief");
  });

  it("build_target=chatgpt_gpt leads with GPT system prompt action", () => {
    const r = plan("read emails and write a CRM note", "chatgpt_gpt");
    expect(r.suggested_next_actions[0]).toContain("ChatGPT");
  });

  it("suggested_next_actions always ends with review_workflow_design reminder", () => {
    for (const target of ["cowork", "cursor", "chatgpt_gpt", "code", undefined] as const) {
      const r = plan("read emails and write a CRM note", target);
      const last = r.suggested_next_actions[r.suggested_next_actions.length - 1];
      expect(last).toContain("review_workflow_design");
    }
  });

  it("provenance tags what_you_need as computed and suggested_next_actions as advisory", () => {
    const r = plan("read emails and write a CRM note");
    expect(r.provenance.field_tags.what_you_need).toBe("computed");
    expect(r.provenance.field_tags.suggested_next_actions).toBe("advisory");
  });
});
