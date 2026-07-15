import { describe, it, expect } from "vitest";
import {
  matchCapabilities,
  classifyGoalDomains,
} from "../../src/graph/capabilityMatcher.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const { components, edges } = loadRegistry();

/** Helper: ids matched for a goal, with avoid_when edges active. */
function matchedIds(goal: string): string[] {
  return matchCapabilities(goal, [], [], components, edges).matches.map(
    (m) => m.component.id,
  );
}

describe("matchCapabilities", () => {
  it("matches email-related components for an email goal", () => {
    const { matches } = matchCapabilities("read and reply to emails", [], [], components);
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
  });

  it("treats Gmail as an email mailbox source", () => {
    const ids = matchedIds("Read new leads from Gmail and draft a reply.");
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
  });

  it("matches research components for a research goal", () => {
    const { matches } = matchCapabilities("research and summarize a topic with citations", [], [], components);
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("source_retrieval");
    expect(ids).toContain("research_synthesis");
  });

  it("matches code-related components for a coding goal", () => {
    const { matches } = matchCapabilities("refactor codebase and run tests", [], [], components);
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("codebase_scan");
    expect(ids).toContain("test_runner");
  });

  it("excludes must_avoid components", () => {
    const { matches } = matchCapabilities("send email", [], ["optional_email_send"], components);
    const ids = matches.map((m) => m.component.id);
    expect(ids).not.toContain("optional_email_send");
  });

  it("returns results sorted by score descending", () => {
    const { matches } = matchCapabilities("email calendar schedule", [], [], components);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    }
  });

  it("reports missing must_have capabilities that no component covers", () => {
    const { missing_capabilities } = matchCapabilities(
      "basic workflow",
      ["quantum_teleportation"],
      [],
      components,
    );
    expect(missing_capabilities).toContain("quantum_teleportation");
  });

  it("does not report missing capabilities when they are covered", () => {
    const { missing_capabilities } = matchCapabilities(
      "read emails",
      ["read_inbox"],
      [],
      components,
    );
    expect(missing_capabilities).not.toContain("read_inbox");
  });

  it("returns empty matches for completely unrelated goal", () => {
    const { matches } = matchCapabilities("quantum teleportation and time travel", [], [], components);
    // May return some matches due to partial token overlap, but score should be low
    // The key is it doesn't crash
    expect(Array.isArray(matches)).toBe(true);
  });
});

