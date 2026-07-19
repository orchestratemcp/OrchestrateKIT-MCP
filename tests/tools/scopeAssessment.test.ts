/**
 * MAR-386 — deterministic scope assessment (Small / Medium / Large).
 *
 * Scope is derived from the plan itself (runtime, clearance, connection count,
 * route shape) with no LLM — same discipline as coverage / automation_clearance.
 * These tests pin the classification across the canonical goals, prove the ⭐
 * recommendation shifts with scope, and prove the HARD design rule: scope never
 * gates capability — every A–E continuation option is present at every size.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(goal: string) {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
    registry,
  );
}

const SMALL_ONE_SHOT = "summarize my inbox for me now";
const SMALL_CONSTRAINED_ONE_SHOT =
  "Read my unread inbox now and give me a concise five-bullet summary in this chat. " +
  "This is read-only and attended: do not send, delete, archive, label, or modify any email; " +
  "do not create a scheduled or persistent agent.";
const MEDIUM_GMAIL_LEAD =
  "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.";
const MEDIUM_COMPETITOR =
  "Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.";
const MEDIUM_EMAIL_CALENDAR =
  "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
  "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
  "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
  "the email. I will be present for approval and I want visible run logs. " +
  "Keep it a private hold on my calendar and do not notify the other person.";
const LARGE_MULTI_AGENT =
  "Run a coder agent and a reviewer agent in a loop until all tests pass, maximum 5 iterations, then open a pull request for my approval.";

describe("MAR-386 — scope classification across S/M/L fixtures", () => {
  it("a one-shot attended task is SMALL — run it", () => {
    const r = plan(SMALL_ONE_SHOT);
    expect(r.scope_assessment.size).toBe("small");
    expect(r.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline).toBe(false);
    expect(r.scope_assessment.recommended_path.toLowerCase()).toContain("run it now");
    expect(r.scope_assessment.drivers.length).toBeGreaterThan(0);
  });

  it("honours negated durable intent on an explicit one-shot goal", () => {
    const r = plan(SMALL_CONSTRAINED_ONE_SHOT);
    const ids = r.recommended_route.map((step) => step.component_id);
    expect(r.scope_assessment.size).toBe("small");
    expect(r.goal_to_product_wizard.runtime_requirements.must_run_while_user_offline).toBe(false);
    expect(r.goal_to_product_wizard.recommended_next_click.id).toBe("dry_run_in_chat");
    expect(ids).not.toEqual(
      expect.arrayContaining(["scheduled_trigger", "state_store", "email_draft"]),
    );
  });

  it("the Gmail-lead / competitor / email-calendar dogfoods are MEDIUM — build it", () => {
    for (const goal of [MEDIUM_GMAIL_LEAD, MEDIUM_COMPETITOR, MEDIUM_EMAIL_CALENDAR]) {
      const r = plan(goal);
      expect(r.scope_assessment.size, goal.slice(0, 40)).toBe("medium");
    }
  });

  it("SendGrid (an optional sender) does not inflate the Gmail-lead into large", () => {
    // The route carries optional_email_send (SendGrid) as a 4th integration, but an
    // optional sender the user may never wire must not tip a 3-connection medium
    // plan over the >3 large threshold.
    const r = plan(MEDIUM_GMAIL_LEAD);
    expect(r.what_you_need.some((n) => n.component_id.startsWith("optional_"))).toBe(true);
    expect(r.scope_assessment.size).toBe("medium");
  });

  it("a multi-agent loop route is LARGE — plan it", () => {
    const r = plan(LARGE_MULTI_AGENT);
    expect(r.scope_assessment.size).toBe("large");
    expect(r.loop_guidance).not.toBeNull();
    expect(r.scope_assessment.drivers.join(" ").toLowerCase()).toContain("multi-agent");
    expect(r.scope_assessment.recommended_path.toLowerCase()).toContain("linear");
  });

  it("scope_assessment is tagged 'computed' in the provenance field tags", () => {
    expect(plan(SMALL_ONE_SHOT).provenance.field_tags.scope_assessment).toBe("computed");
  });

  it("every depth carries the same scope_assessment (it is plan-derived, not view-derived)", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      const r = planWorkflow(
        { goal: MEDIUM_GMAIL_LEAD, must_have_capabilities: [], must_avoid: [], output_depth: depth },
        registry,
      );
      expect(r.scope_assessment.size).toBe("medium");
    }
  });
});

describe("MAR-386 — the ⭐ recommendation is scope-aware", () => {
  it("SMALL → the attended dry run is the ⭐", () => {
    const w = plan(SMALL_ONE_SHOT).goal_to_product_wizard;
    expect(w.recommended_next_click.id).toBe("dry_run_in_chat");
    expect(w.recommended_next_click.action).toBe("assistant:attended_dry_run_in_chat");
  });

  it("MEDIUM → the attended dry run is the ⭐ (dry run first, then build)", () => {
    for (const goal of [MEDIUM_GMAIL_LEAD, MEDIUM_COMPETITOR]) {
      const w = plan(goal).goal_to_product_wizard;
      expect(w.recommended_next_click.id, goal.slice(0, 30)).toBe("dry_run_in_chat");
    }
  });

  it("LARGE → generating the plan as Linear issues is the ⭐ (existing export path)", () => {
    const w = plan(LARGE_MULTI_AGENT).goal_to_product_wizard;
    expect(w.recommended_next_click.id).toBe("generate_linear_project");
    // A real destination — the existing full-delivery Linear export, not a new tool.
    expect(w.recommended_next_click.action).toContain("export_build_brief");
    expect(w.recommended_next_click.action).toContain("'linear'");
    expect(w.recommended_next_click.action).toContain("delivery_mode: 'full'");
  });

  it("a pending clarifying question still outranks the scope ⭐", () => {
    // Same email/calendar goal WITHOUT the private-hold answer → the notification
    // question is open, so answering it is the ⭐ regardless of scope.
    const r = plan(
      "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
        "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
        "and only after I approve creates one Calendar event and one Gmail draft. Never send the email.",
    );
    expect(r.clarifying_questions.map((q) => q.id)).toContain("calendar_notification");
    expect(r.goal_to_product_wizard.recommended_next_click.id).toBe("answer_clarifying_questions");
  });
});

describe("MAR-386 — scope never gates capability (all options present at every size)", () => {
  const MENU_HEADER = "### How do you want to continue?";

  function menuLetters(md: string): string[] {
    const tail = md.slice(md.indexOf(MENU_HEADER));
    return (tail.match(/^[A-E]\) /gm) ?? []).map((s) => s.trim());
  }

  it("every size renders all five A–E continuation options", () => {
    for (const goal of [SMALL_ONE_SHOT, MEDIUM_GMAIL_LEAD, MEDIUM_COMPETITOR, LARGE_MULTI_AGENT]) {
      const md = plan(goal).summary_markdown;
      expect(menuLetters(md).length, goal.slice(0, 30)).toBe(5);
      // The attended dry run (E) is present at EVERY size — a large task can still
      // be dry-run, a small one can still be saved/built.
      expect(md).toMatch(/^E\) Run it attended in this chat now/m);
      // Plan export is present at every size too; large scope names the exact
      // Linear action while keeping the other destinations visible.
      expect(md).toMatch(
        /Save this plan to Linear \/ Obsidian \/ Notion|Generate this plan as Linear issues; Obsidian \/ Notion export remains available/,
      );
    }
  });

  it("exactly one menu option is marked Recommended, and it follows scope", () => {
    // small/medium → the dry run (E); large → the Linear/save option.
    const smallMd = plan(SMALL_ONE_SHOT).summary_markdown;
    expect(smallMd).toMatch(/^E\).*— Recommended$/m);

    const mediumMd = plan(MEDIUM_GMAIL_LEAD).summary_markdown;
    expect(mediumMd).toMatch(/^E\).*— Recommended$/m);
    expect(mediumMd).not.toMatch(/^C\).*Recommended$/m);

    const largeMd = plan(LARGE_MULTI_AGENT).summary_markdown;
    // The visible label names the same Linear-issues action as the machine click.
    expect(largeMd).toMatch(/Generate this plan as Linear issues.*— Recommended/);
    expect(largeMd).not.toMatch(/^E\).*— Recommended$/m);

    // Never more than one recommendation in a single menu.
    for (const md of [smallMd, mediumMd, largeMd]) {
      const tail = md.slice(md.indexOf(MENU_HEADER));
      const marks = (tail.match(/— Recommended/g) ?? []).length;
      expect(marks).toBe(1);
    }
  });

  it("the compact status header carries a scope chip", () => {
    expect(plan(SMALL_ONE_SHOT).summary_markdown.split("\n\n")[0]).toContain("Scope S (run it)");
    expect(plan(MEDIUM_GMAIL_LEAD).summary_markdown.split("\n\n")[0]).toContain("Scope M");
    expect(plan(LARGE_MULTI_AGENT).summary_markdown.split("\n\n")[0]).toContain("Scope L (plan it)");
  });
});
