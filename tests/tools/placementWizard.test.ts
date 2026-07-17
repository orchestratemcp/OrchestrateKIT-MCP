import { describe, expect, it } from "vitest";
import {
  planWorkflow,
  type GoalToProductWizard,
  type PlacementAxis,
  type RuntimeOption,
} from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

const PROMPT_A =
  "I want an assistant that looks at my Gmail for meeting requests, checks my calendar, " +
  "suggests two times, and after I approve it creates the calendar invite and leaves a reply " +
  "in my Gmail drafts. I do not want it to send anything without me.";
const PROMPT_B =
  "Watch five competitor product pages every morning and tell our team in Slack when a price " +
  "changes. I want it to keep working when my computer is off.";
const PROMPT_C =
  "When I ask in chat, summarize the documents I select. Never run in the background and never change the documents.";

function plan(goal: string, output_depth: "guided" | "brief" | "standard" | "technical" | "deep" = "guided") {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth },
    registry,
  );
}

function expectCompleteSurface(axis: PlacementAxis) {
  for (const option of [axis.recommended, ...axis.alternatives]) {
    expect(option.label).not.toBe("");
    expect(option.appropriate_when).not.toBe("");
    expect(option.limitation).not.toBe("");
    expect(["available now", "requires setup", "planned", "advanced"]).toContain(option.availability);
  }
}

function expectCompleteRuntime(option: RuntimeOption) {
  expect(option.runtime_class).not.toBe("");
  expect(option.reason).not.toBe("");
  expect(option.offline_behavior).not.toBe("");
  expect(option.limitation).not.toBe("");
  expect(["available now", "requires setup", "planned", "advanced"]).toContain(option.availability);
}

function snapshotContract(wizard: GoalToProductWizard) {
  return {
    runtime_requirements: wizard.runtime_requirements,
    runtime_recommendation: wizard.runtime_recommendation,
    runtime_alternatives: wizard.runtime_alternatives,
    control_surface: wizard.control_surface,
    interaction_surface: wizard.interaction_surface,
    trigger_explanation: wizard.trigger_explanation,
    recommended_setup: wizard.recommended_setup,
    recommended_next_click: wizard.recommended_next_click,
  };
}

