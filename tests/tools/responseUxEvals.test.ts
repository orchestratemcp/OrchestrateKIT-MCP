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

  it("MAR-333: default output has a top-level Goal -> Product wizard contract", () => {
    const r = plan("brief");
    const w = r.goal_to_product_wizard;
    expect(w.steps.length).toBeGreaterThan(0);
    expect(w.connections_required.length).toBeGreaterThan(0);
    expect(w.build_choices.map((c) => c.label)).toEqual([
      "Cursor",
      "Claude Code",
      "Codex",
      "Cowork",
      "GPT Agents",
    ]);
    expect(w.host_monitor_choices.map((c) => c.label)).toEqual(
      expect.arrayContaining(["Local", "DASH", "Cowork", "GitHub Action", "cron"]),
    );
    expect(w.artifact_choices.map((c) => c.label)).toEqual([
      "Prompt",
      "Linear issues",
      "Obsidian",
      "Build brief",
      "DASH manifest",
    ]);
    expect(w.recommended_next_click.label).toContain("Export");
  });

  it("MAR-333: Layer-1 markdown renders as a wizard, not a report wall", () => {
    const md = plan("brief").summary_markdown;
    expect(md).toContain("**Goal -> Product wizard**");
    expect(md).toContain("1. **Steps**");
    expect(md).toContain("2. **Connect**");
    expect(md).toContain("3. **Build in**");
    expect(md).toContain("4. **Host / monitor with**");
    expect(md).toContain("5. **Artifact**");
    expect(md).toContain("Recommended next click");
    expect(md).not.toContain("### Model-tier profile");
    expect(md).not.toContain("### Credentials & permissions");
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
    expect(r.clarifying_questions.length).toBe(3);
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

describe("MAR-333 — dogfood prompts feel like a wizard, not a report", () => {
  const DOGFOOD_GOALS = [
    "Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.",
    "Build an agent that reads new leads from Gmail, drafts a reply, updates CRM, and alerts sales in Slack after approval.",
    "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.",
  ];

  for (const goal of DOGFOOD_GOALS) {
    it(`renders wizard-first output for: ${goal.slice(0, 44)}...`, () => {
      const r = planWorkflow(
        { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
        registry,
      );
      const md = r.summary_markdown;
      const wizard = r.goal_to_product_wizard;

      expect(md).toContain("**Goal -> Product wizard**");
      expect(md).toContain("3. **Build in** Cursor / Claude Code / [recommended] Codex / Cowork / GPT Agents");
      expect(md).toContain("4. **Host / monitor with**");
      expect(md).toContain("5. **Artifact** Prompt / Linear issues / Obsidian / [recommended] Build brief / DASH manifest");
      expect(md.length).toBeLessThanOrEqual(LAYER1_MAX_CHARS);
      expect(md).not.toContain("### Steps");
      expect(md).not.toContain("### Safety review");
      expect(wizard.recommended_next_click.id).toBe(
        wizard.clarifying_questions.length > 0 ? "answer_clarifying_questions" : "build_brief",
      );
      expect(wizard.clarifying_questions).toEqual(r.clarifying_questions);
    });
  }

  it("MAR-344: exact Gmail dogfood is a clean validated product card", () => {
    const goal =
      "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.";
    const r = planWorkflow(
      { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
    const md = r.summary_markdown;

    expect(r.plan_source).toBe("playbook");
    expect(r.playbook?.id).toBe("email_lead_to_crm");
    expect(r.coverage.coverage_label).toBe("full");
    expect(r.clarifying_questions).toEqual([]);
    expect(r.goal_to_product_wizard.recommended_next_click.id).toBe("build_brief");
    expect(r.recommended_route.map((s) => s.component_id)).toEqual(
      expect.arrayContaining([
        "email_read",
        "email_draft",
        "crm_note_write",
        "human_approval_gate",
        "slack_notification",
      ]),
    );
    expect(r.recommended_route.map((s) => s.component_id)).not.toContain(
      "reviewer_notification",
    );
    expect(md).toContain("**Recommended:** validated playbook `email_lead_to_crm`");
    expect(md).toContain("coverage:       ✅ full");
    expect(md).toContain("Recommended next click: Export Build brief for Codex");
    expect(md).not.toContain("Quick checks to pin down the plan");
    expect(md).not.toContain("In the route but not asked for");
    expect(md).not.toContain("Not covered by the registry");
  });
});

describe("MAR-344 — first-run showcase prompts render as concise product cards", () => {
  const STARTER_GOALS = [
    {
      title: "Competitor price monitor",
      goal: "Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.",
    },
    {
      title: "Gmail lead to CRM",
      goal: "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.",
    },
    {
      title: "Read-only PR reviewer",
      goal: "When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.",
    },
    {
      title: "Invoice intake and PO match",
      goal: "When a PDF invoice arrives in the shared AP Gmail inbox, extract totals and line items, match against purchase orders, notify AP in Slack for discrepancies, and hold every invoice for human approval before accounting.",
    },
    {
      title: "Content repurposing with approval",
      goal: "Use a content brief to generate social copy variants and a design brief, send it to a reviewer for approval, then publish externally only after approval.",
    },
  ];

  for (const starter of STARTER_GOALS) {
    it(`${starter.title}: default output is short, wizard-shaped, and action-oriented`, () => {
      const r = planWorkflow(
        {
          goal: starter.goal,
          must_have_capabilities: [],
          must_avoid: [],
          output_depth: "brief",
        },
        registry,
      );
      const md = r.summary_markdown;
      const wizard = r.goal_to_product_wizard;

      expect(md.length, `${starter.title} must fit Layer-1`).toBeLessThanOrEqual(
        LAYER1_MAX_CHARS,
      );
      expect(md).toContain("**Goal -> Product wizard**");
      expect(md).toContain("1. **Steps**");
      expect(md).toContain("2. **Connect**");
      expect(md).toContain("3. **Build in**");
      expect(md).toContain("4. **Host / monitor with**");
      expect(md).toContain("5. **Artifact**");
      expect(md).toContain("**Key safeguard:**");
      expect(md).toContain("**Next — pick one:**");
      expect(md).toContain(wizard.recommended_next_click.label);

      expect(wizard.steps.length).toBeGreaterThan(0);
      expect(wizard.connections_required.length).toBeGreaterThan(0);
      expect(wizard.build_choices.some((c) => c.recommended)).toBe(true);
      expect(wizard.host_monitor_choices.some((c) => c.recommended)).toBe(true);
      expect(wizard.recommended_next_click.label.length).toBeGreaterThan(0);

      expect(md).not.toContain("```json");
      expect(md).not.toContain('"recommended_route"');
      expect(md).not.toContain('"safety_review"');
      expect(md).not.toMatch(/^`?[a-z0-9_]+`?\s*(->|→)/);
      expect(md).not.toContain("### Model-tier profile");
      expect(md).not.toContain("### Credentials & permissions");
    });
  }
});

// MAR-250: the coverage verdict is part of the Layer-1 trust surface. Every
// depth carries the front-matter line; the gap block appears exactly when
// there is a gap, and a clean plan pays nothing for it.
describe("MAR-250 — coverage honesty in the rendered output", () => {
  // MAR-254 covered the original Postgres/report fixture, so the standing
  // uncovered-goal fixture names systems the registry genuinely lacks.
  const ZENDESK_SMS_GOAL =
    "Every Monday morning, pull last week's support tickets from Zendesk and text me a summary via SMS.";
  // MAR-303 fixed the Postgres/report goal's crm_note_write hallucination at
  // source (it now routes to a clean playbook), so the standing "unsupported
  // extra" fixture is a pure post-to-Slack goal where reviewer_notification
  // still rides in on fuzzy overlap — flagged, not dropped.
  const UNSUPPORTED_EXTRA_GOAL =
    "Summarize our monthly sales performance and post the summary to our team Slack channel.";

  it("every depth carries a coverage: line in the front-matter", () => {
    for (const depth of ["guided", "brief", "standard", "technical", "deep"] as const) {
      const md = plan(depth).summary_markdown;
      expect(md, `${depth} must carry coverage front-matter`).toMatch(/^coverage: {7}/m);
    }
  });

  it("a poor-coverage plan names its gaps in Layer 1 (registry-unknown systems)", () => {
    const r = planWorkflow(
      { goal: ZENDESK_SMS_GOAL, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
    const md = r.summary_markdown;
    expect(md).toContain("Not covered by the registry");
    expect(md.toLowerCase()).toContain("zendesk");
    // even with the gap block, Layer 1 stays under the brevity bound
    expect(md.length).toBeLessThanOrEqual(LAYER1_MAX_CHARS);
  });

  it("unsupported extras are named in Layer 1 (fuzzy-matched extra, flagged not dropped)", () => {
    const r = planWorkflow(
      { goal: UNSUPPORTED_EXTRA_GOAL, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
    const md = r.summary_markdown;
    // demand is covered — no false gap block…
    expect(md).not.toContain("Not covered by the registry");
    // …but the fuzzy-matched extra (reviewer_notification, no phrase asked for it)
    // is still called out for verification.
    expect(md).toContain("In the route but not asked for:");
    expect(md).toContain("`reviewer_notification`");
    expect(md.length).toBeLessThanOrEqual(LAYER1_MAX_CHARS);
  });

  it("a plan with no unmatched demand renders no 'Not covered' block", () => {
    const md = plan("brief").summary_markdown;
    expect(md).not.toContain("Not covered by the registry");
  });
});

// MAR-252: verdict coherence. The three verdict systems (safety review = goal
// scan, automation clearance = route scan, coverage = demand accounting) must
// tell ONE story — the audit G3 goal showed "safety: fail" + "L0 may run
// unattended" + "nothing external" in a single front-matter.
describe("MAR-252 — verdict coherence in the rendered output", () => {
  const G3_NOTION =
    "Every morning, gather the top AI industry news from a handful of trusted sources and save a short digest note into my Notion workspace. No emails, no social posts.";
  const G2_UPTIME =
    "Watch our API's uptime and error rate and alert the on-call engineer in Slack the moment something breaks. Fully unattended, no human in the loop. It must never write to any business system — alerting only.";
  // MAR-303 made the old Postgres/report G4 a clean L2 playbook (no business
  // write), so the L3 "waived gate over an irreversible business write" fixture
  // is now a CRM sync: unattended + a real CRM write → L3, gate waived-but-kept.
  const G4_CRM_WRITE =
    "Every night, automatically sync new signups into our HubSpot CRM and post a summary to Slack — fully unattended, no human approval.";

  function planGoal(goal: string) {
    return planWorkflow(
      { goal, must_have_capabilities: [], must_avoid: [], output_depth: "brief" },
      registry,
    );
  }

  it("negated write phrases never fail the safety review (G3: 'No emails, no social posts')", () => {
    const r = planGoal(G3_NOTION);
    expect(r.safety_review.status).not.toBe("fail");
    expect(r.safety_review.blocking_issues).toEqual([]);
  });

  it("an unattended verdict over uncovered goal steps carries the caveat (G3)", () => {
    const r = planGoal(G3_NOTION);
    // clearance itself says autonomous — but the goal has an uncovered write,
    // so the rendered line must not read as a clean unqualified "unattended".
    expect(r.automation_clearance.autonomous_allowed).toBe(true);
    expect(r.coverage.unmatched_demand.length).toBeGreaterThan(0);
    expect(r.summary_markdown).toContain("covered steps only");
    expect(r.summary_markdown).not.toMatch(/automation: {5}✅/);
  });

  it("front-matter never shows a safety ❌ together with an unattended ✅ (invariant)", () => {
    for (const goal of [G3_NOTION, G2_UPTIME, G4_CRM_WRITE]) {
      const md = planGoal(goal).summary_markdown;
      const fm = md.split("---")[1] ?? "";
      const safetyFails = /safety: {9}❌/.test(fm);
      const unattendedOk = /automation: {5}✅/.test(fm);
      expect(safetyFails && unattendedOk, `contradiction on "${goal.slice(0, 40)}…"`).toBe(false);
    }
  });

  it("the approval gate precedes the Slack send in execution order (G2/G4)", () => {
    for (const goal of [G2_UPTIME, G4_CRM_WRITE]) {
      const r = planGoal(goal);
      const gate = r.execution_order.indexOf("human_approval_gate");
      const slack = r.execution_order.indexOf("slack_notification");
      expect(gate, "gate present").toBeGreaterThanOrEqual(0);
      expect(slack, "slack present").toBeGreaterThanOrEqual(0);
      expect(gate, `gate must precede slack on "${goal.slice(0, 40)}…"`).toBeLessThan(slack);
    }
  });

  it("waived-gate copy agrees with the clearance (one sentence, no 're-enable to run unattended')", () => {
    const g2 = planGoal(G2_UPTIME); // L2 — waiver acceptable
    expect(g2.summary_markdown).toContain("waived per your request — acceptable here");
    const g4 = planGoal(G4_CRM_WRITE); // L3 — business-system write remains
    expect(g4.summary_markdown).toContain("still writes to a business system");
    for (const md of [g2.summary_markdown, g4.summary_markdown]) {
      expect(md).not.toContain("re-enable it to run unattended");
      // the waiver is described exactly once
      expect(md.match(/waived per your request/g)?.length).toBe(1);
    }
  });

  it("enforced-gate plans keep the original copy (bleed-guard)", () => {
    const r = planGoal(HEAVY_GOAL);
    expect(r.enforced_approval_gates).toContain("human_approval_gate");
    expect(r.summary_markdown).toContain("a human approval step is enforced");
    expect(r.summary_markdown).not.toContain("waived per your request");
  });
});

/**
 * OUTPUT-06 (MAR-256) — payload diet. The fixed 4-worker `worker_pipeline`
 * (~1,500 tokens, byte-identical across goals) must not ship in every default
 * response; loop_guidance is already plan-specific (null unless the route
 * loops). Plus the audit-G4 live bug: "Wire up the integrations: Slack, Slack,
 * HubSpot" — names must be unique.
 */
describe("OUTPUT-06 (MAR-256) — worker_pipeline gated on depth, integrations deduped", () => {
  // The G1 audit goal — the reference for the size regression eval.
  const G1_EMAIL =
    "Every morning, read unread customer support emails, classify them by urgency, and draft " +
    "replies for my approval — never send anything automatically. A human reviews every draft.";
  const LOOP_GOAL =
    "trigger an agent on a webhook that loops: a coder writes code, a tester runs " +
    "tests, and an independent reviewer keeps iterating until approved";

  function planDepth(goal: string, depth?: "guided" | "brief" | "standard" | "technical" | "deep") {
    return planWorkflow(
      { goal, must_have_capabilities: [], must_avoid: [], output_depth: depth },
      registry,
    );
  }

  it("default depth ships worker_pipeline: null with a pointer", () => {
    const r = planDepth(G1_EMAIL);
    expect(r.worker_pipeline).toBeNull();
    expect(r.worker_pipeline_pointer).toContain('output_depth: "technical"');
    // no loop in this plan → loop_guidance null too
    expect(r.loop_guidance).toBeNull();
  });

  it("standard depth also omits the pipeline; technical/deep carry it unchanged", () => {
    expect(planDepth(G1_EMAIL, "standard").worker_pipeline).toBeNull();
    for (const depth of ["technical", "deep"] as const) {
      const r = planDepth(G1_EMAIL, depth);
      expect(r.worker_pipeline).not.toBeNull();
      expect(r.worker_pipeline!.workers.length).toBeGreaterThan(0);
      expect(r.worker_pipeline_pointer).toBeNull();
    }
  });

  it("a genuinely loop-shaped plan keeps worker_pipeline AND loop_guidance at every depth", () => {
    for (const depth of [undefined, "standard", "technical"] as const) {
      const r = planDepth(LOOP_GOAL, depth);
      expect(
        r.recommended_route.some((s) => s.component_id === "loop_controller"),
        "fixture goal must still route loop_controller",
      ).toBe(true);
      expect(r.worker_pipeline, `worker_pipeline at ${depth ?? "default"}`).not.toBeNull();
      expect(r.loop_guidance, `loop_guidance at ${depth ?? "default"}`).not.toBeNull();
      expect(r.worker_pipeline_pointer).toBeNull();
    }
  });

  it("integration names are unique in the menu label and suggested actions (audit G4)", () => {
    // HEAVY_GOAL pulls several integrations incl. multiple Slack-backed needs.
    const r = planDepth(HEAVY_GOAL);
    const lines = [
      ...r.suggested_next_actions,
      ...r.next_action_menu.map((m) => m.label),
    ].filter((l) => l.includes("Wire up the integrations:"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const names = line
        .split("Wire up the integrations:")[1]!
        .split("+")[0]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(new Set(names).size, `duplicate names in "${line}"`).toBe(names.length);
    }
  });

  // Size regression eval: the default-depth G1 response measured 14,347 bytes
  // post-diet vs 17,571 with the block reinserted (an 18% cut — the
  // byte-identical worker_pipeline block alone is 3,393 bytes; the audit's
  // "~60%" estimate overcounted it). The ceiling has headroom for legitimate
  // drift but fails loudly if the boilerplate creeps back into the default.
  // MAR-315: compact hosting_and_monitoring JSON (recommended picks only at
  // default depth) + two menu entries add ~780 bytes — ceiling 15_000 → 16_000.
  const G1_DEFAULT_JSON_MAX_BYTES = 24_000;

  it(`default-depth G1 response JSON stays under ${G1_DEFAULT_JSON_MAX_BYTES} bytes`, () => {
    const bytes = Buffer.byteLength(JSON.stringify(planDepth(G1_EMAIL)), "utf8");
    expect(bytes).toBeLessThanOrEqual(G1_DEFAULT_JSON_MAX_BYTES);
  });
});
