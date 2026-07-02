/**
 * RESPONSE-UX-04 (MAR-227): UX regression evals.
 *
 * The same discipline that locks matcher precision with node-probes, applied to
 * the SHAPE of plan_workflow output. Without these, the Layer-1 (guided/brief)
 * default will silently re-bloat back into a report (the dogfood `8fb92697`
 * scored brevity 2/5 against the old report-style default). These are the
 * deterministic counterpart to the Lab rubric's `brevity` dimension.
 *
 * Assertions over plan_workflow markdown:
 *  - guided/brief default MUST NOT include the full step list / per-integration
 *    gotchas+scopes / worker pipeline / model-tier section / full provenance block.
 *  - Default output MUST end with a next-action menu (RESPONSE-UX-03).
 *  - A measurable brevity bound on Layer-1 markdown (LAYER1_MAX_CHARS).
 *  - Markdown does not duplicate the JSON payload.
 *  - Technical details appear ONLY in technical/deep.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow, LAYER1_MAX_CHARS } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

// A deliberately "heavy" goal: many steps, several integrations, an approval
// gate and irreversible writes — i.e. the worst case for report-creep.
const HEAVY_GOAL =
  "Read new leads from my email inbox, draft a reply, update the CRM record, " +
  "notify the sales channel on Slack, and require human approval before anything is sent externally";

function plan(depth?: "guided" | "brief" | "standard" | "technical" | "deep") {
  return planWorkflow(
    { goal: HEAVY_GOAL, must_have_capabilities: [], must_avoid: [], output_depth: depth },
    registry,
  );
}

// Markers that belong to the Layer-2 technical report only.
const TECHNICAL_MARKERS = [
  "### Model-tier profile",
  "### Credentials & permissions",
  "### Build team (worker pipeline)",
  "### Untested edges",
  "scopes:",
  "gotcha",
  "**Provenance:**", // the full provenance BLOCK (the one-line note is different)
];

describe("RESPONSE-UX-04 (MAR-227) — Layer-1 default does not regress into a report", () => {
  it("default output_depth is the guided Layer-1 shape (no full step list)", () => {
    const def = plan();
    const guided = plan("guided");
    // default == guided/brief
    expect(def.summary_markdown).toBe(guided.summary_markdown);
    // no numbered "**Steps:**" block in the Layer-1 default
    expect(def.summary_markdown).not.toContain("**Steps:**");
    expect(def.summary_markdown).not.toMatch(/^### Steps/m);
  });

  it("guided/brief omit every Layer-2 technical marker", () => {
    for (const depth of ["guided", "brief"] as const) {
      const md = plan(depth).summary_markdown;
      for (const marker of TECHNICAL_MARKERS) {
        expect(md, `${depth} must not contain "${marker}"`).not.toContain(marker);
      }
    }
  });

  it("Layer-1 markdown stays under the brevity bound (LAYER1_MAX_CHARS)", () => {
    for (const depth of ["guided", "brief"] as const) {
      const len = plan(depth).summary_markdown.length;
      expect(len, `${depth} length ${len} <= ${LAYER1_MAX_CHARS}`).toBeLessThanOrEqual(
        LAYER1_MAX_CHARS,
      );
    }
  });

  it("Layer-1 ends with a next-action menu (RESPONSE-UX-03)", () => {
    const md = plan("guided").summary_markdown;
    expect(md).toContain("**Next — pick one:**");
    // the menu sits near the end — only the one-line provenance note follows it
    const idx = md.indexOf("**Next — pick one:**");
    const tail = md.slice(idx);
    expect(tail).toMatch(/^- /m); // at least one menu item
    // nothing technical re-appears after the menu
    for (const marker of TECHNICAL_MARKERS) {
      expect(tail).not.toContain(marker);
    }
  });

  // RESPONSE-UX-03 (MAR-226): the menu is a stable, machine-consumable set
  it("next_action_menu is a stable enumerated set, each action mapping somewhere", () => {
    const r = plan("guided");
    expect(r.next_action_menu.length).toBeGreaterThan(0);
    for (const a of r.next_action_menu) {
      expect(typeof a.id).toBe("string");
      expect(a.action.length).toBeGreaterThan(0);
    }
    // the canonical drill-in action is always present and maps to output_depth
    expect(r.next_action_menu.some((a) => a.id === "show_technical_plan")).toBe(true);
    expect(r.provenance.field_tags.next_action_menu).toBe("advisory");
  });

  it("Layer-1 keeps a one-line provenance grounding note (🟢/🔵 preserved)", () => {
    const md = plan("guided").summary_markdown;
    expect(md).toContain("🟢");
    expect(md).toContain("🔵");
    // but NOT the full Layer-2 provenance block
    expect(md).not.toContain("**Provenance:**");
  });

  it("markdown never duplicates the JSON payload", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      const md = plan(depth).summary_markdown;
      expect(md, `${depth} no json fence`).not.toContain("```json");
      expect(md, `${depth} no raw recommended_route key`).not.toContain('"recommended_route"');
      expect(md, `${depth} no raw safety_review key`).not.toContain('"safety_review"');
    }
  });

  it("standard is a superset of guided: adds the step list, still no technical block", () => {
    const std = plan("standard").summary_markdown;
    expect(std).toContain("**Steps:**");
    expect(std.length).toBeGreaterThan(plan("guided").summary_markdown.length);
    // standard still withholds the technical sections
    for (const marker of ["### Model-tier profile", "### Build team (worker pipeline)", "**Provenance:**"]) {
      expect(std, `standard must not contain "${marker}"`).not.toContain(marker);
    }
  });

  // MAR-249: the operator register gives each step plain-English risk text
  // (a spoken consequence) instead of a bare `[medium risk]` enum tag. This is
  // the "picker → scope compiler" step-text win — verified on the standard step
  // list and the technical step list.
  it("standard/technical step lists carry plain-English risk consequences, not bare enum tags", () => {
    const std = plan("standard").summary_markdown;
    // the plain consequence phrasing appears (the HEAVY_GOAL route has writes)…
    expect(std).toMatch(/risk — (safe to run|check its output|pair with a human|needs human sign-off)/);
    // …and the old bare enum tag is gone from the step list
    expect(std).not.toMatch(/\[(low|medium|high|critical) risk\]/);

    const tech = plan("technical").summary_markdown;
    expect(tech).toMatch(/↳ _(low|medium|high|critical|.*risk)/);
  });

  it("technical/deep DO include the technical sections + full provenance block", () => {
    for (const depth of ["technical", "deep"] as const) {
      const md = plan(depth).summary_markdown;
      expect(md, `${depth} step list`).toContain("### Steps");
      expect(md, `${depth} model tiers`).toContain("### Model-tier profile");
      expect(md, `${depth} provenance block`).toContain("**Provenance:**");
    }
  });

  it("every depth still leads with the scannable status front-matter (MAR-101 invariant)", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      expect(plan(depth).summary_markdown.startsWith("---\n"), depth).toBe(true);
    }
  });

  it("the full structured route is always present in JSON regardless of depth", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      const r = plan(depth);
      expect(r.recommended_route.length, depth).toBeGreaterThan(0);
      expect(r.suggested_next_actions.length, depth).toBeGreaterThan(0);
    }
  });

  // RESPONSE-UX-02 (MAR-225): bounded clarifying questions when a constraint is missing
  it("an under-specified goal includes bounded clarifying_questions (≤3) in JSON + markdown", () => {
    const r = planWorkflow(
      {
        goal: "go through my inbox and handle the sales leads automatically",
        must_have_capabilities: [],
        must_avoid: [],
        output_depth: "brief",
      },
      registry,
    );
    expect(r.clarifying_questions.length).toBeGreaterThan(0);
    expect(r.clarifying_questions.length).toBeLessThanOrEqual(3);
    expect(r.summary_markdown).toContain("Quick checks to pin down the plan");
  });

  it("a fully-specified goal has NO clarifying_questions (no nagging)", () => {
    // HEAVY_GOAL states trigger-agnostic write + outbound + approval explicitly
    expect(plan("brief").clarifying_questions).toEqual([]);
    expect(plan("brief").summary_markdown).not.toContain("Quick checks to pin down the plan");
  });

  // MAR-246: when the gate is waived to advisory on an explicit unattended goal, the
  // Layer-1 header must not contradict itself — "do not run unattended past the gate"
  // is only correct when a gate is actually ENFORCED.
  it("an unattended-waiver goal does not print both 'may run unattended' and 'do not run unattended past the gate'", () => {
    const r = planWorkflow(
      {
        goal: "Watch our API uptime and automatically alert the team on Slack the moment it goes down. This runs unattended — no human in the loop.",
        must_have_capabilities: [],
        must_avoid: [],
        output_depth: "brief",
      },
      registry,
    );
    const md = r.summary_markdown;
    // The waiver actually fired (advisory, not enforced) — otherwise this goal isn't exercising the case.
    expect(r.enforced_approval_gates).toEqual([]);
    expect(r.approval_gate_advisory).not.toBeNull();
    if (md.includes("may run unattended")) {
      expect(md).not.toContain("do not run unattended past the gate");
    }
  });
});

// MAR-250: the coverage verdict is part of the Layer-1 trust surface. Every
// depth carries the front-matter line; the gap block appears exactly when
// there is a gap, and a clean plan pays nothing for it.
describe("MAR-250 — coverage honesty in the rendered output", () => {
  const PG_REPORT_GOAL =
    "Every Monday at 8am, pull last week's sales numbers from our Postgres database, generate a PDF summary report, and post it to our team Slack channel. Fully unattended, no human in the loop.";

  it("every depth carries a coverage: line in the front-matter", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      const md = plan(depth).summary_markdown;
      expect(md, `${depth} must carry coverage front-matter`).toMatch(/^coverage: {7}/m);
    }
  });

  it("a poor-coverage plan names its gaps in Layer 1 (the audit G4 goal)", () => {
    const r = planWorkflow(
      { goal: PG_REPORT_GOAL, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
    const md = r.summary_markdown;
    expect(md).toContain("Not covered by the registry");
    expect(md.toLowerCase()).toContain("postgres");
    expect(md).toContain("In the route but not asked for:");
    expect(md).toContain("`crm_note_write`");
    // even with the gap block, Layer 1 stays under the brevity bound
    expect(md.length).toBeLessThanOrEqual(LAYER1_MAX_CHARS);
  });

  it("a plan with no unmatched demand renders no 'Not covered' block", () => {
    const md = plan("brief").summary_markdown;
    expect(md).not.toContain("Not covered by the registry");
  });
});
