import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ARTIFACT_ISSUE_FIELD_ORDER,
  exportBuildBrief,
  InputShape,
} from "../../src/tools/exportBuildBrief.js";
import { ExportBuildBriefOutputShape } from "../../src/tools/outputSchemas.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";

const registry = loadRegistry();
const InputSchema = z.object(InputShape);

/** Run plan_workflow and pipe result straight into export_build_brief. */
function planAndBrief(
  goal: string,
  handoff_targets: ("prompt" | "linear" | "obsidian")[] = ["prompt"],
) {
  const plan = planWorkflow({ goal, must_have_capabilities: [], must_avoid: [] }, registry);
  return exportBuildBrief({
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
    handoff_targets,
  });
}

describe("export_build_brief — structure (MAR-205)", () => {
  it("returns all 9 sections + brief_markdown + provenance_tag", () => {
    const b = planAndBrief("read emails, detect leads and write a note to the CRM for each lead");
    expect(b.brief_markdown).toBeTruthy();
    expect(b.provenance_tag).toBe("registry-grounded");
    expect(b.sections.s0_constraints).toBeTruthy();
    expect(b.sections.s1_summary).toBeTruthy();
    expect(b.sections.s2_route).toBeTruthy();
    expect(b.sections.s3_worker_contracts).toBeTruthy();
    expect(b.sections.s5_safety).toBeTruthy();
    expect(b.sections.s6_do_not_add).toBeTruthy();
    expect(b.sections.s7_review_loopback).toBeTruthy();
    expect(b.sections.s8_definition_of_done).toBeTruthy();
  });

  it("brief_markdown is provenance-tagged at the top", () => {
    const b = planAndBrief("scan a GitHub PR and post a review comment read-only");
    expect(b.brief_markdown).toContain("🟢");
    expect(b.brief_markdown).toContain("🔵");
    expect(b.brief_markdown).toContain("registry-grounded");
  });

  it("grounding_note mentions no LLM calls", () => {
    const b = planAndBrief("read emails, detect leads and write a note to the CRM for each lead");
    expect(b.grounding_note).toContain("no LLM calls");
    expect(b.grounding_note).toContain("🟢");
  });
});

/**
 * MCP tool ZOD schema regression (found live, 2026-07-05, deployed build
 * 555705d0). `exportBuildBrief()` the core function is called directly by
 * every test above — it bypasses the InputShape validation the MCP tool
 * wrapper (registerExportBuildBrief) actually enforces on the wire. That gap
 * let a real incompatibility ship: MAR-256 made plan_workflow.worker_pipeline
 * `null` at guided/brief/standard depth (not just omitted), but MAR-255's
 * exportBuildBrief input schema only accepted an object or `undefined` —
 * a straight pass-through of a default-depth plan into export_build_brief
 * failed with "Expected object, received null" on live. Assert against the
 * ACTUAL exported zod schema so this class of gap can't recur silently.
 */
