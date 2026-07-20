/**
 * MAR-315 (SCOPE-T1) — legacy hosting + monitoring compatibility evals.
 *
 * The legacy `hosting_and_monitoring` block remains deterministic and
 * route-shape derived for existing consumers. MAR-378's runtime-fit contract is
 * authoritative for new guided placement and keeps runtime, control,
 * interaction, and trigger as separate decisions.
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
  it("offline scheduled route → hosted cron compatibility recommendation", () => {
    const r = plan(G4_SCHEDULED_REPORT);
    expect(r.recommended_route.map((s) => s.component_id)).toContain("scheduled_trigger");
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("hosted_cron");
    expect(r.hosting_and_monitoring.hosting.recommended.label.toLowerCase()).toContain(
      "hosted scheduled function",
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
  it("'hosted' preference agrees with an offline scheduled route", () => {
    const r = plan(G4_SCHEDULED_REPORT, { local_or_hosted: "hosted", output_depth: "technical" });
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBe("hosted_cron");
    expect(r.hosting_and_monitoring.hosting.reason).toMatch(/managed timer/);
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

describe("MAR-315 — monitoring recommendation stays first-run usable", () => {
  it("recommends simple logs by default, with manual-only as the technical-depth alternative", () => {
    const r = plan(G4_SCHEDULED_REPORT, { output_depth: "technical" });
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("log_to_file");
    expect(r.hosting_and_monitoring.monitoring.recommended.label).toMatch(/file or table/);
    const altIds = r.hosting_and_monitoring.monitoring.alternatives.map((a) => a.id);
    expect(altIds).toEqual(["manual_none"]);
  });

  it("echoes the goal's own stated monitoring answer in the reason at technical depth", () => {
    const r = plan(`${G4_SCHEDULED_REPORT} I will log to a file myself.`, { output_depth: "technical" });
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("log_to_file");
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
      `${PR_REVIEW_WEBHOOK} It already runs on my server, and I watch the logs.`,
    );
    const ids = r.next_action_menu.map((a) => a.id);
    expect(ids).not.toContain("choose_hosting");
    expect(ids).not.toContain("wire_monitoring");
    // the block itself is still present — never-nag only hides the menu prompt
    expect(r.hosting_and_monitoring.hosting.recommended.id).toBeTruthy();
    expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("log_to_file");
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
      expect(r.hosting_and_monitoring.monitoring.recommended.id).toBe("log_to_file");
      expect(md).not.toContain("**Hosting:**");
      expect(md).not.toContain("**Monitoring:**");
      expect(md).not.toContain("### Hosting & monitoring");
      // MAR-402: the card ends in the ⭐ Recommended-setup line; the lettered
      // menu lives on the no-choice-UI fallback surface only.
      expect(md).toContain("**Recommended setup:** ⭐");
      expect(md).not.toContain("### How do you want to continue?");
      expect(r.question_flow.fallback_menu_markdown).toContain(
        "### How do you want to continue?",
      );
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

  it("technical/deep render the corrected runtime-fit section with alternatives", () => {
    for (const depth of ["technical", "deep"] as const) {
      const md = plan(G4_SCHEDULED_REPORT, { output_depth: depth }).summary_markdown;
      expect(md).toContain("### Runtime-fit setup");
      expect(md).toContain("#### Runtime recommendation");
      expect(md).toContain("#### Runtime alternatives");
      expect(md).toContain("Managed scheduled job — Recommended");
      expect(md).toContain("Must run while user is offline: yes");
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
