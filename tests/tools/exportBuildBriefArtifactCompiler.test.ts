import { describe, expect, it } from "vitest";
import { exportBuildBrief } from "../../src/tools/exportBuildBrief.js";
import { ExportBuildBriefOutputShape } from "../../src/tools/outputSchemas.js";

describe("export_build_brief artifact compiler sparse route steps", () => {
  it("marks missing route-step purpose as UNKNOWN instead of inventing implementation detail", () => {
    const brief = exportBuildBrief({
      goal: "Build a read-only workflow that inspects uploaded CSV files and reports schema drift.",
      plan_source: "composed",
      route_status: "candidate",
      recommended_route: [
        {
          step: 1,
          component_id: "schema_validation",
        },
      ],
      safety_review: {
        status: "pass",
        risk_score: 12,
        blocking_issues: [],
        warnings: [],
        approval_gates_required: [],
      },
      automation_clearance: {
        level: "L1",
        autonomous_allowed: true,
        reason: "Read-only validation route.",
        required_controls: [],
        highest_action_components: [],
      },
      enforced_approval_gates: [],
      untested_edges: [],
      avoid_when_violations: [],
      evals_to_add: [],
      design_notes: [],
      handoff_targets: ["linear"],
      generated_at: "2026-07-08T00:00:00.000Z",
      registry_fingerprint: "0123456789abcdef",
    });

    expect(() => ExportBuildBriefOutputShape.parse(brief)).not.toThrow();

    const routeIssue = brief.artifact_package.linear_issue_templates.find(
      (template) => template.id === "ISSUE-002",
    );

    expect(routeIssue).toBeDefined();
    expect(routeIssue?.fields.context).toContain("UNKNOWN - component purpose not provided.");
    expect(routeIssue?.fields.context).toContain("unknown model tier");
    expect(routeIssue?.markdown).toContain("UNKNOWN - component purpose not provided.");
    expect(routeIssue?.markdown).toContain("unknown model tier");
  });
});
