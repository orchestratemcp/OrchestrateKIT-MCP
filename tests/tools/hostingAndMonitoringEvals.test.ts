/**
 * MAR-315 (SCOPE-T1) — hosting + monitoring menu evals.
 *
 * plan_workflow gains a deterministic `hosting_and_monitoring` block (route
 * shape → hosting recommendation, DASH import as the recommended monitoring
 * option) plus two gated `next_action_menu` entries (`choose_hosting`,
 * `wire_monitoring`). Everything here is registry/route-shape derived — no
 * LLM, no network call, matching the buildNextActionMenu / buildClarifyingQuestions
 * discipline it was modeled on.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow, LAYER1_MAX_CHARS } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

function plan(
  goal: string,
  opts?: { local_or_hosted?: "local" | "hosted" | "either"; output_depth?: "guided" | "brief" | "standard" | "technical" | "deep" },
) {
  return planWorkflow(
    {
      goal,
      must_have_capabilities: [],
      must_avoid: [],
      local_or_hosted: opts?.local_or_hosted,
      output_depth: opts?.output_depth,
    },
    registry,
  );
}

// The audit G4 goal (MAR-254/MAR-303 lineage) — routes to the scheduled_data_report
// playbook (scheduled_trigger, no webhook, no chat trigger).
const G4_SCHEDULED_REPORT =
  "Every Monday at 8am, pull last week's sales numbers from our Postgres database, generate a PDF summary report, and post it to our team Slack channel. Fully unattended, no human in the loop.";

// The MAR-267 read-only PR-review goal — routes to pr_review_readonly (github_trigger).
const PR_REVIEW_WEBHOOK =
  "When a pull request is opened on GitHub, review the diff for problems and post a summary " +
  "comment. Never edit or commit any code — read-only.";

// Chat-triggered composed goal (no published playbook needed — chat_trigger
// enters via composeRoute directly).
const DISCORD_BOT =
  "Build a Discord bot that answers support questions in the channel and posts the reply.";

describe("MAR-315 — hosting recommendation derives from route trigger shape", () => {
  it("scheduled_trigger (G4 scheduled-report) → local scheduled task / cron recommended", () => {
    const r = plan(G4_SCHEDULED_REPORT);
    expect(r.recommended_route.map((s) => s.component_id)).toContain("scheduled_trigger");
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("local_cron");
    expect(r.hosting_and_monitoring.hosting.recommended.label.toLowerCase()).toContain(
      "local scheduled task",
    );
  });

  it("webhook-shaped trigger (PR-review, github_trigger) → always-on endpoint recommended", () => {
    const r = plan(PR_REVIEW_WEBHOOK);
    expect(r.recommended_route.map((s) => s.component_id)).toContain("github_trigger");
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("hosted_endpoint");
    expect(r.hosting_and_monitoring.hosting.recommended.label.toLowerCase()).toContain(
      "always-on endpoint",
    );
  });

  it("chat_trigger → runs inside the client, no separate hosting", () => {
    const r = plan(DISCORD_BOT);
    expect(r.recommended_route.map((s) => s.component_id)).toContain("chat_trigger");
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("in_client");
  });

  it("no trigger component at all → manual, on-demand run fallback", () => {
    const r = plan(
      "Summarize the top AI industry news from a handful of trusted sources and save a " +
        "short digest note into my Notion workspace whenever I run it.",
    );
    const ids = r.recommended_route.map((s) => s.component_id);
    expect(ids.some((id) => id.endsWith("_trigger"))).toBe(false);
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("manual_local");
  });
});

describe("MAR-315 — local_or_hosted is honored as an override", () => {
  it("'hosted' preference on a scheduled route recommends a hosted cron function instead of local", () => {
    const r = plan(G4_SCHEDULED_REPORT, { local_or_hosted: "hosted", output_depth: "technical" });
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("hosted_cron");
    expect(r.hosting_and_monitoring.hosting.reason).toMatch(/hosted stack/);
  });

  it("'local' preference cannot override a webhook trigger's need for a reachable endpoint", () => {
    const r = plan(PR_REVIEW_WEBHOOK, { local_or_hosted: "local", output_depth: "technical" });
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("hosted_endpoint");
    expect(r.hosting_and_monitoring.hosting.reason).toMatch(/tunnel/);
  });

  it("default 'either' leaves the route-shape recommendation untouched", () => {
    const withEither = plan(G4_SCHEDULED_REPORT, { local_or_hosted: "either" });
    const withDefault = plan(G4_SCHEDULED_REPORT);
    expect(withEither.hosting_and_monitoring).toEqual(withDefault.hosting_and_monitoring);
  });
});

describe("MAR-315 — monitoring recommendation is always DASH import", () => {
  it("recommends DASH import by default, with log-to-file / none as alternatives at technical depth", () => {
    const r = plan(G4_SCHEDULED_REPORT, { output_depth: "technical" });
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("dash_import");
    expect(r.hosting_and_monitoring.monitoring.recommended.label).toMatch(/DASH/);
    const altIds = r.hosting_and_monitoring.monitoring.alternatives.map((a) => a.id);
    expect(altIds).toEqual(["log_to_file", "manual_none"]);
  });

  it("echoes the goal's own stated monitoring answer in the reason at technical depth", () => {
    const r = plan(`${G4_SCHEDULED_REPORT} I will log to a file myself.`, { output_depth: "technical" });
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("dash_import");
    expect(r.hosting_and_monitoring.monitoring.reason).toMatch(/already describes a monitoring approach/);
  });
});

describe("MAR-315 — next_action_menu entries are gated (never-nag)", () => {
  it("an under-specified goal gets both choose_hosting and wire_monitoring menu entries", () => {
    const r = plan(G4_SCHEDULED_REPORT);
    const ids = r.next_action_menu.map((a) => a.id);
    expect(ids).toContain("choose_hosting");
    expect(ids).toContain("wire_monitoring");
  });

  it("a goal that already states hosting AND monitoring gets neither menu entry", () => {
    const r = plan(
      `${PR_REVIEW_WEBHOOK} It already runs on my server, and I watch it in DASH.`,
    );
    const ids = r.next_action_menu.map((a) => a.id);
    expect(ids).not.toContain("choose_hosting");
    expect(ids).not.toContain("wire_monitoring");
    // the block itself is still present — never-nag only hides the menu prompt
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBeTruthy();
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("dash_import");
  });

  it("stating only hosting suppresses choose_hosting but not wire_monitoring", () => {
    const r = plan(`${G4_SCHEDULED_REPORT} It already runs on my own server.`);
    const ids = r.next_action_menu.map((a) => a.id);
    expect(ids).not.toContain("choose_hosting");
    expect(ids).toContain("wire_monitoring");
  });
});

describe("MAR-315 — provenance, presence, and layering", () => {
  it("hosting_and_monitoring is present (never null) on every plan and tagged 'computed'", () => {
    for (const goal of [G4_SCHEDULED_REPORT, PR_REVIEW_WEBHOOK, DISCORD_BOT]) {
      const r = plan(goal);
      expect(r.hosting_and_monitoring).toBeDefined();
      expect(r.hosting_and_monitoring.hosting.recommended.id).toBeTruthy();
      expect(r.hosting_and_monitoring.monitoring.recommended.id).toBeTruthy();
      expect(r.provenance.field_tags.hosting_and_monitoring).toBe("computed");
    }
  });

  it("guided/brief keep hosting/monitoring out of the product-card markdown", () => {
    for (const depth of ["guided", "brief"] as const) {
      const r = plan(G4_SCHEDULED_REPORT, { output_depth: depth });
      const md = r.summary_markdown;
      expect(r.hosting_and_monitoring.hosting.recommended.id).toBeTruthy();
      expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("dash_import");
      expect(md).not.toContain("**Hosting:**");
      expect(md).not.toContain("**Monitoring:**");
      expect(md).not.toContain("### Hosting & monitoring");
      expect(md).toContain("### How do you want to continue?");
    }
  });

  it("Layer-1 product-card markdown still stays under the brevity bound", () => {
    const HEAVY_GOAL =
      "Read new leads from my email inbox, draft a reply, update the CRM record, " +
      "notify the sales channel on Slack, and require human approval before anything is sent externally";
    for (const depth of ["guided", "brief"] as const) {
      const len = plan(HEAVY_GOAL, { output_depth: depth }).summary_markdown.length;
      expect(len, `${depth} length ${len} <= ${LAYER1_MAX_CHARS}`).toBeLessThanOrEqual(LAYER1_MAX_CHARS);
    }
  });

  it("technical/deep render the full section with recommended + reason + alternatives", () => {
    for (const depth of ["technical", "deep"] as const) {
      const md = plan(G4_SCHEDULED_REPORT, { output_depth: depth }).summary_markdown;
      expect(md).toContain("### Hosting & monitoring");
      expect(md).toContain("**Alternatives:**");
      expect(md).toMatch(/🟢 \*\*Hosting \(recommended\):\*\*/);
      expect(md).toMatch(/🟢 \*\*Monitoring \(recommended\):\*\*/);
    }
  });

  it("standard depth (Layer-1 superset) still keeps hosting/monitoring out of markdown", () => {
    const md = plan(G4_SCHEDULED_REPORT, { output_depth: "standard" }).summary_markdown;
    expect(md).not.toContain("**Hosting:**");
    expect(md).not.toContain("**Monitoring:**");
    expect(md).not.toContain("### Hosting & monitoring");
  });

  it("brief JSON omits alternatives/reason prose (MAR-256 payload diet)", () => {
    const r = plan(G4_SCHEDULED_REPORT, { output_depth: "brief" });
    expect(r.hosting_and_monitoring.hosting.alternatives).toEqual([]);
    expect(r.hosting_and_monitoring.hosting.reason).toBe("");
    expect(r.hosting_and_monitoring.monitoring.alternatives).toEqual([]);
    expect(r.hosting_and_monitoring.monitoring.reason).toBe("");
  });
});
