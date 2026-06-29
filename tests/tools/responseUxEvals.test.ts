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
});
