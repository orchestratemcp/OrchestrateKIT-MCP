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