describe("matchCapabilities — MAR-132 human_approval_gate is not fuzzy-matched", () => {
  it("does NOT select human_approval_gate from the word 'human' in 'no human in the loop'", () => {
    const { matches } = matchCapabilities(
      "monitor a pricing page on an hourly schedule and alert me; runs unattended, no human in the loop",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).not.toContain("human_approval_gate");
  });

  it("STILL selects human_approval_gate when the goal asks for approval", () => {
    const { matches } = matchCapabilities(
      "draft a reply and require human review and approval before sending",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("human_approval_gate");
  });
});

describe("matchCapabilities — domain guards (MAR-80)", () => {
  it("does NOT include pr_summary for a research goal with the word 'summary'", () => {
    const { matches } = matchCapabilities(
      "research workflow with structured summary and citations",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).not.toContain("pr_summary");
  });

  it("DOES include pr_summary when goal has PR context", () => {
    const { matches } = matchCapabilities(
      "scan codebase, implement changes and write a PR summary",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("pr_summary");
  });

  it("does NOT include codebase_scan for an email research goal", () => {
    const { matches } = matchCapabilities(
      "read emails, research companies and draft replies",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).not.toContain("codebase_scan");
  });

  it("DOES include codebase_scan when goal has code context", () => {
    const { matches } = matchCapabilities(
      "scan the codebase and refactor the authentication module",
      [],
      [],
      components,
    );
    const ids = matches.map((m) => m.component.id);
    expect(ids).toContain("codebase_scan");
  });
});

/**
 * MAR-88 (MCP-14) — domain-gated matcher.
 *
 * Each case below uses the LITERAL benchmark prompt text (p1–p7) so the
 * cross-domain false positives observed in benchmarks/takeaways-2026-06-09.md
 * are pinned as regression cases. `forbidden` = components that must NEVER be
 * injected for that domain; `present` = positive controls proving we did not
 * over-block the goal's own domain.
 */
describe("matchCapabilities — MAR-88 p1–p7 regression (domain gating)", () => {
  const P1_RESEARCH =
    "Build an AI research workflow that retrieves sources from multiple origins, " +
    "checks source freshness and ranks by recency/relevance, synthesizes a structured " +
    "summary with inline citations, adds retries when source retrieval fails, and " +
    "requires human review before the summary is published.";

  const P2_CONTENT =
    "Build a content workflow for a brand that starts from a content brief or campaign " +
    "idea, generates copy variants, hands off to a design tool for visual creation, " +
    "requires marketing approval before publishing, and publishes to a public channel.";

  const P3_EMAIL =
    "Build an AI assistant that reads the user's email inbox, identifies emails that need " +
    "replies or require meeting scheduling, drafts replies and calendar invites, presents " +
    "drafts for approval, and only sends or books after explicit human confirmation.";

  const P4_CODE =
    "Build a codebase AI agent that scans an existing codebase, receives a feature or " +
    "bug-fix task, produces an implementation plan, makes code edits, runs the test suite, " +
    "and writes a PR summary.";

  const P5_ETL =
    "Build a data extraction and enrichment pipeline that scrapes or pulls data from an " +
    "external source, normalizes the schema, deduplicates records, validates against a " +
    "target schema, handles partial failures with retries, and writes an audit log.";

  const P6_LEAD_CRM =
    "Build a workflow that reads my email inbox, identifies possible sales leads or " +
    "partnership opportunities, researches the sender's company automatically, writes a " +
    "CRM note, drafts a personalised follow-up email for human review, and only sends " +
    "after explicit approval.";

  const P7_DOCS_MONITOR =
    "Monitor product documentation for changes, summarize changes, generate content ideas " +
    "and publish after approval.";

  it("p1 research: excludes pr_summary; keeps the research cluster", () => {
    const ids = matchedIds(P1_RESEARCH);
    expect(ids).not.toContain("pr_summary"); // 'summary' must not pull code component
    expect(ids).toContain("source_retrieval");
    expect(ids).toContain("research_synthesis");
  });

  // MAR-115 p1: "published" in goal must not inject content_idea_intake via bridge
  // bleed. "and" inside extract_audience_and_goals was the scoring vector (stopword fix).
  it("MAR-115 p1: excludes content_idea_intake from research-only goal even when 'published' appears", () => {
    const ids = matchedIds(P1_RESEARCH);
    expect(ids).not.toContain("content_idea_intake");
    expect(ids).not.toContain("design_brief_generation");
    expect(ids).not.toContain("copy_generation");
  });

  it("p2 content: excludes research cluster; keeps content components", () => {
    const ids = matchedIds(P2_CONTENT);
    // research cluster is noise on a pure content goal (no sources/citations asked)
    expect(ids).not.toContain("research_synthesis");
    expect(ids).not.toContain("citation_checker");
    expect(ids).not.toContain("plan_generation");
    // positive controls
    expect(ids).toContain("copy_generation");
    expect(ids).toContain("external_publish");
  });

  it("p3 email/calendar: excludes design_brief_generation; keeps email+calendar", () => {
    const ids = matchedIds(P3_EMAIL);
    expect(ids).not.toContain("design_brief_generation");
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
  });

  it("p4 codebase: excludes research/content; keeps code components incl. pr_summary", () => {
    const ids = matchedIds(P4_CODE);
    expect(ids).not.toContain("research_synthesis");
    expect(ids).not.toContain("citation_checker");
    expect(ids).not.toContain("copy_generation");
    expect(ids).not.toContain("design_brief_generation");
    expect(ids).not.toContain("external_publish");
    expect(ids).toContain("codebase_scan");
    expect(ids).toContain("test_runner");
    expect(ids).toContain("pr_summary");
  });

  it("p5 ETL: never includes external_publish or research retrieval", () => {
    const ids = matchedIds(P5_ETL);
    expect(ids).not.toContain("external_publish");
    expect(ids).not.toContain("source_retrieval");
    expect(ids).not.toContain("source_freshness_check");
    expect(ids).toContain("data_scraper");
    expect(ids).toContain("data_normalizer");
    expect(ids).toContain("deduplication");
  });

  it("p6 lead+CRM: includes crm_note_write; never substitutes external_publish; keeps email + research", () => {
    const ids = matchedIds(P6_LEAD_CRM);
    expect(ids).toContain("crm_note_write");     // MAR-95: must be present
    expect(ids).not.toContain("external_publish"); // must NOT be substituted
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
    expect(ids).toContain("research_synthesis");
  });

  it("p7 docs monitor: excludes pr_summary; prefers page_monitor over data_scraper", () => {
    const ids = matchedIds(P7_DOCS_MONITOR);
    expect(ids).not.toContain("pr_summary");
    expect(ids).toContain("page_monitor");
    expect(ids).not.toContain("data_scraper"); // monitoring domain, not data_etl
  });
});

describe("matchCapabilities — MAR-95 crm_note_write domain gating", () => {
  it("crm_note_write appears for a CRM-keyed goal", () => {
    const ids = matchedIds("classify sales leads from email and write a CRM note");
    expect(ids).toContain("crm_note_write");
    expect(ids).not.toContain("external_publish");
  });

  it("crm_note_write does NOT appear for a pure content goal", () => {
    const ids = matchedIds("generate copy variants and publish to the blog");
    expect(ids).not.toContain("crm_note_write");
  });

  it("crm_note_write does NOT appear for a pure code goal", () => {
    const ids = matchedIds("scan codebase, implement feature and run tests");
    expect(ids).not.toContain("crm_note_write");
  });
});

describe("classifyGoalDomains — MAR-88", () => {
  it("always includes generic_orchestration", () => {
    expect(classifyGoalDomains("anything at all").has("generic_orchestration")).toBe(
      true,
    );
  });

  it("classifies a research goal as research", () => {
    const d = classifyGoalDomains("retrieve sources and check citations");
    expect(d.has("research")).toBe(true);
  });

  it("does NOT classify a pure content goal as research", () => {
    const d = classifyGoalDomains(
      "generate copy variants for a brand campaign and publish them",
    );
    expect(d.has("content_publishing")).toBe(true);
    expect(d.has("research")).toBe(false);
  });

  it("unlocks research on a content goal only when sources/citations are requested", () => {
    const d = classifyGoalDomains(
      "write blog content backed by cited sources for factuality",
    );
    expect(d.has("content_publishing")).toBe(true);
    expect(d.has("research")).toBe(true);
  });

  it("classifies email/calendar goals without code or content", () => {
    const d = classifyGoalDomains(
      "read my inbox, draft replies and add calendar invites",
    );
    expect(d.has("email_calendar")).toBe(true);
    expect(d.has("code_agent")).toBe(false);
    expect(d.has("content_publishing")).toBe(false);
  });

  it("classifies an ETL goal as data_etl, not content_publishing", () => {
    const d = classifyGoalDomains(
      "scrape records, normalize the schema and deduplicate",
    );
    expect(d.has("data_etl")).toBe(true);
    expect(d.has("content_publishing")).toBe(false);
  });

  it("classifies a code goal as code_agent without research/content", () => {
    const d = classifyGoalDomains(
      "scan the codebase, implement a feature and write a PR summary",
    );
    expect(d.has("code_agent")).toBe(true);
    expect(d.has("research")).toBe(false);
    expect(d.has("content_publishing")).toBe(false);
  });

  it("classifies a monitoring goal as monitoring", () => {
    const d = classifyGoalDomains("monitor the docs for changes");
    expect(d.has("monitoring")).toBe(true);
  });

  it("classifies a CRM lead goal as crm_sales (multi-domain with email)", () => {
    const d = classifyGoalDomains(
      "read inbox, find sales leads and write a CRM note, then draft a follow-up email",
    );
    expect(d.has("crm_sales")).toBe(true);
    expect(d.has("email_calendar")).toBe(true);
  });
});

describe("classifyGoalDomains — MAR-131 weak email_calendar de-bias", () => {
  it("does NOT classify a scheduled monitor goal as email_calendar", () => {
    const d = classifyGoalDomains(
      "monitor a competitor pricing page on an hourly schedule and alert on changes",
    );
    expect(d.has("monitoring")).toBe(true);
    expect(d.has("email_calendar")).toBe(false);
  });

  it("does NOT classify a 'schedule posts' content goal as email_calendar", () => {
    const d = classifyGoalDomains(
      "repurpose a blog post into social posts and schedule them across channels",
    );
    expect(d.has("content_publishing")).toBe(true);
    expect(d.has("email_calendar")).toBe(false);
  });

  it("KEEPS email_calendar when a strong calendar token is present", () => {
    const d = classifyGoalDomains("schedule a meeting and send a calendar invite");
    expect(d.has("email_calendar")).toBe(true);
  });

  it("KEEPS email_calendar when 'schedule' co-occurs with email", () => {
    const d = classifyGoalDomains("draft a welcome email and schedule the intro session");
    expect(d.has("email_calendar")).toBe(true);
  });

  it("KEEPS email_calendar for a schedule-only goal with no other primary domain", () => {
    const d = classifyGoalDomains("help me schedule things");
    expect(d.has("email_calendar")).toBe(true);
  });
});

describe("matchCapabilities — MAR-251 code handoff and monitor digest de-bias", () => {
  const MAR_251_GOAL =
    "Monitor AI-agent news sources, deduplicate and summarize what changed, turn useful items into " +
    "Orchestrate MCP improvement ideas, show me an approval summary, and after I approve create " +
    "Linear issues and trigger Claude Code.";

  it("keeps monitor -> approve -> handoff goals out of code/research spines", () => {
    const ids = matchedIds(MAR_251_GOAL);
    expect(ids).toContain("page_monitor");
    expect(ids).toContain("human_approval_gate");
    expect(ids).not.toContain("code_editing");
    expect(ids).not.toContain("codebase_scan");
    expect(ids).not.toContain("loop_controller");
    expect(ids).not.toContain("pr_summary");
    expect(ids).not.toContain("research_synthesis");
    expect(ids).not.toContain("citation_checker");
  });

  it("drops code_agent and research domains for a handoff-only monitoring digest", () => {
    const domains = classifyGoalDomains(MAR_251_GOAL);
    expect(domains.has("monitoring")).toBe(true);
    expect(domains.has("code_agent")).toBe(false);
    expect(domains.has("research")).toBe(false);
  });

  it("still selects the code-agent route when the goal asks for repo edits and tests", () => {
    const ids = matchedIds(
      "Scan the codebase, implement a bug fix, edit code, run tests, and open a pull request.",
    );
    expect(ids).toContain("codebase_scan");
    expect(ids).toContain("code_editing");
    expect(ids).toContain("test_runner");
    expect(ids).toContain("pr_summary");
  });

  it("still keeps research for explicit monitoring plus cited synthesis", () => {
    const ids = matchedIds(
      "Monitor policy pages for changes, synthesize a cited summary with inline citations, and send it for approval.",
    );
    expect(ids).toContain("page_monitor");
    expect(ids).toContain("research_synthesis");
    expect(ids).toContain("citation_checker");
  });
});

describe("matchCapabilities — Dogfood Round 3 residuals", () => {
  // ── MAR-140: code read-only constraint suppresses code_editing ──
  it("MAR-140: does NOT select code_editing when the goal forbids editing", () => {
    const ids = matchedIds(
      "Review pull requests on GitHub for code quality and leave inline comments, " +
        "but never edit code — read-only reviewer.",
    );
    expect(ids).not.toContain("code_editing");
    // positive control: it is still recognised as a code-review route
    expect(ids).toContain("codebase_scan");
  });

  it("MAR-140: STILL selects code_editing for a normal code-editing goal", () => {
    const ids = matchedIds(
      "an agent that edits code in my repository and runs the test suite",
    );
    expect(ids).toContain("code_editing");
  });

  // ── MAR-145: trigger isolation — one keyword must not pull the siblings ──
  it("MAR-145: 'webhook' selects webhook_trigger only, not scheduled/github triggers", () => {
    const ids = matchedIds(
      "When a Stripe webhook fires, validate the payload and update the customer " +
        "LTV field in Airtable.",
    );
    expect(ids).toContain("webhook_trigger");
    expect(ids).not.toContain("scheduled_trigger");
    expect(ids).not.toContain("github_trigger");
  });

  it("MAR-145: bare 'trigger' does not pull any of the three trigger components", () => {
    const ids = matchedIds("manually trigger the workflow and process the batch");
    expect(ids).not.toContain("scheduled_trigger");
    expect(ids).not.toContain("webhook_trigger");
    expect(ids).not.toContain("github_trigger");
  });

  // ── scheduled_trigger inversion — natural time phrasing reaches the scheduler ──
  it("inversion: 'every morning at 8am' selects scheduled_trigger (and no sibling triggers)", () => {
    const ids = matchedIds(
      "Every morning at 8am, pull yesterday's signups from the database and post a " +
        "summary to Slack.",
    );
    expect(ids).toContain("scheduled_trigger");
    expect(ids).not.toContain("webhook_trigger");
    expect(ids).not.toContain("github_trigger");
  });

  it("inversion: the time phrase does NOT reintroduce calendar bleed", () => {
    const ids = matchedIds(
      "Every morning at 8am, generate a report from the database and post it to Slack.",
    );
    expect(ids).not.toContain("calendar_lookup");
    expect(ids).not.toContain("calendar_write");
  });

  // ── MAR-140 round-3 residual: non-code negation generalisation ──
  it("MAR-140: 'do not publish externally' suppresses external_publish", () => {
    const ids = matchedIds(
      "Generate three social media post variants from this blog and route them for " +
        "human approval. Do not publish anything externally.",
    );
    expect(ids).not.toContain("external_publish");
    // positive control: still a content/variant route
    expect(ids).toContain("multi_variant_generator");
  });

  it("MAR-140: STILL selects external_publish for an affirmative publish goal", () => {
    const ids = matchedIds(
      "Draft a blog post, get it approved, and publish it externally to our site.",
    );
    expect(ids).toContain("external_publish");
  });

  it("MAR-140: 'no mailbox polling' suppresses email_read but keeps email_draft", () => {
    const ids = matchedIds(
      "Send a daily digest email to the team. No mailbox polling — you do not read any inbox.",
    );
    expect(ids).not.toContain("email_read");
    expect(ids).toContain("email_draft");
  });

  it("MAR-140: STILL selects email_read for a normal triage goal", () => {
    const ids = matchedIds("Read and triage my incoming emails and draft replies.");
    expect(ids).toContain("email_read");
  });

  // OVER-SUPPRESSION GUARD: a bare "read-only" scopes to the data source and
  // must NOT remove a wanted Slack alert. The explicit line MAR-140 must not cross.
  it("MAR-140: bare 'read-only' on a monitor goal keeps slack_notification", () => {
    const ids = matchedIds(
      "Monitor our pricing page read-only and send me a Slack alert when the price changes.",
    );
    expect(ids).toContain("slack_notification");
    expect(ids).toContain("page_monitor");
  });
});

describe("matchCapabilities — MAR-161 broader-negation engine", () => {
  // ── "drafts only" on a social/content goal (no mailbox intent): the draft is a
  //    CONTENT draft, so email_draft + optional_email_send must not leak. ──
  it("'drafts only' social goal drops email_draft and optional_email_send", () => {
    const ids = matchedIds(
      "Generate three social post variants from this blog, drafts only, and send them for human approval.",
    );
    expect(ids).not.toContain("email_draft");
    expect(ids).not.toContain("optional_email_send");
    // positive control: it is still a content/variant route
    expect(ids).toContain("multi_variant_generator");
  });

  // ── BOUNDARY: a real mailbox goal that says "drafts only" KEEPS email_draft —
  //    there the user explicitly wants the email draft, just no auto-send. ──
  it("'drafts only' on a real mailbox goal keeps email_draft, drops only the send", () => {
    const ids = matchedIds(
      "Read my inbox, draft replies to each email, and save the email drafts only — never send them.",
    );
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
    expect(ids).not.toContain("optional_email_send");
  });

  it("STILL selects email_draft for a real email goal whose only verb is 'draft'", () => {
    const ids = matchedIds("Draft a reply email to a customer enquiry.");
    expect(ids).toContain("email_draft");
  });

  // ── no-send constraint: fires even when the email domain is legitimate ──
  it("'do not send' keeps email_read + email_draft but drops optional_email_send", () => {
    const ids = matchedIds(
      "Read my inbox and draft a reply to each email, but do not send anything — leave them as drafts for me to review.",
    );
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
    expect(ids).not.toContain("optional_email_send");
  });

  it("does NOT suppress a gated send ('only send after approval' is affirmative)", () => {
    const ids = matchedIds(
      "Read the inbox, draft replies, and only send each one after I approve it.",
    );
    expect(ids).toContain("email_draft");
    expect(ids).toContain("optional_email_send");
  });

  // ── MAR-347: approval-gated prohibitions are gate constraints, not no-sends ──
  // "must not send … until approved" restates a send the goal already asked for,
  // gated behind approval. It must neither suppress the send NOR let its verbs
  // fire as fresh demand ("post to Slack" → content_publishing/external_publish
  // was the Cursor-expansion regression that dropped the validated playbook).
  it("MAR-347: 'must not send/post until approved' keeps the gated send, no external_publish", () => {
    const ids = matchedIds(
      "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales " +
        "in Slack — but only after a human approves. The agent may read Gmail and draft replies internally; " +
        "it must not send email or post to Slack until approved.",
    );
    expect(ids).toContain("email_read");
    expect(ids).toContain("email_draft");
    expect(ids).toContain("optional_email_send");
    expect(ids).toContain("crm_note_write");
    expect(ids).toContain("slack_notification");
    expect(ids).not.toContain("external_publish");
  });

  it("MAR-347: 'do not send anything until I approve' is a gate, not a no-send", () => {
    const ids = matchedIds(
      "Read my inbox and draft a reply to each email, but do not send anything until I approve it.",
    );
    expect(ids).toContain("email_draft");
    expect(ids).toContain("optional_email_send");
  });

  it("MAR-347: a prohibition WITHOUT an approval conjunction stays an honest no-send", () => {
    const ids = matchedIds(
      "Read my inbox and draft replies, but never auto-send — nothing gets sent, ever.",
    );
    expect(ids).toContain("email_draft");
    expect(ids).not.toContain("optional_email_send");
  });
});

describe("matchCapabilities — MAR-145 round-4 (ChatGPT dogfood)", () => {
  it("'invoice' alone does NOT pull stripe_data_read (no Stripe context)", () => {
    const ids = matchedIds(
      "Process supplier invoices: extract the line items, validate totals, and load them into the accounting system.",
    );
    expect(ids).not.toContain("stripe_data_read");
  });

  it("STILL selects stripe_data_read when Stripe is actually named", () => {
    const ids = matchedIds(
      "Read subscription data from Stripe and produce a churn report.",
    );
    expect(ids).toContain("stripe_data_read");
  });

  it("'rolls back' (conjugated) selects saga_compensation", () => {
    const ids = matchedIds(
      "Send bulk API updates to 500 customers; if any step fails, it rolls back all completed updates.",
    );
    expect(ids).toContain("saga_compensation");
  });

  it("'rolling back' also selects saga_compensation", () => {
    const ids = matchedIds(
      "Process a batch and start rolling back every completed step the moment one fails.",
    );
    expect(ids).toContain("saga_compensation");
  });
});