describe("MAR-378 — corrected runtime-fit wizard", () => {
  it("Prompt A selects a durable background runtime with provider-neutral approvals", () => {
    const result = plan(PROMPT_A);
    const wizard = result.goal_to_product_wizard;
    expect(wizard.runtime_recommendation.runtime_class).toBe("managed_durable_background");
    expect(wizard.runtime_requirements).toMatchObject({
      persistent_state_needed: true,
      durable_approval_needed: true,
      must_run_while_user_offline: true,
      estimated_operational_complexity: "high",
    });
    expect(wizard.control_surface.recommended.id).toBe("provider_neutral_approval_inbox");
    expect(wizard.interaction_surface.recommended.id).toBe("approval_inbox_interaction");
    expect(wizard.trigger_explanation.label).toContain("Gmail");
    expect(wizard.recommended_setup.action).toBeNull();
    expect(wizard.recommended_setup.blocker).toContain("MCP worker is stateless");
    // Prompt A asks for "the calendar invite" AND says "I do not want it to send
    // anything without me" — an invite is a send, so the notification fork is
    // open and pickRecommendedNextClick puts answering it ahead of runtime prep
    // (the standing rule for any clarifying question, not new behavior here).
    // MAR-378's runtime-fit contract above is unchanged; only the next click is.
    expect(result.clarifying_questions.map((q) => q.id)).toContain("calendar_notification");
    expect(wizard.recommended_next_click.id).toBe("answer_clarifying_questions");
    expect(result.summary_markdown).toContain("Managed background worker / durable workflow");
    expect(result.summary_markdown).toContain("provider-neutral");
    expect(result.summary_markdown).toContain("Email sending: excluded per your constraint");
    expect(result.summary_markdown).not.toContain("Email Send (disabled for this goal)");
    expect(result.summary_markdown).not.toContain("Use recommended setup");
    expect(result.summary_markdown).not.toContain("localhost");
  });

  it("Prompt B selects a managed scheduled job, not an always-on worker", () => {
    const result = plan(PROMPT_B);
    const wizard = result.goal_to_product_wizard;
    expect(wizard.runtime_recommendation.runtime_class).toBe("managed_scheduled_job");
    expect(wizard.runtime_recommendation.label).toBe("Managed scheduled job");
    expect(wizard.runtime_requirements.operation_mode).toBe("scheduled");
    expect(wizard.runtime_requirements.persistent_state_needed).toBe(true);
    expect(wizard.control_surface.recommended.id).toBe("provider_neutral_approval_inbox");
    expect(wizard.interaction_surface.recommended.id).toBe("slack_interaction");
    expect(wizard.interaction_surface.recommended.limitation).toContain(
      "approve every post or automate low-risk alerts",
    );
    expect(wizard.runtime_alternatives.map((option) => option.runtime_class)).not.toContain(
      "managed_durable_background",
    );
    expect(result.summary_markdown).toContain("Slack is an interaction surface, not hosting");
    expect(result.summary_markdown).not.toContain("Always-on managed runner");
    expect(result.summary_markdown).not.toContain("Use recommended setup");
  });

  it("Prompt C selects the current client/chat runtime with no background trigger", () => {
    const result = plan(PROMPT_C);
    const wizard = result.goal_to_product_wizard;
    expect(wizard.runtime_recommendation.runtime_class).toBe("client_chat");
    expect(wizard.runtime_requirements).toMatchObject({
      trigger_mode: "interactive",
      operation_mode: "interactive",
      must_run_while_user_offline: false,
      estimated_operational_complexity: "low",
    });
    expect(wizard.control_surface.recommended.id).toBe("client_control");
    expect(wizard.interaction_surface.recommended.id).toBe("client_interaction");
    expect(wizard.trigger_explanation.what_wakes_it_up).toContain("Nothing runs until the user asks");
    expect(result.summary_markdown).toContain("Client/chat runtime");
    expect(result.summary_markdown).not.toContain("Managed scheduled job");
    expect(result.summary_markdown).not.toContain("background worker");
  });

  it("all three prompts receive different runtime classes and complete option metadata", () => {
    const results = [PROMPT_A, PROMPT_B, PROMPT_C].map((goal) => plan(goal));
    expect(new Set(results.map((result) => result.goal_to_product_wizard.runtime_recommendation.runtime_class)).size).toBe(3);
    for (const result of results) {
      const wizard = result.goal_to_product_wizard;
      expectCompleteRuntime(wizard.runtime_recommendation);
      wizard.runtime_alternatives.forEach(expectCompleteRuntime);
      expect(wizard.runtime_alternatives.length).toBeGreaterThanOrEqual(2);
      expect(wizard.runtime_alternatives.length).toBeLessThanOrEqual(3);
      expectCompleteSurface(wizard.control_surface);
      expectCompleteSurface(wizard.interaction_surface);
      expect(wizard.control_surface.recommended.id).not.toContain("dash");
      expect(wizard.interaction_surface.recommended.id).not.toContain("dash");
      const websiteBroker = wizard.control_surface.alternatives.find(
        (option) => option.id === "website_install_broker",
      );
      expect(websiteBroker?.limitation).toContain(
        "does not execute agents without a separate real runner",
      );
      expect(wizard.recommended_setup.action).toBeNull();
      expect(wizard.recommended_setup.blocker).toContain("MCP worker is stateless");
      expect(result.summary_markdown).not.toContain("Use recommended setup");
    }
  });

  it("keeps runtime-fit detail in guided through deep output", () => {
    for (const depth of ["guided", "brief", "standard"] as const) {
      expect(plan(PROMPT_A, depth).summary_markdown).toContain("Recommended runtime setup");
    }
    for (const depth of ["technical", "deep"] as const) {
      const result = plan(PROMPT_A, depth);
      expect(result.summary_markdown).toContain("### Runtime-fit setup");
      expect(result.summary_markdown).toContain("### Model-tier profile");
      expect(result.summary_markdown).toContain("### Credentials & permissions");
      expect(result.goal_to_product_wizard.build_choices.length).toBeGreaterThan(0);
    }
  });

  it("locks the corrected three-prompt runtime contracts", () => {
    expect({
      prompt_a: snapshotContract(plan(PROMPT_A).goal_to_product_wizard),
      prompt_b: snapshotContract(plan(PROMPT_B).goal_to_product_wizard),
      prompt_c: snapshotContract(plan(PROMPT_C).goal_to_product_wizard),
    }).toMatchSnapshot();
  });
});
