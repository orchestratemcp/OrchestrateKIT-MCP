/**
 * MAR-396 — the no-code assistant-surface brief (Claude Cowork / a ChatGPT GPT).
 *
 * The bug this suite exists to prevent: `build_target: 'cowork'` used to produce
 * a brief byte-identical to `build_target: 'code'` — a repo-shaped artifact about
 * files, issue templates and `scripts/connect.mjs`, handed to a reader who has no
 * repo. The ⭐ pointed at Cowork (MAR-395) and the road wasn't built.
 *
 * These tests pin the two properties that matter: the assistant brief is a
 * DIFFERENT shape from the code brief, and it never leaks code-runtime
 * apparatus into instructions a no-code user is meant to paste verbatim.
 */
import { describe, it, expect } from "vitest";
import { exportBuildBrief } from "../../src/tools/exportBuildBrief.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";

const registry = loadRegistry();

const SMALL_ATTENDED = "Summarize my inbox now";
const GATED_WRITE_PATH =
  "Draft replies to incoming Gmail leads, update HubSpot, and alert sales in Slack only after I approve";

function briefFor(goal: string, build_target: "cowork" | "chatgpt_gpt" | "code" | "cursor") {
  const plan = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
  const out = exportBuildBrief({
    goal: plan.goal,
    plan_source: plan.plan_source,
    route_status: plan.route_status,
    recommended_route: plan.recommended_route,
    safety_review: plan.safety_review,
    automation_clearance: plan.automation_clearance,
    enforced_approval_gates: plan.enforced_approval_gates,
    untested_edges: plan.untested_edges,
    avoid_when_violations: plan.avoid_when_violations,
    evals_to_add: plan.evals_to_add,
    design_notes: plan.design_notes,
    worker_pipeline: plan.worker_pipeline,
    loop_guidance: plan.loop_guidance,
    approval_gate_advisory: plan.approval_gate_advisory,
    handoff_targets: ["prompt"],
    delivery_mode: "compact",
    llm_provider: "anthropic",
    build_target,
  });
  return (out as { handoffs: { prompt?: string } }).handoffs.prompt ?? "";
}