describe("export_build_brief — input schema accepts plan_workflow's literal outputs (MAR-256/255 integration)", () => {
  it("accepts worker_pipeline: null (the default-depth plan_workflow shape)", () => {
    const plan = planWorkflow(
      { goal: "read emails, detect leads and write a note to the CRM for each lead", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    expect(plan.worker_pipeline).toBeNull(); // sanity: default depth is null (MAR-256)
    const parsed = InputSchema.safeParse({
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
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("still accepts worker_pipeline entirely omitted (back-compat)", () => {
    const parsed = InputSchema.safeParse({
      goal: "x".repeat(10),
      plan_source: "composed",
      route_status: "candidate",
      recommended_route: [{ step: 1, component_id: "email_read" }],
      safety_review: { status: "pass", risk_score: 0 },
      automation_clearance: { level: "L0", autonomous_allowed: true, reason: "x" },
      handoff_targets: ["prompt"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("export_build_brief — §0 constraints (MAR-205, shared detection MAR-255)", () => {
  it("detects explicit read-only constraint", () => {
    const b = planAndBrief("scan a GitHub PR, read-only, never write anything");
    expect(b.sections.s0_constraints).toContain("read-only");
  });

  it("detects unattended constraint", () => {
    const b = planAndBrief(
      "fan out documents to processors and roll back if any fail, fully automated, no human in the loop",
    );
    expect(b.sections.s0_constraints).toContain("unattended");
  });

  it("states 'no constraint detected' when goal has none", () => {
    const b = planAndBrief("read emails and draft a CRM note for each lead");
    expect(b.sections.s0_constraints).toContain("No explicit");
  });

  // MAR-255 acceptance 1: the G1 audit goal — the brief used to open with
  // "No explicit … constraint detected" on it (live, 2026-07-01) while the
  // planner had already enforced the gate on the same phrasing.
  it("G1 audit goal → §0 lists draft-only + attended with trigger phrases", () => {
    const b = planAndBrief(
      "Every morning, read unread customer support emails, classify them by urgency, and draft " +
        "replies for my approval — never send anything automatically. A human reviews every draft.",
    );
    expect(b.sections.s0_constraints).toContain("draft-only");
    expect(b.sections.s0_constraints).toContain('trigger: "never send anything automatically"');
    expect(b.sections.s0_constraints).toContain("attended");
    expect(b.sections.s0_constraints).toContain('trigger: "for my approval"');
    expect(b.sections.s0_constraints).not.toContain("No explicit");
  });

  it("conflicting constraints are both listed with a ⚠️ marker (MAR-255)", () => {
    const b = planAndBrief(
      "Runs unattended on a schedule, but a human reviews every draft before it goes out",
    );
    expect(b.sections.s0_constraints).toContain("Conflicting constraints");
    expect(b.sections.s0_constraints).toContain("unattended");
    expect(b.sections.s0_constraints).toContain("attended");
  });
});

describe("export_build_brief — §3/§4 round-trip inputs + numbering (MAR-255)", () => {
  const GOAL = "read emails, detect leads and write a note to the CRM for each lead";

  it("omitting worker_pipeline yields the pointer line, not 'No worker pipeline in registry'", () => {
    // default-depth plan → worker_pipeline null (MAR-256), so the brief must
    // point at the round-trip instead of making a false registry claim.
    const b = planAndBrief(GOAL);
    expect(b.sections.s3_worker_contracts).toContain("Not included in this call");
    expect(b.sections.s3_worker_contracts).toContain("output_depth");
    expect(b.sections.s3_worker_contracts).not.toContain("No worker pipeline in registry");
  });

  it("passing worker_pipeline from a technical-depth plan renders the §3 contracts", () => {
    const plan = planWorkflow(
      { goal: GOAL, must_have_capabilities: [], must_avoid: [], output_depth: "technical" },
      registry,
    );
    expect(plan.worker_pipeline).not.toBeNull();
    const b = exportBuildBrief({
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
    });
    expect(b.sections.s3_worker_contracts).toContain("Pipeline:");
    expect(b.sections.s3_worker_contracts).toContain("`planner`");
    expect(b.sections.s3_worker_contracts).toContain("`tester`");
  });

  it("§4 always renders — an explicit 'no loop' line instead of a §3→§5 numbering hole", () => {
    const b = planAndBrief(GOAL);
    expect(b.sections.s4_loop_contract).toContain("§4 Loop contract");
    expect(b.sections.s4_loop_contract).toContain("No loop in this plan");
    // the assembled brief has continuous numbering
    expect(b.brief_markdown).toContain("§3");
    expect(b.brief_markdown).toContain("§4");
    expect(b.brief_markdown).toContain("§5");
  });
});

describe("export_build_brief — §2 route is grounded (MAR-205 + MAR-206)", () => {
  it("s2_route contains component IDs from the plan", () => {
    const plan = planWorkflow(
      { goal: "read emails, detect leads and write a note to the CRM for each lead", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const brief = exportBuildBrief({
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
    });
    for (const step of plan.recommended_route) {
      expect(brief.sections.s2_route).toContain(step.component_id);
    }
  });

  it("s2_route labels are 🟢 grounded in the header", () => {
    const b = planAndBrief("read emails and draft a CRM note for each lead");
    expect(b.sections.s2_route).toContain("🟢");
  });

  it("design_notes from MAR-211/212 appear in s2_route when present", () => {
    const b = planAndBrief(
      "fan out a batch of documents to parallel processors and roll back with saga compensation",
    );
    // design_notes include the fan-out note (MAR-212) — should surface in s2
    if (b.sections.s2_route.includes("Design notes")) {
      expect(b.sections.s2_route).toContain("parallel");
    }
  });
});

describe("export_build_brief — §4 loop contract (MAR-205, always rendered since MAR-255)", () => {
  it("s4_loop_contract is the explicit 'no loop' line for non-loop routes", () => {
    const b = planAndBrief("read emails, detect leads and write a CRM note");
    expect(b.sections.s4_loop_contract).toContain("No loop in this plan");
    expect(b.sections.s4_loop_contract).not.toContain("max_iterations");
  });

  it("fan-out route does NOT get the worker-build-loop contract (MAR-209 integration)", () => {
    const b = planAndBrief(
      "fan out a batch of documents to parallel processors, validate each, " +
      "roll back with saga compensation if any fails",
    );
    // loop_guidance is null for fan-out routes (MAR-209) — §4 renders the
    // explicit absence line, never the bounded-iteration contract.
    expect(b.sections.s4_loop_contract).toContain("No loop in this plan");
    expect(b.sections.s4_loop_contract).not.toContain("max_iterations");
  });
});

describe("export_build_brief — §5 safety (MAR-205)", () => {
  it("L3 CRM route has clearance level in §5 and DoD gate in §8", () => {
    const b = planAndBrief("read emails, detect leads and write a note to the CRM for each lead");
    expect(b.sections.s5_safety).toContain("L3");
    expect(b.sections.s8_definition_of_done).toContain("L3");
  });

  it("untested edges appear as risk questions in §5", () => {
    // Force an untested edge by passing one manually
    const plan = planWorkflow(
      { goal: "read emails and write a CRM note", must_have_capabilities: [], must_avoid: [] },
      registry,
    );
    const brief = exportBuildBrief({
      goal: plan.goal,
      plan_source: plan.plan_source,
      route_status: plan.route_status,
      recommended_route: plan.recommended_route,
      safety_review: plan.safety_review,
      automation_clearance: plan.automation_clearance,
      enforced_approval_gates: plan.enforced_approval_gates,
      untested_edges: [{ id: "email_read__produces__crm_note_write", severity: "high" }],
      avoid_when_violations: plan.avoid_when_violations,
      evals_to_add: plan.evals_to_add,
      design_notes: plan.design_notes,
      worker_pipeline: plan.worker_pipeline,
      loop_guidance: plan.loop_guidance,
      approval_gate_advisory: plan.approval_gate_advisory,
      handoff_targets: ["prompt"],
    });
    expect(brief.sections.s5_safety).toContain("email_read__produces__crm_note_write");
    expect(brief.sections.s5_safety).toContain("HIGH");
    expect(brief.sections.s8_definition_of_done).toContain("high-severity");
  });
});

describe("export_build_brief — §8 definition of done (MAR-205)", () => {
  it("validated playbook route checks route box", () => {
    const b = planAndBrief("read emails, check my calendar and draft a reply for each meeting request");
    if (b.sections.s1_summary.includes("validated")) {
      expect(b.sections.s8_definition_of_done).toContain("[x] Route is validated");
    }
  });

  it("always includes the five operational gates", () => {
    const b = planAndBrief("read emails and draft a CRM note");
    const dod = b.sections.s8_definition_of_done;
    expect(dod).toContain("least-privilege");
    expect(dod).toContain("Dry-run");
    expect(dod).toContain("Idempotency");
    expect(dod).toContain("Kill switch");
    expect(dod).toContain("Audit log");
  });
});

describe("export_build_brief — handoff targets (MAR-205)", () => {
  it("prompt handoff is present when requested", () => {
    const b = planAndBrief("read emails and draft a CRM note", ["prompt"]);
    expect(b.handoffs.prompt).toBeTruthy();
    expect(b.handoffs.linear).toBeUndefined();
    expect(b.handoffs.obsidian).toBeUndefined();
  });

  it("linear handoff is present when requested", () => {
    const b = planAndBrief("read emails and draft a CRM note", ["linear"]);
    expect(b.handoffs.linear).toContain("## Build brief");
    expect(b.handoffs.linear).toContain("Generated by OrchestrateMCP");
  });

  it("obsidian handoff has YAML frontmatter", () => {
    const b = planAndBrief("read emails and draft a CRM note", ["obsidian"]);
    expect(b.handoffs.obsidian).toContain("tags: [orchestratekit");
    expect(b.handoffs.obsidian).toContain("plan_source:");
  });

  it("multiple targets can be requested at once", () => {
    const b = planAndBrief("read emails and draft a CRM note", ["prompt", "linear", "obsidian"]);
    expect(b.handoffs.prompt).toBeTruthy();
    expect(b.handoffs.linear).toBeTruthy();
    expect(b.handoffs.obsidian).toBeTruthy();
  });
});

describe("export_build_brief delivery contract (PKG-W0-BRIEF-SIZE)", () => {
  const GOAL =
    "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.";

  function deliveryPair() {
    const plan = planWorkflow(
      { goal: GOAL, must_have_capabilities: [], must_avoid: [], output_depth: "technical" },
      registry,
    );
    const handoffTargets: ("prompt" | "linear" | "obsidian")[] = ["prompt", "linear", "obsidian"];
    const input = {
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
      handoff_targets: handoffTargets,
      generated_at: "2026-07-13T00:00:00.000Z",
    };
    return {
      omitted: exportBuildBrief(input),
      compact: exportBuildBrief({ ...input, delivery_mode: "compact" }),
      full: exportBuildBrief({ ...input, delivery_mode: "full" }),
    };
  }

  it("keeps omission backward-compatible with full delivery", () => {
    const { omitted, full } = deliveryPair();
    expect(omitted.delivery.mode).toBe("full");
    expect(omitted.artifact_package).toEqual(full.artifact_package);
    expect(omitted.brief_markdown).toBe(full.brief_markdown);
    expect(omitted.handoffs).toEqual(full.handoffs);
  });

  it("compact omits only the large artifact package and duplicated handoffs", () => {
    const { compact, full } = deliveryPair();
    expect(compact).not.toHaveProperty("artifact_package");
    expect(compact.delivery.omitted_fields).toContain("artifact_package");
    expect(compact.delivery.artifact_fingerprint).toBe(full.delivery.artifact_fingerprint);
    expect(compact.delivery.artifact_bytes).toBe(full.delivery.artifact_bytes);
    expect(compact.artifact_index).toEqual(full.artifact_index);
    expect(compact.sections).toEqual(full.sections);
    expect(compact.agent_manifest).toEqual(full.agent_manifest);
    expect(compact.connect).toEqual(full.connect);
  });

  it("keeps safety, Definition of Done, Connect, and deterministic full replay inline", () => {
    const { compact } = deliveryPair();
    expect(compact.brief_markdown).toContain(compact.sections.s5_safety);
    expect(compact.brief_markdown).toContain(compact.sections.s8_definition_of_done);
    expect(compact.brief_markdown).toContain(compact.sections.s11_connect);
    expect(compact.brief_markdown).toContain(compact.delivery.full_request.instruction);
    expect(compact.connect.connect_script).toBeTruthy();
    expect(compact.agent_manifest).toBeTruthy();
  });

  it("keeps the canonical compact response below 90 KB and at least 4x smaller", () => {
    const { compact, full } = deliveryPair();
    const compactBytes = new TextEncoder().encode(JSON.stringify(compact)).byteLength;
    const fullBytes = new TextEncoder().encode(JSON.stringify(full)).byteLength;
    expect(compactBytes).toBeLessThan(90 * 1024);
    expect(fullBytes / compactBytes).toBeGreaterThan(4);
  });
});

describe("export_build_brief - Tier 2 artifact compiler (MAR-249)", () => {
  it("emits epic -> milestones -> Linear issue templates with the full field set", () => {
    const b = planAndBrief(
      "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.",
      ["prompt", "linear"],
    );
    const pkg = b.artifact_package;

    expect(pkg.compiler).toBe("export_build_brief.artifact_compiler.v1");
    expect(() => ExportBuildBriefOutputShape.parse(b)).not.toThrow();
    expect(pkg.status).toBe("compiled");
    expect(pkg.epic.title).toContain("Build workflow");
    expect(pkg.milestones.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
    expect(pkg.linear_issue_templates.length).toBeGreaterThan(2);
    expect(pkg.field_order).toEqual([...ARTIFACT_ISSUE_FIELD_ORDER]);

    for (const issue of pkg.linear_issue_templates) {
      expect(Object.keys(issue.fields).sort()).toEqual([...ARTIFACT_ISSUE_FIELD_ORDER].sort());
      expect(issue.markdown).toContain("### Claude-Code/Cursor prompt");
      expect(issue.markdown).toContain("### Acceptance criteria");
      expect(issue.markdown).toContain("### Files likely affected");
    }
  });

  it("renders issue Markdown headings in the canonical artifact field order", () => {
    const b = planAndBrief(
      "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.",
      ["linear"],
    );
    const expectedHeadings = [
      "Title",
      "Goal",
      "User story",
      "Context",
      "Inputs",
      "Outputs",
      "Required tools",
      "Data model",
      "Step-by-step implementation",
      "Edge cases",
      "Failure modes",
      "Security",
      "Approval gates",
      "Acceptance criteria",
      "Test cases",
      "Definition of Done",
      "Claude-Code/Cursor prompt",
      "Files likely affected",
      "Non-goals",
    ];

    expect(b.artifact_package.field_order).toEqual([...ARTIFACT_ISSUE_FIELD_ORDER]);
    for (const issue of b.artifact_package.linear_issue_templates) {
      const headings = [...issue.markdown.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
      expect(headings).toEqual(expectedHeadings);
    }
  });

  it("keeps the aggregate Linear template bundle in artifact issue order", () => {
    const b = planAndBrief(
      "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.",
      ["linear"],
    );
    const aggregate = b.artifact_package.linear_issue_template_markdown;
    const aggregateIssueIds = [...aggregate.matchAll(/^## (ISSUE-\d{3}) /gm)].map((match) => match[1]);

    expect(aggregateIssueIds).toEqual(b.artifact_package.linear_issue_templates.map((issue) => issue.id));

    let previousIndex = -1;
    for (const issue of b.artifact_package.linear_issue_templates) {
      const index = aggregate.indexOf(issue.markdown);
      expect(index).toBeGreaterThan(previousIndex);
      expect(aggregate.lastIndexOf(issue.markdown)).toBe(index);
      previousIndex = index;
    }
  });

  it("keeps milestone issue ids in sync with generated artifact templates", () => {
    const b = planAndBrief(
      "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.",
      ["linear"],
    );
    const templates = b.artifact_package.linear_issue_templates;

    for (const milestone of b.artifact_package.milestones) {
      expect(milestone.issue_ids).toEqual(
        templates
          .filter((template) => template.milestone_id === milestone.id)
          .map((template) => template.id),
      );
    }
    expect(b.artifact_package.milestones.flatMap((milestone) => milestone.issue_ids)).toEqual(
      templates.map((template) => template.id),
    );
  });

  it("includes build-ready prompt and paste-ready Linear templates without external writes", () => {
    const b = planAndBrief(
      "Scan a GitHub PR, summarize risks, and draft a reviewer notification for human approval.",
      ["prompt", "linear", "obsidian"],
    );

    expect(b.artifact_package.build_prompt).toContain("You are implementing a confirmed OrchestrateMCP plan");
    expect(b.artifact_package.linear_issue_template_markdown).toContain("## ISSUE-001");
    expect(b.artifact_package.few_shot_example.markdown).toContain("EXAMPLE-001");
    expect(b.handoffs.prompt).toContain("Use these Linear-style issue templates as the execution plan");
    expect(b.handoffs.linear).toContain("no Linear write was performed");
    expect(b.handoffs.obsidian).toContain("tags: [orchestratekit");
    expect(b.brief_markdown).toContain("Tier 2 artifact compiler");
    expect(b.brief_markdown).toContain("did not write to Linear, Obsidian");
  });

  it("embeds the exact artifact compiler package in builder handoffs", () => {
    const b = planAndBrief(
      "Scan a GitHub PR, summarize risks, and draft a reviewer notification for human approval.",
      ["prompt", "linear"],
    );

    expect(b.handoffs.prompt).toBeDefined();
    expect(b.handoffs.linear).toBeDefined();
    expect(b.handoffs.prompt).toContain(b.artifact_package.build_prompt);
    expect(b.handoffs.linear).toContain(b.artifact_package.linear_issue_template_markdown);
  });

  it("directs client LLMs to clarify, confirm scope, and mark unknowns instead of guessing", () => {
    const b = planAndBrief("Read emails and draft CRM follow-ups", ["linear"]);
    const directives = b.artifact_package.directives.join("\n");

    expect(directives).toContain("Ask at least 3 targeted clarifying questions");
    expect(directives).toContain("Do not emit final implementation issues until the human confirms the scope");
    expect(directives).toContain("write UNKNOWN and ask the human");
    expect(directives).toContain("Do not write to Linear, Obsidian");
  });
});