describe("MAR-396 — the assistant-surface brief is its own shape", () => {
  it("no longer returns the code brief for build_target 'cowork'", () => {
    // The exact regression: these were byte-identical before MAR-396.
    const cowork = briefFor(SMALL_ATTENDED, "cowork");
    const code = briefFor(SMALL_ATTENDED, "code");
    expect(cowork).not.toBe(code);
    expect(cowork.length).toBeGreaterThan(code.length);
  });

  it("names the surface the caller actually selected, and only that one", () => {
    const cowork = briefFor(SMALL_ATTENDED, "cowork");
    expect(cowork).toContain("Claude Cowork");
    expect(cowork).not.toMatch(/ChatGPT/i);

    const gpt = briefFor(SMALL_ATTENDED, "chatgpt_gpt");
    expect(gpt).toContain("ChatGPT GPT");
    expect(gpt).not.toMatch(/Cowork/i);
  });

  it("code targets are untouched — they still get the code brief", () => {
    for (const target of ["code", "cursor"] as const) {
      expect(briefFor(SMALL_ATTENDED, target), target).not.toMatch(/Assistant setup/);
    }
  });

  it("carries the sections a no-code builder actually needs", () => {
    const md = briefFor(SMALL_ATTENDED, "cowork");
    expect(md).toContain("## What this assistant does");
    expect(md).toContain("## How it works, every time it runs");
    expect(md).toContain("## Connect these first");
    expect(md).toContain("## Ask me before you act");
    expect(md).toContain("## Never do this");
    expect(md).toContain("## When you're not sure");
    expect(md).toContain("## You're done when");
  });

  // The core anti-regression: repo apparatus must not leak into instructions a
  // no-code user pastes verbatim. Each of these WAS present in the old output.
  it("leaks no code-runtime apparatus into the pasted instructions", () => {
    for (const goal of [SMALL_ATTENDED, GATED_WRITE_PATH]) {
      const md = briefFor(goal, "cowork");
      expect(md, goal).not.toMatch(/scripts\/connect\.mjs/);
      expect(md, goal).not.toMatch(/files_likely_affected/i);
      expect(md, goal).not.toMatch(/record_session_feedback/);
      expect(md, goal).not.toMatch(/artifact compiler/i);
      expect(md, goal).not.toMatch(/Linear issue template/i);
      expect(md, goal).not.toMatch(/in the built repo/i);
    }
  });

  it("names gated ACTIONS in plain language, never a raw component id", () => {
    const md = briefFor(GATED_WRITE_PATH, "cowork");
    expect(md).toContain("## Ask me before you act");
    // `human_approval_gate` is an internal registry handle — meaningless to the
    // reader, and it used to be rendered verbatim as the gate bullet.
    const gateBlock = md.slice(
      md.indexOf("## Ask me before you act"),
      md.indexOf("## Never do this"),
    );
    expect(gateBlock).not.toMatch(/^- human_approval_gate$/m);
    expect(gateBlock).toMatch(/CRM Note Write|Optional Email Send/);
  });

  it("frames code-runtime controls honestly and flags MISSING ones", () => {
    const md = briefFor(GATED_WRITE_PATH, "cowork");
    // Controls like "rollback / compensation — MISSING, add saga_compensation"
    // are real plan facts, but a Cowork user cannot action them. They must be
    // framed as a judgement aid, not as a to-do list.
    expect(md).toContain("Controls this plan assumes");
    expect(md).toMatch(/no direct equivalent in Claude Cowork/);
    expect(md).toMatch(/⚠️.*MISSING/);
    expect(md).toMatch(/build it as code instead/);
  });

  it("states the approval posture for an ungated read-only plan", () => {
    const md = briefFor(SMALL_ATTENDED, "cowork");
    expect(md).toMatch(/Nothing in this plan requires approval/);
    expect(md).toContain("L0");
  });

  it("uses an assistant-shaped Definition of Done, not the code §8 checklist", () => {
    const md = briefFor(SMALL_ATTENDED, "cowork");
    const done = md.slice(md.indexOf("## You're done when"));
    expect(done).toMatch(/run it once on real data/i);
    // §8's code-only gates must not appear.
    expect(done).not.toMatch(/idempotency/i);
    expect(done).not.toMatch(/kill switch/i);
    expect(done).not.toMatch(/connect\.mjs/);
  });

  it("makes no availability claim about the surface", () => {
    // The product cannot verify the user has Cowork; the brief must not imply it.
    expect(briefFor(SMALL_ATTENDED, "cowork")).toMatch(/cannot verify that Claude Cowork is available/);
  });

  it("is deterministic across repeated exports", () => {
    expect(briefFor(GATED_WRITE_PATH, "cowork")).toBe(briefFor(GATED_WRITE_PATH, "cowork"));
  });
});

describe("MAR-396 — the wizard points at the generator that now exists", () => {
  it("the cowork / gpt build choices call export_build_brief with their target", () => {
    const plan = planWorkflow(
      { goal: SMALL_ATTENDED, must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const choices = plan.goal_to_product_wizard.build_choices;
    const cowork = choices.find((c) => c.id === "cowork");
    const gpt = choices.find((c) => c.id === "gpt_agents");
    // These were bare `assistant:generate_*` directives with nothing behind them.
    expect(cowork?.action).toContain("export_build_brief");
    expect(cowork?.action).toContain("build_target: 'cowork'");
    expect(gpt?.action).toContain("export_build_brief");
    expect(gpt?.action).toContain("build_target: 'chatgpt_gpt'");
  });

  it("the ⭐ resolves to a real export call once a surface is known", () => {
    for (const [build_target, expected] of [
      ["cowork", "build_target: 'cowork'"],
      ["chatgpt_gpt", "build_target: 'chatgpt_gpt'"],
    ] as const) {
      const plan = planWorkflow(
        { goal: SMALL_ATTENDED, must_have_capabilities: [], must_avoid: [], build_target },
        registry,
      );
      const click = plan.goal_to_product_wizard.recommended_next_click;
      expect(click.id).toBe("build_in_assistant");
      expect(click.action).toContain("export_build_brief");
      expect(click.action).toContain(expected);
    }
  });
});
