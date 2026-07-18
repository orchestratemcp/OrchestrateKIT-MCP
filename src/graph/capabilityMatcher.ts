import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import { neutralizeApprovalGatedProhibitions } from "../lib/constraintSignals.js";

/**
 * Which scoring pass produced a match token (MAR-250). "hint" and "segment" are
 * STRONG evidence — the goal named the concept (explicit keyword hint) or used a
 * word that IS the component's identifier. "capability" and "summary" are FUZZY
 * evidence — a goal word merely appeared somewhere in the component's prose. A
 * component selected on fuzzy evidence alone has no goal phrase that actually
 * asked for it (the crm_note_write-on-a-Postgres-report failure class).
 */
export type MatchEvidenceKind = "hint" | "segment" | "capability" | "summary";

export type CapabilityMatch = {
  component: Component;
  score: number;
  matched_tokens: string[];
  /** Distinct scoring passes that contributed to this match (MAR-250). */
  evidence: MatchEvidenceKind[];
};

export type MatchResult = {
  matches: CapabilityMatch[];
  missing_capabilities: string[];
  /** Workflow domains detected in the goal (rules-first classifier). */
  domains: Domain[];
  /** Edge ids whose `to` component was score-penalised by an avoid_when conflict. */
  avoid_penalized: string[];
};

/**
 * Workflow domains (MAR-88). A goal is classified into zero or more of these
 * by deterministic keyword rules; `generic_orchestration` is ALWAYS present so
 * orchestration/safety components are never domain-blocked.
 */
export type Domain =
  | "research"
  | "content_publishing"
  | "email_calendar"
  | "data_etl"
  | "code_agent"
  | "crm_sales"
  | "monitoring"
  | "notification"
  | "chat"
  | "knowledge"
  | "generic_orchestration";

/**
 * Component → domain membership. A component is only eligible to match when at
 * least one of its domains is present in the classified goal. Components not
 * listed default to `generic_orchestration` (always eligible) — but every
 * registry component is listed explicitly so eligibility is never accidental.
 *
 * This is the negative guard: it replaces the old 5-entry DOMAIN_GUARDS and the
 * unconstrained ID-substring pass that injected cross-domain noise (pr_summary
 * on research, external_publish on ETL, design_brief_generation on email, …).
 */
const COMPONENT_DOMAINS: Record<string, Domain[]> = {
  // research (synthesis/ranking/citation/freshness are shared with the knowledge
  // domain — they ground answers over both external sources and an owned corpus)
  source_retrieval: ["research"],
  source_ranking: ["research", "knowledge"],
  source_freshness_check: ["research", "knowledge"],
  citation_checker: ["research", "knowledge"],
  research_synthesis: ["research", "knowledge"],
  // content_publishing
  content_idea_intake: ["content_publishing"],
  copy_generation: ["content_publishing"],
  design_brief_generation: ["content_publishing"],
  external_publish: ["content_publishing"],
  // email_calendar
  email_read: ["email_calendar"],
  email_draft: ["email_calendar"],
  gmail_draft_write: ["email_calendar"],
  optional_email_send: ["email_calendar"],
  calendar_lookup: ["email_calendar"],
  calendar_write: ["email_calendar"],
  // data_etl
  data_scraper: ["data_etl"],
  data_normalizer: ["data_etl"],
  deduplication: ["data_etl"],
  pdf_extraction: ["data_etl"],
  airtable_lookup: ["data_etl"],
  stripe_data_read: ["data_etl"],
  // MAR-244: file_storage is the generic "store it somewhere" write. It belongs to
  // data_etl (extract → normalise → store) but is ALSO generic_orchestration so a
  // "save the results to a spreadsheet" step routes in any domain. HINT_ONLY (see
  // below), so the dual membership never fuzzy-bleeds — only its explicit storage
  // hints select it.
  file_storage: ["data_etl", "generic_orchestration"],
  // MAR-254: the data-report spine. db_read is the read-only SQL/warehouse
  // source ("pull the numbers from our Postgres database") and report_generation
  // the document-CREATION direction ("generate a PDF summary report") —
  // pdf_extraction is the opposite arrow. Both are data_etl-native but ALSO
  // generic_orchestration so a scheduled-report goal with no other ETL vocabulary
  // still reaches them. Both HINT_ONLY (see below): their id/summary tokens
  // ("read", "report", "data", "generate") are among the most ambient words in
  // any goal, so only their explicit hints ever select them.
  db_read: ["data_etl", "generic_orchestration"],
  report_generation: ["data_etl", "generic_orchestration"],
  // code_agent
  codebase_scan: ["code_agent"],
  code_editing: ["code_agent"],
  plan_generation: ["code_agent"],
  test_runner: ["code_agent"],
  pr_summary: ["code_agent"],
  // crm_sales
  crm_note_write: ["crm_sales"],
  crm_record_read: ["crm_sales"],
  lead_enrichment: ["crm_sales"],
  deal_stage_update: ["crm_sales"],
  // monitoring
  page_monitor: ["monitoring"],
  metric_threshold_monitor: ["monitoring"],
  log_monitor: ["monitoring"],
  uptime_check: ["monitoring"],
  // notification
  slack_notification: ["notification"],
  discord_notification: ["notification"],
  teams_notification: ["notification"],
  telegram_notification: ["notification"],
  // chat — inbound conversational entrypoint (HINT_ONLY; see below)
  chat_trigger: ["chat"],
  // knowledge — second-brain / project-brain over an OWNED corpus (all HINT_ONLY;
  // phrase-established domain so it never bleeds into ETL "ingest"/research goals)
  knowledge_ingestion: ["knowledge"],
  vector_store: ["knowledge"],
  source_attribution: ["knowledge"],
  note_linking: ["knowledge"],
  // generic_orchestration — always eligible (trigger + infra components)
  scheduled_trigger: ["generic_orchestration"],
  webhook_trigger: ["generic_orchestration"],
  github_trigger: ["code_agent", "generic_orchestration"],
  loop_controller: ["generic_orchestration"],
  fan_out_collector: ["generic_orchestration"],
  reviewer_notification: ["content_publishing", "generic_orchestration"],
  review_draft_composer: ["generic_orchestration"],
  multi_variant_generator: ["generic_orchestration"],
  user_goal_intake: ["generic_orchestration"],
  intent_classifier: ["generic_orchestration"],
  state_store: ["generic_orchestration"],
  audit_log: ["generic_orchestration"],
  retry_policy: ["generic_orchestration"],
  job_queue: ["generic_orchestration"],
  human_approval_gate: ["generic_orchestration"],
  schema_validation: ["generic_orchestration"],
  // MAR-134: control-flow marker components (HINT_ONLY — see below)
  saga_compensation: ["generic_orchestration"],
  // threshold_router is a signal-driven router, eligible in any domain
  threshold_router: ["generic_orchestration"],
};

/**
 * Rules-first domain classifier keywords. Matched as case-insensitive
 * substrings against the goal. Phrases are used where a bare token would
 * over-trigger (e.g. "design tool" instead of "design", "external source" is
 * NOT a research trigger because research uses the plural "sources").
 *
 * IMPORTANT: research is intentionally NOT triggered by the bare word
 * "summary" (so "PR summary" stays a code concern). "summarize"/"summarise" are
 * WEAK research triggers (see WEAK_RESEARCH_KEYWORDS): they count toward the
 * research domain on their own, but are suppressed in a code_agent context with
 * no strong research signal — "summarize a PR" / "scan the codebase and
 * summarize" must not pull research_synthesis (MAR-127).
 */
const DOMAIN_KEYWORDS: Record<Exclude<Domain, "generic_orchestration">, string[]> = {
  research: [
    "research",
    "sources",
    "citation",
    "cite",
    "factual",
    "factuality",
    "synthesize",
    "synthesise",
    "synthesis",
    "summarize",
    "summarise",
    "freshness",
    "recency",
    "literature review",
  ],
  content_publishing: [
    "content",
    "copy",
    "campaign",
    "brand",
    "marketing",
    "publish",
    "post to",
    "social media",
    "cms",
    "blog",
    "article",
    "design brief",
    "design tool",
    "creative asset",
    "visual creation",
  ],
  email_calendar: [
    "email",
    "gmail",
    "inbox",
    "mailbox",
    "reply",
    "replies",
    "draft",
    "calendar",
    "schedule",
    "scheduling",
    "meeting",
    "invite",
    "send email",
    "books",
    " book ",
  ],
  data_etl: [
    "scrape",
    "scraper",
    "crawl",
    "etl",
    "pipeline",
    "normalize",
    "normalise",
    "deduplicate",
    "dedup",
    "ingest",
    "extraction",
    "enrichment",
    "enrich",
    "records",
    "pdf",
    "airtable",
    "stripe",
    "parse",
    // MAR-244: document-extraction + storage terms. "invoice"/"receipt" name the
    // extract-structured-data-from-documents shape; "spreadsheet"/"csv" name the
    // store destination. These establish data_etl so pdf_extraction (the extractor)
    // and file_storage (the destination) become eligible for "read invoices from
    // email → save to a spreadsheet" goals that today collapse to an email-reply
    // route with no extraction and no place to store the result.
    "invoice",
    "invoices",
    "receipt",
    "receipts",
    "spreadsheet",
    "csv",
  ],
  code_agent: [
    "code",
    "codebase",
    "refactor",
    "implement",
    "bug",
    "feature",
    "pull request",
    "unit test",
    "test suite",
    "compile",
    // NB: deliberately no bare "pr" token — it substring-matches "product",
    // "approve", etc. pr_summary still scores via its "summary" id-segment once
    // the code_agent domain is established by the keywords above.
  ],
  crm_sales: [
    "crm",
    "lead",
    "sales",
    "prospect",
    "follow-up",
    "follow up",
    "outreach",
    "hubspot",
    "salesforce",
    "partnership",
    // MAR-242: CRM-specific terms only. NOT "pipeline"/"enrich" — those already
    // belong to data_etl and would bleed an ETL goal into crm_sales. "lead"/"crm"
    // already establish the domain; lead_enrichment routes via its "enrich" hint.
    "deal",
    "opportunity",
  ],
  monitoring: [
    "monitor",
    "poll",
    "watch",
    "track changes",
    "change detection",
    "for changes",
    "uptime",
    // MAR-243: metric / log / availability monitoring. Deliberately specific —
    // not bare "log"/"alert" (too generic: blog/login/catalog) and NOT "threshold"
    // (shared with threshold_router's domain-agnostic routing use). "metric" /
    // "latency" / "error rate" / "downtime" / "anomaly" / "logs" are unambiguous.
    "metric",
    "latency",
    "error rate",
    "downtime",
    "health check",
    "anomaly",
    "logs",
    // MAR-266: price-watch phrasing. "Check 5 competitor product pages every
    // hour; detect price changes…" carries no monitor/watch/poll verb, so the
    // most-repeated Lab monitoring goal never established the domain and
    // page_monitor (HINT_ONLY, monitoring-domain) was unreachable. Phrase-based
    // like the MAR-243 entries — bare "price" would drag pricing/billing goals
    // into monitoring.
    "price change",
    "price drop",
  ],
  notification: [
    "slack",
    "notify",
    "notification",
    "teams",
    "discord",
    "telegram",
  ],
  // chat (MAR-120): a bot that LIVES in a chat platform and responds to people —
  // the inbound/conversational side, distinct from one-way `notification` alerts.
  // Deliberately phrase-based: the bare platform tokens (slack/discord/teams) stay
  // in `notification` so a one-way "alert me on Slack" goal does NOT become a chat
  // goal. Only explicit conversational phrasing establishes the chat domain, and
  // the only chat-domain component (chat_trigger) is HINT_ONLY, so establishing
  // the domain alone never injects anything — a chat hint must also fire.
  chat: [
    "chatbot",
    "chat bot",
    "slack bot",
    "discord bot",
    "teams bot",
    "telegram bot",
    "slash command",
    "responds to messages",
    "respond to messages",
    "responds to dms",
    "respond to dms",
    "answers questions in",
    "answer questions in",
    "when someone messages",
    "when a user messages",
    "when mentioned",
    "conversational agent",
    "support bot",
  ],
  // knowledge (MAR-217): a "second brain" / "project brain" over an OWNED corpus
  // (your notes/docs), distinct from web `research` (external sources) and
  // `data_etl` (records/pipelines — which owns the bare "ingest"/"extraction"
  // tokens). Deliberately PHRASE-based: bare tokens like "rag" (substring of
  // "storage"), "vault" (bank vault) or "wiki" would over-trigger, so the domain
  // is established only by explicit second-brain phrasing, and every knowledge
  // component is HINT_ONLY so establishing the domain alone injects nothing.
  knowledge: [
    "second brain",
    "project brain",
    "knowledge base",
    "knowledge management",
    "knowledge agent",
    "knowledge graph",
    "my notes",
    "my docs",
    "my documents",
    "personal notes",
    "personal knowledge",
    "obsidian",
    "zettelkasten",
    "personal wiki",
    "ask my",
    "ask questions about my",
    "questions about my notes",
    "answer questions from my",
    "answer questions about my",
    "retrieval augmented",
    "retrieval-augmented",
    "rag over",
    "rag pipeline",
    "vector store",
    "vector database",
    "vector index",
    "embeddings",
    "semantic search",
  ],
};

/**
 * Weak research triggers: generic summary verbs that also appear in code,
 * monitoring and email goals. They classify as research on their own, but are
 * suppressed when the goal is a code-agent task with no strong research signal
 * (MAR-127 — "summarize a PR" must not pull research_synthesis).
 */
const WEAK_RESEARCH_KEYWORDS = ["summarize", "summarise"];

/**
 * MAR-251: handoff-to-code-agent phrasing is not code work by itself. "Trigger
 * Claude Code" / "create Linear issues" describes a downstream orchestration
 * handoff; it should not establish the code_agent domain unless the workflow
 * itself also names codebase/repo/edit/test work.
 */
const CODE_HANDOFF_PHRASES = [
  "trigger claude code",
  "hand off to claude code",
  "handoff to claude code",
  "send to claude code",
  "create linear issue",
  "create linear issues",
];

const CODE_WORK_SIGNALS = [
  "codebase",
  "repository",
  " repo",
  "refactor",
  "implement",
  "bug",
  "feature",
  "pull request",
  "unit test",
  "test suite",
  "compile",
  "scan code",
  "scan the code",
  "edit code",
  "code edit",
  "code changes",
  "diff",
  "run tests",
  "tests pass",
];

function isCodeHandoffOnly(goalLower: string): boolean {
  const hasHandoff = CODE_HANDOFF_PHRASES.some((p) => goalLower.includes(p));
  if (!hasHandoff) return false;
  return !CODE_WORK_SIGNALS.some((p) => goalLower.includes(p));
}

/**
 * MAR-251: "monitor news sources and summarize useful items into improvement
 * ideas" is a monitoring digest, not a research workflow. Keep research for
 * explicit research/synthesis/citation goals, but do not let weak digest words
 * pull the citation/research spine into monitor -> approve -> handoff routes.
 */
const MONITORING_RESEARCH_WORK_SIGNALS = [
  "research",
  "citation",
  "cite",
  "cited",
  "factual",
  "factuality",
  "synthesize",
  "synthesise",
  "synthesis",
  "literature review",
  "inline citations",
];

function isMonitoringDigestOnlyResearch(goalLower: string): boolean {
  if (!goalLower.includes("summarize") && !goalLower.includes("summarise")) {
    return false;
  }
  return !MONITORING_RESEARCH_WORK_SIGNALS.some((p) => goalLower.includes(p));
}

/**
 * Weak email_calendar triggers (MAR-131, generalizing MAR-127). "schedule" /
 * "scheduling" name an infra/timing concept ("runs on a schedule", "schedule
 * social posts") far more often than a literal calendar action, so they bleed
 * calendar_lookup/calendar_write into monitoring, content and ETL goals that
 * have nothing to do with a calendar. They stay WEAK email_calendar triggers,
 * but are dropped when the goal has a stronger primary domain and no STRONG
 * email/calendar token (email, inbox, reply, draft, calendar, meeting, invite…).
 *
 * "hourly"/"nightly"/"cron" are pure infra and are intentionally NOT in any
 * DOMAIN_KEYWORDS list — they never establish a domain on their own.
 */
const WEAK_EMAIL_CALENDAR_KEYWORDS = ["schedule", "scheduling"];

/**
 * MAR-219: email_calendar keywords that ALSO describe a chat bot's own behaviour.
 * "reply"/"replies"/"draft" name what a conversational agent does with a message
 * ("posts the reply", "drafts a response in-thread"), not a mailbox action. In a
 * chat goal they must not establish email_calendar and pull email_read/email_draft/
 * optional_email_send into the route. Excluded from the genuine-token recheck that
 * keeps email_calendar alive when a chat goal really is about email (see below).
 */
const CHAT_OVERLAPPING_EMAIL_KEYWORDS = ["reply", "replies", "draft"];

/**
 * Strong, unambiguous email/calendar tokens (MAR-161). Used to tell a real
 * mailbox/calendar goal from one where an email word appears only incidentally.
 * Deliberately EXCLUDES "draft" (a content draft just as often as an email
 * draft), "schedule"/"scheduling" (infra timing) and "book" (overloaded) — those
 * never prove email intent on their own. Negation-aware via the caller.
 */
const STRONG_EMAIL_CALENDAR_TOKENS = [
  "email",
  "gmail",
  "inbox",
  "mailbox",
  "reply",
  "replies",
  "calendar",
  "meeting",
  "invite",
  "send email",
];

/** True when the goal carries a non-negated strong email/calendar token (MAR-161). */
function hasStrongEmailCalendarToken(goalLower: string): boolean {
  return STRONG_EMAIL_CALENDAR_TOKENS.some(
    (t) => goalLower.includes(t) && !isNegatedInContext(goalLower, t),
  );
}

/**
 * Domains strong enough that, when present, a sibling domain established ONLY by
 * weak lexical triggers should be dropped. `generic_orchestration` is excluded —
 * it is always present and must never suppress a real domain.
 */
const PRIMARY_DOMAINS: Exclude<Domain, "generic_orchestration">[] = [
  "research",
  "content_publishing",
  "email_calendar",
  "data_etl",
  "code_agent",
  "crm_sales",
  "monitoring",
  "notification",
];

/**
 * Drop `domain` from `domains` when it was established ONLY by weak lexical
 * triggers AND a different primary domain is present. Shared de-biasing helper
 * for MAR-127 (research/"summarize") and MAR-131 (email_calendar/"schedule").
 *
 * MAR-140: the `hasStrong` recheck must honour negation. A goal like
 * "...write a CRM note ... No outbound emails to customer" establishes
 * email_calendar only via the weak "schedule" token, but the strong keyword
 * "email" is present *in a negated context*. Counting that negated "email" as
 * a strong signal kept email_calendar alive and leaked email_read/email_draft/
 * optional_email_send onto a CRM goal. Applying isNegatedInContext here lets
 * the weak-only suppression fire and drop the spurious domain.
 */
function suppressWeakOnlyDomain(
  domain: Exclude<Domain, "generic_orchestration">,
  weakKeywords: string[],
  goalLower: string,
  domains: Set<Domain>,
): void {
  if (!domains.has(domain)) return;
  const strongKeywords = DOMAIN_KEYWORDS[domain].filter(
    (kw) => !weakKeywords.includes(kw),
  );
  const hasStrong = strongKeywords.some(
    (kw) => goalLower.includes(kw) && !isNegatedInContext(goalLower, kw),
  );
  if (hasStrong) return; // domain legitimately present — keep it
  const hasOtherPrimary = PRIMARY_DOMAINS.some(
    (d) => d !== domain && domains.has(d),
  );
  if (hasOtherPrimary) domains.delete(domain);
}

/**
 * Words that negate what follows them. Used by isNegatedInContext to detect
 * phrases like "no emails sent" that contain a domain keyword in a negated
 * context (MAR-140).
 */
const NEGATION_WORDS = new Set(["no", "not", "never", "without", "don't", "dont"]);
const NEGATION_SCOPE_WORDS = 8;

/**
 * Returns true when `keyword` appears in `text` and the preceding 1-3 words
 * contain a negation word — e.g. "no emails sent", "never send notifications".
 * Only called when the keyword has already been found in text.
 * Exported for the coverage module (MAR-250): a negated demand word is a
 * constraint, not a workflow step, and must never be reported as unmatched demand.
 */
export function isNegatedInContext(text: string, keyword: string): boolean {
  let from = 0;
  let found = false;
  for (;;) {
    const idx = text.indexOf(keyword, from);
    if (idx === -1) return found;
    found = true;

    const sentenceStart = Math.max(
      text.lastIndexOf(".", idx - 1),
      text.lastIndexOf(";", idx - 1),
      text.lastIndexOf("!", idx - 1),
      text.lastIndexOf("?", idx - 1),
      text.lastIndexOf("\n", idx - 1),
    );
    const words =
      text
        .slice(sentenceStart + 1, idx)
        .toLowerCase()
        .match(/[a-z']+/g)
        ?.slice(-NEGATION_SCOPE_WORDS) ?? [];
    let negationIndex = -1;
    for (let i = words.length - 1; i >= 0; i -= 1) {
      if (NEGATION_WORDS.has(words[i])) {
        negationIndex = i;
        break;
      }
    }
    const adversativeAfterNegation =
      negationIndex >= 0 &&
      words
        .slice(negationIndex + 1)
        .some((word) => ["but", "however", "except"].includes(word));
    if (negationIndex === -1 || adversativeAfterNegation) return false;
    from = idx + keyword.length;
  }
}

/**
 * MAR-140: phrases that forbid editing / writing / committing code. When one is
 * present in a code-agent goal, code_editing — the only write-side component in
 * the code domain — must be suppressed.
 *
 * This is the most dangerous class of matcher leak: proposing a write step when
 * the user explicitly forbade it ("GitHub PR review, never edit code, read-only"
 * still yielded code_editing in Dogfood Round 3). The trigger token for
 * code_editing is the bare word "code", so the negation ("never edit") never
 * reaches it via isNegatedInContext — it needs an explicit constraint check.
 *
 * Scoped to the code domain on purpose: a bare "read-only" in a monitoring or
 * data goal scopes to the DATA SOURCE, not the whole workflow (you can be
 * "read-only" on a page yet still want a Slack alert), so generalising this to
 * every write component would over-suppress. Other domains' read-only semantics
 * stay un-wired until dogfooding gives evidence (tracked on MAR-140).
 */
const CODE_READONLY_PHRASES = [
  "read-only",
  "read only",
  "readonly",
  "never edit",
  "never write",
  "never modify",
  "never change",
  "never commit",
  "never push",
  "don't edit",
  "do not edit",
  "dont edit",
  "don't modify",
  "do not modify",
  "don't write",
  "do not write",
  "without editing",
  "without modifying",
  "without writing",
  "without committing",
  "no edits",
  "no code changes",
  "no commits",
  "suggest only",
  "review only",
  "comment only",
];

/**
 * Negation / constraint suppression engine (MAR-161, generalising MAR-140).
 *
 * The matcher honours explicit user constraints that FORBID a capability by
 * dropping the named component(s) from the eligible set before scoring. This is
 * one structured, data-driven table that replaces the two ad-hoc mechanisms that
 * grew during MAR-140 (the inline code_editing check + a per-component
 * NEGATED_CAPABILITY_PHRASES list). Adding a new constraint is now one entry.
 *
 * Each rule:
 *   - `components`     — dropped when any phrase matches.
 *   - `phrases`        — explicit constraints. Every phrase NAMES the forbidden
 *                        action AND carries its own negation ("do not publish",
 *                        "no mailbox polling", "drafts only", "do not send"), so
 *                        a rule never fires on an affirmative goal ("publish to
 *                        our blog", "send the welcome email"). Gated/queued
 *                        sends ("only send after approval", "before sending") are
 *                        affirmative and deliberately absent.
 *   - `requireDomain?` — when set, the rule only fires if that domain is present.
 *                        Used for the code read-only case, which must stay code-
 *                        scoped: a bare "read-only" in a monitoring/data goal
 *                        scopes to the data SOURCE, not the workflow (you can be
 *                        read-only on a page yet still want a Slack alert — see
 *                        the readonly_monitor_keeps_slack probe).
 *   - `requireNoStrongEmail?` — when set, the rule only fires if the goal has NO
 *                        strong email/calendar token. Lets "drafts only" drop
 *                        email_draft on a social/content goal ("social posts,
 *                        drafts only") while NEVER touching a real mailbox goal
 *                        ("save the email drafts only, don't send"), where
 *                        email_draft is exactly what the user wants.
 *
 * Suppression happens at the domainAllowed stage; nothing downstream re-adds a
 * dropped component (compose Step 3 expands `requires` only — none of these are
 * required by another component — and the safety augmenter adds only safety
 * components). It does NOT touch the playbook path, where a fixed component list
 * is served and MAR-142's write-constraint warning is the right surface.
 */
type CapabilitySuppressionRule = {
  components: string[];
  phrases: string[];
  requireDomain?: Domain;
  requireNoStrongEmail?: boolean;
};

const CAPABILITY_SUPPRESSION_RULES: CapabilitySuppressionRule[] = [
  // code_editing — read-only / no-edit code review (MAR-140). Code-scoped.
  {
    components: ["code_editing"],
    requireDomain: "code_agent",
    phrases: CODE_READONLY_PHRASES,
  },
  // external_publish — "do not publish externally" (MAR-140 round-3).
  {
    components: ["external_publish"],
    phrases: [
      "do not publish",
      "don't publish",
      "dont publish",
      "never publish",
      "no publishing",
      "no external publish",
      "no external publishing",
      "without publishing",
      "do not post publicly",
      "don't post publicly",
      "no public post",
      "not for publishing",
    ],
  },
  // email_read — "no mailbox polling" / "do not read the inbox" (MAR-140 round-3).
  {
    components: ["email_read"],
    phrases: [
      "no mailbox polling",
      "no inbox polling",
      "don't poll the mailbox",
      "do not read email",
      "don't read email",
      "dont read email",
      "do not read emails",
      "don't read emails",
      "no email reading",
      "without reading email",
      "no mailbox access",
      "don't read my inbox",
      "do not read my inbox",
      "no reading the inbox",
    ],
  },
  // optional_email_send — the "no-send" class: produce a draft but never send it
  // (MAR-161). Fires even when the email domain is legitimately present (e.g.
  // "draft replies but do not send them"). Phrases are high-precision: gated
  // sends ("only send after approval", "before sending") are affirmative and
  // absent, so a wanted gated send is never suppressed.
  {
    components: ["optional_email_send"],
    phrases: [
      "drafts only",
      "draft only",
      "drafts-only",
      "draft-only",
      "prepare a reply",
      "prepare the reply",
      "do not send",
      "don't send",
      "dont send",
      "no sending",
      "without sending",
      "never auto-send",
      "no auto-send",
      "don't auto-send",
      "do not auto-send",
      "never auto send",
      "no auto send",
      // MAR-244: the "nothing gets sent" negation class. The re-dogfood invoice
      // goals ("save invoices to a spreadsheet. Nothing gets sent out." / "Draft
      // nothing externally without my approval.") read FROM email but forbid any
      // outbound send, yet still routed optional_email_send — a negation-blind
      // hallucinated external write (MAR-140 family). These phrases carry their own
      // negation, so they never fire on an affirmative send goal.
      "nothing gets sent",
      "nothing sent out",
      "nothing is sent",
      "nothing goes out",
      "nothing sent externally",
      "nothing to send",
      "draft nothing",
      "no outbound email",
      "no outbound emails",
      "no emails sent",
      "no email sent",
    ],
  },
  // email_draft — a "drafts only" / "draft only" goal with NO real mailbox intent
  // is producing CONTENT drafts (social posts, an article), so email_draft is
  // noise (MAR-161, the `drafts_only_social` residual). Gated by requireNoStrongEmail
  // so a genuine mailbox goal ("save the email drafts only, never send") keeps
  // email_draft — there the user explicitly wants the email draft.
  {
    components: ["email_draft"],
    phrases: ["drafts only", "draft only", "drafts-only", "draft-only"],
    requireNoStrongEmail: true,
  },
  // calendar_write — "do not change my calendar" / "don't touch my calendar".
  // The email/calendar domain is present whenever a mailbox goal also mentions
  // the calendar, so the bare "calendar" KEYWORD_HINT pulls calendar_write even
  // when the goal explicitly forbids any calendar change ("summarize my inbox …
  // do not change my calendar"). This was the calendar-side sibling of the
  // optional_email_send "do not send" rule: the send negation was honoured but
  // the calendar-write negation had no rule, so a read-only digest goal still
  // routed a calendar write (adversarial-batch finding). Every phrase names the
  // calendar AND carries its own negation, so an affirmative "add the meeting to
  // my calendar" goal never matches.
  {
    components: ["calendar_write"],
    phrases: [
      "do not change my calendar",
      "don't change my calendar",
      "dont change my calendar",
      "do not touch my calendar",
      "don't touch my calendar",
      "dont touch my calendar",
      "do not modify my calendar",
      "don't modify my calendar",
      "do not add to my calendar",
      "don't add to my calendar",
      "do not add anything to my calendar",
      "don't add anything to my calendar",
      "no calendar changes",
      "no calendar writes",
      "without changing my calendar",
      "without touching my calendar",
      "leave my calendar alone",
      "read-only calendar",
    ],
  },
];

/**
 * Drop every component whose explicit constraint phrase is present in the goal
 * (MAR-161). Mutates `domainAllowed`.
 */
function suppressConstrainedCapabilities(
  goalLower: string,
  domainAllowed: Set<string>,
  goalDomains: Set<Domain>,
): void {
  for (const rule of CAPABILITY_SUPPRESSION_RULES) {
    if (rule.requireDomain && !goalDomains.has(rule.requireDomain)) continue;
    if (rule.requireNoStrongEmail && hasStrongEmailCalendarToken(goalLower)) continue;
    if (rule.phrases.some((p) => goalLower.includes(p))) {
      for (const c of rule.components) domainAllowed.delete(c);
    }
  }
}

/**
 * MAR-302: email-as-document-SOURCE scoping. When a goal reads an inbox to
 * INGEST documents (invoices / receipts / purchase orders) for extraction and
 * downstream processing — and expresses NO affirmative email-correspondence
 * intent — email is a SOURCE, not a mailbox the agent writes back to. The bare
 * "email" KEYWORD_HINT pulls email_draft + optional_email_send onto these goals
 * (the "monitor a shared email inbox for PDF invoices → validate against a PO →
 * route to accounting" shape), a drafting/sending path the goal never asked for.
 * On the invoice_intake_po_match shape it dragged the composed route to 10
 * components (precision 0.60 < the 0.72 playbook floor) and, because both are
 * primary-domain category, MAR-128 would re-append them even to a playbook
 * route — so no probe `forbidden` can hide them.
 *
 * Unlike CAPABILITY_SUPPRESSION_RULES (explicit negation phrases that name the
 * forbidden action), this is SHAPE-based, so it is gated hard to never drop a
 * wanted draft: it fires ONLY when the document-source data_etl signal is
 * present AND no correspondence-intent token appears. An affirmative "read
 * invoices from email and draft a reply to the vendor" keeps both components.
 * email_read itself is untouched — reading the inbox is the whole point.
 */
const EMAIL_SOURCE_TOKENS = ["email", "inbox", "mailbox"];
const DOCUMENT_SOURCE_TOKENS = [
  "invoice",
  "invoices",
  "receipt",
  "receipts",
  "purchase order",
  "purchase orders",
];
const EMAIL_CORRESPONDENCE_INTENT = [
  "reply",
  "replies",
  "respond",
  "response",
  "draft a",
  "draft an",
  "draft the",
  "draft repl",
  "compose",
  "write back",
  "send an email",
  "send email",
  "email back",
  "email them",
  "email me",
  "email us",
  "email the",
  "email a ",
  "auto-respond",
  "autorespond",
  "acknowledge",
];
function suppressEmailDraftForDocumentSource(
  goalLower: string,
  domainAllowed: Set<string>,
  goalDomains: Set<Domain>,
): void {
  if (!goalDomains.has("data_etl")) return;
  if (!EMAIL_SOURCE_TOKENS.some((t) => goalLower.includes(t))) return;
  if (!DOCUMENT_SOURCE_TOKENS.some((t) => goalLower.includes(t))) return;
  if (EMAIL_CORRESPONDENCE_INTENT.some((t) => goalLower.includes(t))) return;
  domainAllowed.delete("email_draft");
  // P0-04: the draft SAVE follows the draft. A document-extraction goal with no
  // correspondence intent has nothing to persist to a mailbox, so suppressing
  // email_draft while leaving its write-side sibling reachable would just move
  // the hallucinated write one step downstream.
  domainAllowed.delete("gmail_draft_write");
  domainAllowed.delete("optional_email_send");
  // Documents arrive as inbox attachments — the source is email + PDF, not a
  // website, so the web scraper and the web-page monitor are both noise here
  // (they re-enter the composed route once the drafting path is gone; "monitors
  // a shared email inbox" trips page_monitor on the verb "monitor"). Gated on
  // the email-source token above so a genuine "scrape/monitor a supplier portal"
  // goal keeps them.
  domainAllowed.delete("data_scraper");
  domainAllowed.delete("page_monitor");
}

const EMAIL_SUMMARY_INTENT = ["summarize", "summarise", "summary", "digest", "bullet"];

/** Email is a read-only source in a summary goal unless correspondence is explicit. */
function suppressEmailDraftForInboxSummary(
  goalLower: string,
  domainAllowed: Set<string>,
): void {
  if (!domainAllowed.has("email_read")) return;
  if (!EMAIL_SOURCE_TOKENS.some((token) => goalLower.includes(token))) return;
  if (!EMAIL_SUMMARY_INTENT.some((token) => goalLower.includes(token))) return;
  if (EMAIL_CORRESPONDENCE_INTENT.some((token) => goalLower.includes(token))) return;
  domainAllowed.delete("email_draft");
  domainAllowed.delete("gmail_draft_write");
  domainAllowed.delete("optional_email_send");
}

/**
 * MAR-303: crm_note_write-on-a-Postgres-report suppression. crm_note_write is
 * deliberately kept fuzzy-matchable as the default CRM write (MAR-242), but the
 * bare data-subject token "sales" (e.g. "pull last week's SALES numbers from our
 * Postgres database") establishes the crm_sales domain and its fuzzy id/summary
 * tokens then select crm_note_write onto a pure data-report goal that never
 * touches a CRM. It survives the top-N composed cut and degrades a scheduled
 * DB→report→Slack plan to L3/non-autonomous (crm_note_write is an external
 * write) when the goal is unattended and notification-only.
 *
 * Suppress crm_note_write ONLY in the data-report shape: a database SOURCE token
 * is present AND no genuine CRM-write intent token appears. A real CRM goal
 * ("log a CRM note after the sales call", "detect leads and write a CRM note")
 * always names crm / contact / lead / a CRM product, so it keeps crm_note_write;
 * MAR-242's default-fuzzy behaviour is untouched everywhere outside this shape.
 */
const DATABASE_SOURCE_TOKENS = [
  "database",
  "postgres",
  "postgresql",
  "mysql",
  "sql ",
  "sql database",
  "data warehouse",
  "warehouse",
  "bigquery",
  "snowflake",
  "redshift",
];
const CRM_WRITE_INTENT = [
  "crm",
  "contact",
  "lead",
  "prospect",
  "deal",
  "hubspot",
  "salesforce",
  "pipedrive",
  "opportunity",
];
function suppressCrmNoteForDataReport(
  goalLower: string,
  domainAllowed: Set<string>,
): void {
  if (!DATABASE_SOURCE_TOKENS.some((t) => goalLower.includes(t))) return;
  if (CRM_WRITE_INTENT.some((t) => goalLower.includes(t))) return;
  domainAllowed.delete("crm_note_write");
}

/**
 * MAR-303: "in the loop" idiom suppression for loop_controller. The idiom "no
 * human in the loop" / "human in the loop" / "keep me in the loop" is an
 * attended/unattended phrase — the OPPOSITE of asking for iteration — but the
 * bare token "loop" fuzzy-matches loop_controller's id-segment, injecting a
 * loop primitive (and the misleading dynamic-worker loop_guidance) into a plain
 * scheduled report/monitor plan. loop_controller must STAY fuzzy-matchable for
 * genuine batch/fan-out/saga goals (they select it via "batch"/"parallel"
 * summary tokens, not a "loop" word), so this is not a HINT_ONLY exclusion:
 * drop loop_controller ONLY when the idiom is present AND the goal carries no
 * genuine iteration / fan-out / rollback signal. A fan-out goal that also says
 * "no human in the loop" keeps loop_controller via its fan-out signal.
 */
const IN_THE_LOOP_IDIOM = ["in the loop"];
const GENUINE_ITERATION_SIGNAL = [
  "fan out",
  "fan-out",
  "fanout",
  "batch",
  "parallel",
  "iterate",
  "iterating",
  "iteration",
  "loop until",
  "feedback loop",
  "retry loop",
  "saga",
  "roll back",
  "rollback",
  "each item",
  "one at a time",
  "until the tests pass",
  "until approved",
  // MAR-348: revision-loop idioms are genuine iteration — keep loop_controller
  // even when the goal also contains the "in the loop" idiom.
  "revise until",
  "keep improving",
  "keep revising",
  "back and forth",
  "rounds",
];
function suppressLoopControllerForIdiom(
  goalLower: string,
  domainAllowed: Set<string>,
): void {
  if (!IN_THE_LOOP_IDIOM.some((t) => goalLower.includes(t))) return;
  if (GENUINE_ITERATION_SIGNAL.some((t) => goalLower.includes(t))) return;
  domainAllowed.delete("loop_controller");
}

/**
 * Adversarial-batch finding: "post to Slack/Discord/Teams/Telegram" is a
 * NOTIFICATION, not publishing. The content_publishing "post to" domain trigger
 * plus the "post" external_publish KEYWORD_HINT together injected external_publish
 * onto notify-only goals ("check the status page and post to Slack if it's down").
 * Because external_publish is an irreversible external write, the bleed also
 * dragged a human_approval_gate onto an explicitly unattended flow.
 *
 * Same shape as suppressCrmNoteForDataReport: drop external_publish ONLY when a
 * "post … <chat platform>" phrase is present AND the goal carries no genuine
 * publish intent (publish / blog / article / social / cms / website / a
 * publishing destination). A real "publish to our blog and also ping Slack" goal
 * keeps external_publish via its genuine publish token.
 */
const CHAT_POST_PHRASES = [
  "post to slack",
  "post in slack",
  "post it to slack",
  "posts to slack",
  "post a message to slack",
  "post to our slack",
  "post to the slack",
  "post to a slack",
  "post to discord",
  "post in discord",
  "post to teams",
  "post in teams",
  "post to telegram",
  "post in telegram",
  "post to the channel",
  "post to a channel",
  "post to our channel",
  "post in the channel",
  "message to slack",
];
const GENUINE_PUBLISH_INTENT = [
  "publish",
  "blog",
  "article",
  "social media",
  "social post",
  "to our site",
  "to the website",
  "to our website",
  "cms",
  "publicly",
  "externally",
  "wordpress",
  "medium",
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
  "newsletter",
];
function suppressExternalPublishForChatPost(
  goalLower: string,
  domainAllowed: Set<string>,
): void {
  if (!domainAllowed.has("external_publish")) return;
  if (GENUINE_PUBLISH_INTENT.some((t) => goalLower.includes(t))) return;
  if (!CHAT_POST_PHRASES.some((p) => goalLower.includes(p))) return;
  domainAllowed.delete("external_publish");
}

/**
 * P0-03: agent-run-observability de-bias for log_monitor, same shape as the
 * MAR-251 handoff-bleed suppression. Phrases about watching the AGENT'S OWN
 * execution — "visible run logs", "run logs", "run history", "watch it run",
 * "see what it did" — describe the manifest monitoring/observability section
 * (agent.manifest.json), not a step that queries an external log provider.
 * The bare "logs" DOMAIN_KEYWORD (monitoring domain) and the "logs" KEYWORD_HINT
 * both fire on this phrasing, injecting a phantom log_monitor step — and its
 * Datadog/CloudWatch/Sentry/Loki Connect entry — onto flows that read no
 * external log source at all (the Gmail/Calendar approval-gated dogfood goal).
 *
 * Suppress log_monitor ONLY when a run-observability phrase is present AND no
 * genuine log-SOURCE signal names an actual system to scan (an "application/
 * server/production/system" log noun, an explicit log-scanning verb phrase, or
 * a log-provider product name). A goal that wants both ("watch it run, and
 * also monitor our application logs for errors") keeps log_monitor via its
 * genuine log-source token.
 */
const RUN_OBSERVABILITY_PHRASES = [
  "visible run logs",
  "run logs",
  "run history",
  "watch it run",
  "watch it work",
  "see what it did",
  "see what the agent did",
];
const LOG_SOURCE_WORK_SIGNALS = [
  "application log",
  "application logs",
  "server log",
  "server logs",
  "production log",
  "production logs",
  "system log",
  "system logs",
  "error log",
  "error logs",
  "log aggregator",
  "log errors",
  "scan logs",
  "log files",
  "datadog",
  "cloudwatch",
  "sentry",
  "loki",
];
function suppressLogMonitorForRunObservability(
  goalLower: string,
  domainAllowed: Set<string>,
): void {
  if (!domainAllowed.has("log_monitor")) return;
  if (!RUN_OBSERVABILITY_PHRASES.some((p) => goalLower.includes(p))) return;
  if (LOG_SOURCE_WORK_SIGNALS.some((t) => goalLower.includes(t))) return;
  domainAllowed.delete("log_monitor");
}

/**
 * Classify a goal into workflow domains (MAR-88).
 * Always includes `generic_orchestration` so safety/orchestration components
 * are never blocked. Exported for unit testing.
 */
export function classifyGoalDomains(goal: string): Set<Domain> {
  // MAR-347: an approval-gated prohibition ("must not post to Slack until
  // approved") restates actions the goal already asked for — its verbs must not
  // establish a domain ("post to" → content_publishing was the Cursor-expansion
  // regression that dropped the email_lead_to_crm playbook).
  const goalLower = neutralizeApprovalGatedProhibitions(goal.toLowerCase());
  const domains = new Set<Domain>(["generic_orchestration"]);

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [
    Exclude<Domain, "generic_orchestration">,
    string[],
  ][]) {
    // A keyword hit counts only when it is not negated in context (MAR-140).
    if (keywords.some((kw) => goalLower.includes(kw) && !isNegatedInContext(goalLower, kw))) {
      domains.add(domain);
    }
  }

  if (domains.has("code_agent") && isCodeHandoffOnly(goalLower)) {
    domains.delete("code_agent");
  }

  if (
    domains.has("monitoring") &&
    domains.has("research") &&
    isMonitoringDigestOnlyResearch(goalLower)
  ) {
    domains.delete("research");
  }

  // MAR-127: in a code-agent goal, a weak research trigger (summarize/summarise)
  // alone must not establish the research domain — otherwise research_synthesis
  // bleeds into "summarize a PR" / "scan the codebase and summarize" routes.
  // Kept scoped to code_agent: "summarize" legitimately reads as research in
  // many non-code contexts, so we only suppress it where it is clearly wrong.
  if (domains.has("code_agent") && domains.has("research")) {
    const strongResearch = DOMAIN_KEYWORDS.research.filter(
      (kw) => !WEAK_RESEARCH_KEYWORDS.includes(kw),
    );
    if (!strongResearch.some((kw) => goalLower.includes(kw))) {
      domains.delete("research");
    }
  }

  // MAR-219: in a chat-bot goal, "reply"/"replies"/"draft" describe the bot's own
  // message handling ("posts the reply", "drafts a response"), not a mailbox action.
  // They establish email_calendar and pull email_draft/email_read/optional_email_send
  // into a conversational route (the Discord-bot dogfood bleed). Drop email_calendar
  // when the `chat` domain is present and the goal carries no GENUINE mailbox/calendar
  // token — the chat-overlapping words alone never prove email intent here. Scoped to
  // chat (mirrors the MAR-127 code_agent/research pattern): a real "reply to my inbox"
  // chat goal keeps email_calendar via the genuine "inbox" token.
  if (domains.has("chat") && domains.has("email_calendar")) {
    const genuineEmailCalendar = DOMAIN_KEYWORDS.email_calendar.filter(
      (kw) => !CHAT_OVERLAPPING_EMAIL_KEYWORDS.includes(kw),
    );
    const hasGenuine = genuineEmailCalendar.some(
      (kw) => goalLower.includes(kw) && !isNegatedInContext(goalLower, kw),
    );
    if (!hasGenuine) domains.delete("email_calendar");
  }

  // MAR-131: "schedule"/"scheduling" almost never names a literal calendar
  // action outside an email/calendar goal, so suppress email_calendar whenever
  // it was established only by those weak tokens and any other primary domain is
  // present (monitoring "runs on a schedule", social "schedule posts", …). This
  // stops calendar_lookup/calendar_write from being injected into non-calendar
  // routes — the general form of the MAR-127 bug on a new token/domain pair.
  suppressWeakOnlyDomain(
    "email_calendar",
    WEAK_EMAIL_CALENDAR_KEYWORDS,
    goalLower,
    domains,
  );

  return domains;
}

/**
 * Keyword → component IDs for common workflow domain terms. Supplements
 * token-based matching. Every bump is still gated by the domain allowlist, so
 * these hints can no longer inject cross-domain components. The previous
 * over-generic `lead`/`crm` hints (which pulled research/state components onto
 * sales goals) were removed — those domains have no dedicated component yet.
 */
const KEYWORD_HINTS: Record<string, string[]> = {
  email: ["email_read", "email_draft", "optional_email_send"],
  gmail: ["email_read"],
  inbox: ["email_read"],
  reply: ["email_draft"],
  draft: ["email_draft"],
  // P0-04: gmail_draft_write — the mailbox WRITE that persists the composed
  // reply. Every phrase names the drafts destination ("in gmail drafts", "as a
  // draft", "drafts folder"), never the act of composing: a bare "draft a
  // reply" is email_draft alone and must stay that way, because composing text
  // is not a request to write into the mailbox. "gmail draft" also covers
  // "gmail drafts" by substring.
  "gmail draft": ["gmail_draft_write"],
  "draft in gmail": ["gmail_draft_write"],
  "drafts folder": ["gmail_draft_write"],
  "as a draft": ["gmail_draft_write"],
  "as draft": ["gmail_draft_write"],
  "save the draft": ["gmail_draft_write"],
  "saved draft": ["gmail_draft_write"],
  "save the reply": ["gmail_draft_write"],
  calendar: ["calendar_lookup", "calendar_write"],
  meeting: ["calendar_lookup", "calendar_write"],
  slack: ["slack_notification"],
  // MAR-120: platform notification egresses. Each is HINT_ONLY + lives in the
  // `notification` domain, so it only fires on its own platform token within a
  // notification/chat goal — never cross-matches a sibling platform.
  discord: ["discord_notification"],
  teams: ["teams_notification"],
  telegram: ["telegram_notification"],
  // MAR-120: chat_trigger (inbound). HINT_ONLY + `chat` domain — these phrases both
  // establish the chat domain (DOMAIN_KEYWORDS.chat) and fire the hint, so a real
  // conversational bot goal reaches chat_trigger while a one-way alert never does.
  chatbot: ["chat_trigger"],
  "chat bot": ["chat_trigger"],
  "slack bot": ["chat_trigger"],
  "discord bot": ["chat_trigger"],
  "teams bot": ["chat_trigger"],
  "telegram bot": ["chat_trigger"],
  "slash command": ["chat_trigger"],
  "responds to messages": ["chat_trigger"],
  "respond to messages": ["chat_trigger"],
  "responds to dms": ["chat_trigger"],
  "respond to dms": ["chat_trigger"],
  "answers questions in": ["chat_trigger"],
  "answer questions in": ["chat_trigger"],
  "when someone messages": ["chat_trigger"],
  "when a user messages": ["chat_trigger"],
  "when mentioned": ["chat_trigger"],
  "conversational agent": ["chat_trigger"],
  "support bot": ["chat_trigger"],
  // MAR-217: knowledge / second-brain hints. All gated by the `knowledge` domain
  // (DOMAIN_KEYWORDS.knowledge), so they only fire on a genuine second-brain goal.
  // Ingest phrases pull the ingestion + index pair; query phrases pull the
  // retrieval + grounded-answer + attribution chain.
  "second brain": ["knowledge_ingestion", "vector_store"],
  "project brain": ["knowledge_ingestion", "vector_store"],
  "knowledge base": ["knowledge_ingestion", "vector_store"],
  "my notes": ["knowledge_ingestion", "vector_store"],
  "my docs": ["knowledge_ingestion", "vector_store"],
  "my documents": ["knowledge_ingestion", "vector_store"],
  "personal knowledge": ["knowledge_ingestion", "vector_store"],
  obsidian: ["knowledge_ingestion", "vector_store", "note_linking"],
  zettelkasten: ["knowledge_ingestion", "note_linking"],
  "retrieval augmented": ["vector_store", "research_synthesis"],
  "retrieval-augmented": ["vector_store", "research_synthesis"],
  "rag over": ["vector_store", "research_synthesis"],
  "rag pipeline": ["vector_store", "research_synthesis"],
  "vector store": ["vector_store"],
  "vector database": ["vector_store"],
  "vector index": ["vector_store"],
  embeddings: ["vector_store"],
  "semantic search": ["vector_store"],
  "ask my": ["vector_store", "research_synthesis", "source_attribution"],
  "ask questions about my": ["vector_store", "research_synthesis", "source_attribution"],
  "answer questions from my": ["vector_store", "research_synthesis", "source_attribution"],
  "answer questions about my": ["vector_store", "research_synthesis", "source_attribution"],
  "questions about my notes": ["vector_store", "research_synthesis"],
  backlink: ["note_linking"],
  backlinks: ["note_linking"],
  "linked notes": ["note_linking"],
  "link my notes": ["note_linking"],
  wikilink: ["note_linking"],
  "knowledge graph": ["note_linking", "vector_store"],
  attribution: ["source_attribution"],
  "source attribution": ["source_attribution"],
  "which note": ["source_attribution"],
  "grounded answer": ["source_attribution", "research_synthesis"],
  "grounded summary": ["source_attribution", "research_synthesis"],
  research: ["source_retrieval", "source_ranking", "research_synthesis"],
  search: ["source_retrieval", "source_ranking"],
  retrieve: ["source_retrieval"],
  retrieval: ["source_retrieval"],
  rank: ["source_ranking"],
  synthesize: ["research_synthesis"],
  synthesise: ["research_synthesis"],
  summarize: ["research_synthesis"],
  summarise: ["research_synthesis"],
  synthesis: ["research_synthesis"],
  cite: ["citation_checker"],
  citation: ["citation_checker"],
  freshness: ["source_freshness_check"],
  stale: ["source_freshness_check"],
  recency: ["source_freshness_check"],
  content: ["content_idea_intake", "copy_generation"],
  copy: ["copy_generation"],
  design: ["design_brief_generation"],
  brief: ["design_brief_generation"],
  publish: ["external_publish"],
  post: ["external_publish"],
  crm: ["crm_note_write"],
  lead: ["crm_note_write"],
  // MAR-242: CRM-domain depth — read / enrich / advance-stage (all HINT_ONLY).
  "crm record": ["crm_record_read"],
  "read the crm": ["crm_record_read"],
  "look up": ["crm_record_read"],
  lookup: ["crm_record_read"],
  "contact record": ["crm_record_read"],
  "deal record": ["crm_record_read"],
  enrich: ["lead_enrichment"],
  enrichment: ["lead_enrichment"],
  firmographic: ["lead_enrichment"],
  "deal stage": ["deal_stage_update"],
  "pipeline stage": ["deal_stage_update"],
  "opportunity stage": ["deal_stage_update"],
  "advance the deal": ["deal_stage_update"],
  "move the deal": ["deal_stage_update"],
  "update the deal": ["deal_stage_update"],
  scrape: ["data_scraper"],
  crawl: ["data_scraper"],
  monitor: ["page_monitor"],
  poll: ["page_monitor"],
  watch: ["page_monitor"],
  // MAR-266: price-watch phrasing reaches the web-page change monitor without a
  // monitor/watch/poll verb ("check … product pages …; detect price changes").
  // Phrase-based on purpose: "pricing pages" (the nightly-ETL scrape variant)
  // and bare "price"/"product" must NOT fire these. The MAR-215 contextual
  // suppression still applies when a specific observer scores.
  "price change": ["page_monitor"],
  "price drop": ["page_monitor"],
  "product page": ["page_monitor"],
  // MAR-243: monitoring-domain depth (all HINT_ONLY). page_monitor stays the
  // web-page change monitor; these are metric / log / availability observers.
  metric: ["metric_threshold_monitor"],
  "error rate": ["metric_threshold_monitor"],
  latency: ["metric_threshold_monitor"],
  "queue depth": ["metric_threshold_monitor"],
  "metric threshold": ["metric_threshold_monitor"],
  logs: ["log_monitor"],
  "log monitor": ["log_monitor"],
  "error logs": ["log_monitor"],
  anomaly: ["log_monitor"],
  sentry: ["log_monitor"],
  "uptime check": ["uptime_check"],
  uptime: ["uptime_check"],
  downtime: ["uptime_check"],
  "health check": ["uptime_check"],
  "is up": ["uptime_check"],
  "goes down": ["uptime_check"],
  pingdom: ["uptime_check"],
  cron: ["scheduled_trigger"],
  scheduled: ["scheduled_trigger"],
  nightly: ["scheduled_trigger"],
  hourly: ["scheduled_trigger"],
  daily: ["scheduled_trigger"],
  weekly: ["scheduled_trigger"],
  // Round-3 scheduled_trigger inversion: MAR-140 removed "schedule" from the
  // calendar hints, which also dropped the path that natural recurring-time
  // phrasing took to the scheduler — "every morning at 8am" no longer reached
  // scheduled_trigger (missed in G1) while it still fired as fuzzy noise in G2
  // (fixed by the HINT_ONLY change above). These multi-word phrases restore the
  // natural-language path WITHOUT reintroducing the bare-"schedule" calendar bleed.
  "every morning": ["scheduled_trigger"],
  "each morning": ["scheduled_trigger"],
  "every evening": ["scheduled_trigger"],
  "every night": ["scheduled_trigger"],
  "every day": ["scheduled_trigger"],
  "each day": ["scheduled_trigger"],
  "every hour": ["scheduled_trigger"],
  "every week": ["scheduled_trigger"],
  "every month": ["scheduled_trigger"],
  midnight: ["scheduled_trigger"],
  // MAR-253: weekday/clock phrasings ("every Monday at 8am") are handled by
  // SCHEDULE_TIME_PATTERNS below — regex, since times can't be enumerated here.
  webhook: ["webhook_trigger"],
  github: ["github_trigger"],
  "pull request": ["github_trigger", "pr_summary"],
  "github event": ["github_trigger"],
  // MAR-303: bare "loop" removed — it fired loop_controller on the idiom "no
  // human in the loop" / "keep me in the loop" (attended/unattended phrasing,
  // NOT iteration). Same class as MAR-214's "for each" removal. True iteration
  // is still hit via iterate*/iteration below plus the specific loop phrases;
  // fan-out/saga goals pull loop_controller via the fan_out_collector edge, not
  // this hint, so those routes are unaffected.
  "loop until": ["loop_controller"],
  "feedback loop": ["loop_controller"],
  "retry loop": ["loop_controller"],
  "iteration loop": ["loop_controller"],
  iterate: ["loop_controller"],
  iterates: ["loop_controller"],
  // "iterating" does not contain "iterate" as a substring (i-t-e-r-a-t-e vs
  // i-t-e-r-a-t-i-n-g differ at position 7), so it needs its own hint entry.
  iterating: ["loop_controller"],
  iteration: ["loop_controller"],
  // MAR-348: implicit revision-loop phrasing. "Revise the draft until the
  // reviewer approves it, max 3 rounds" is a bounded iterative loop, but it
  // carried NONE of the loop tokens above, so an email/reviewer goal composed a
  // LINEAR route with no loop_controller and null loop_guidance — the revise
  // cycle silently flattened. These are the natural-language critique-and-revise
  // phrasings; the "revise … until …"/"N rounds" shapes are handled by
  // REVISION_LOOP_PATTERNS below (regex, since the two verbs are non-adjacent).
  "keep improving": ["loop_controller"],
  "keep revising": ["loop_controller"],
  "keep iterating": ["loop_controller"],
  "iterate on the draft": ["loop_controller"],
  "back and forth": ["loop_controller"],
  "revise and resubmit": ["loop_controller"],
  "until it passes": ["loop_controller"],
  // MAR-214: "for each" removed — it fired loop_controller on fan-out / variant
  // goals ("for each variant", "for each item in the list") where the intent is
  // parallel batch dispatch, not bounded iterative retry. loop_controller is still
  // reachable via the specific hints above ("loop", "iterate", "iterating",
  // "iteration") which describe true while-loop / retry-loop / sequential phrasing,
  // not generic list traversal. Fan-out goals use "parallel" / "fan out" instead.
  parallel: ["fan_out_collector"],
  "fan out": ["fan_out_collector"],
  "fan-out": ["fan_out_collector"],
  reviewer: ["reviewer_notification"],
  "notify reviewer": ["reviewer_notification"],
  "review request": ["reviewer_notification"],
  "review draft": ["review_draft_composer"],
  "draft review": ["review_draft_composer"],
  "editorial review": ["review_draft_composer"],
  "stage for review": ["review_draft_composer"],
  "compose a draft": ["review_draft_composer"],
  variant: ["multi_variant_generator"],
  variants: ["multi_variant_generator"],
  "a/b": ["multi_variant_generator"],
  "test variant": ["multi_variant_generator"],
  "ab test": ["multi_variant_generator"],
  // MAR-134: saga/compensation (HINT_ONLY)
  saga: ["saga_compensation"],
  compensation: ["saga_compensation"],
  compensate: ["saga_compensation"],
  rollback: ["saga_compensation"],
  "roll back": ["saga_compensation"],
  // MAR-145 (ChatGPT dogfood): natural conjugations of "roll back". "rolls back
  // everything if any step fails" missed saga_compensation entirely, collapsing
  // the flagship invoice/batch goal's whole safety chain to a 2-step plan.
  "rolls back": ["saga_compensation"],
  "rolling back": ["saga_compensation"],
  "rolled back": ["saga_compensation"],
  undo: ["saga_compensation"],
  // threshold_router
  threshold: ["threshold_router"],
  "route based on": ["threshold_router"],
  "confidence score": ["threshold_router"],
  "confidence threshold": ["threshold_router"],
  pdf: ["pdf_extraction"],
  airtable: ["airtable_lookup"],
  stripe: ["stripe_data_read"],
  billing: ["stripe_data_read"],
  subscription: ["stripe_data_read"],
  // MAR-145 (ChatGPT dogfood): "invoice" does NOT imply Stripe — most invoice
  // workflows are ERP/AP/accounting, not Stripe. The hint injected stripe_data_read
  // into every invoice goal (the ChatGPT session flagged it as irrelevant).
  // stripe_data_read stays reachable via stripe/billing/subscription.
  // MAR-215: "data" removed from the keyword-hint map for data_scraper.
  // "data" is one of the most generic words in any goal — "pull Stripe payment
  // data", "read the sensor data", "fetch API data" — and none of those want a
  // web scraper. data_scraper remains reachable via the specific hints below
  // (scrape / crawl / extract) which name the actual access pattern.
  // data_normalizer remains reachable via normalize / normalise / its own fuzzy
  // capability pass once the data_etl domain is established.
  extract: ["data_scraper", "data_normalizer", "pdf_extraction"],
  // MAR-244: invoices/receipts are the canonical "extract structured fields from a
  // document" case and are almost always PDFs. pdf_extraction is HINT_ONLY-reachable
  // via "pdf"/"extract"; these add the document-noun path so "read invoices from my
  // email" routes the extractor even when the word "pdf" is absent.
  invoice: ["pdf_extraction"],
  invoices: ["pdf_extraction"],
  receipt: ["pdf_extraction"],
  receipts: ["pdf_extraction"],
  // MAR-244: file_storage (HINT_ONLY). The "save it somewhere" destination — a
  // spreadsheet, sheet, CSV, table or object store. Reachable only via these
  // explicit storage nouns/phrases so it never fuzzy-bleeds into unrelated goals.
  spreadsheet: ["file_storage"],
  "google sheet": ["file_storage"],
  "google sheets": ["file_storage"],
  "to a sheet": ["file_storage"],
  "into a sheet": ["file_storage"],
  "in a sheet": ["file_storage"],
  csv: ["file_storage"],
  "save to a file": ["file_storage"],
  "save it to": ["file_storage"],
  "save them": ["file_storage"],
  "save each": ["file_storage"],
  "store them": ["file_storage"],
  "store each": ["file_storage"],
  "store the records": ["file_storage"],
  "save the records": ["file_storage"],
  "write to a file": ["file_storage"],
  "append to": ["file_storage"],
  "database table": ["file_storage"],
  "log it to": ["file_storage"],
  // MAR-254: db_read (HINT_ONLY) — read-only SQL/warehouse source. Provider
  // names are domain-unique; the generic forms are direction-carrying PHRASES
  // ("from our database", "query the database") so a "save to a database" WRITE
  // goal never pulls the READ component via a bare "database" token.
  postgres: ["db_read"],
  postgresql: ["db_read"],
  mysql: ["db_read"],
  bigquery: ["db_read"],
  snowflake: ["db_read"],
  "sql database": ["db_read"],
  "sql query": ["db_read"],
  "from our database": ["db_read"],
  "from the database": ["db_read"],
  "from a database": ["db_read"],
  "query the database": ["db_read"],
  "database query": ["db_read"],
  "data warehouse": ["db_read"],
  // MAR-254: report_generation (HINT_ONLY) — document-CREATION phrases only.
  // Deliberately compound: bare "report"/"summary" are the MAR-127 bleed tokens
  // and must never select it.
  "pdf report": ["report_generation"],
  "summary report": ["report_generation"],
  "pdf summary": ["report_generation"],
  "generate a report": ["report_generation"],
  "create a report": ["report_generation"],
  "produce a report": ["report_generation"],
  "generate a pdf": ["report_generation"],
  "create a pdf": ["report_generation"],
  "weekly report": ["report_generation"],
  "daily report": ["report_generation"],
  "monthly report": ["report_generation"],
  "report generation": ["report_generation"],
  normalize: ["data_normalizer"],
  normalise: ["data_normalizer"],
  deduplicate: ["deduplication"],
  duplicate: ["deduplication"],
  validate: ["schema_validation"],
  schema: ["schema_validation"],
  code: ["codebase_scan", "code_editing"],
  coding: ["codebase_scan", "plan_generation", "code_editing"],
  codebase: ["codebase_scan"],
  refactor: ["codebase_scan", "plan_generation", "code_editing"],
  implement: ["plan_generation", "code_editing"],
  test: ["test_runner"],
  testing: ["test_runner"],
  approval: ["human_approval_gate"],
  approve: ["human_approval_gate"],
  "human review": ["human_approval_gate"],
  audit: ["audit_log"],
  log: ["audit_log"],
  intent: ["intent_classifier"],
  classify: ["intent_classifier"],
  goal: ["user_goal_intake"],
  plan: ["plan_generation"],
  planning: ["plan_generation"],
  queue: ["job_queue"],
  retry: ["retry_policy"],
  state: ["state_store"],
  persist: ["state_store"],
};

/**
 * MAR-253: weekday / clock-time schedule signals. "Every morning" reached
 * scheduled_trigger via its phrase hint, but "Every Monday at 8am" did not —
 * the live audit G4 goal composed with NO trigger and then asked "How should
 * this workflow start each time?" while the answer sat in the first five words.
 *
 * Deliberately CONTEXTUAL patterns, not bare tokens: a weekday or clock time
 * only counts as a schedule when carried by every/each/on/at phrasing, so
 * "Monday's report" or a company name never fires. Real vocabulary-gap fix,
 * not matcher-gaming — the phrasing comes from a rated dogfood goal
 * (2026-06-18, rated 2/5).
 */
const WEEKDAY = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const SCHEDULE_TIME_PATTERNS: RegExp[] = [
  new RegExp(`\\b(every|each)\\s+${WEEKDAY}`), // "every Monday", "each Friday"
  new RegExp(`\\bon\\s+${WEEKDAY}s\\b`), // "on Mondays"
  new RegExp(`\\b${WEEKDAY}s?\\s+(morning|mornings|evening|evenings|night|nights|at)\\b`), // "Monday morning", "Friday at 6"
  /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/, // "at 8am", "at 8:30 pm"
  /\bat\s+\d{1,2}:\d{2}\b/, // "at 18:00"
  /\b(weekly|biweekly|monthly)\s+on\b/, // "weekly on Tuesdays"
];

/** True when the goal states a recurring weekday/clock schedule (MAR-253). */
export function hasScheduleTimeSignal(goalLower: string): boolean {
  return SCHEDULE_TIME_PATTERNS.some((p) => p.test(goalLower));
}

/**
 * MAR-348: implicit revision-loop signals. A "draft → critique → revise until
 * approved, max N rounds" flow is a bounded iterative loop, but its two verbs
 * ("revise"/"improve" and "approves") are usually NON-ADJACENT ("revise the
 * draft until the reviewer approves it"), so a single KEYWORD_HINT phrase can't
 * catch it. These CONTEXTUAL patterns select loop_controller at hint strength.
 *
 * Deliberately precise, not bare tokens: each requires an explicit
 * revise/refine/rework verb OR an explicit bounded count of rounds/iterations,
 * so a plain approval GATE ("hold each invoice until approved") — which is NOT
 * iteration — never trips loop_controller. The phrasing comes from the live
 * state-of-project probe goal (2026-07-11): "…revise the draft until the
 * reviewer approves it, maximum 3 rounds…".
 */
const REVISION_LOOP_PATTERNS: RegExp[] = [
  // an explicit revise/refine/rework/redraft verb, then "until" in the clause
  /\b(revise|revises|revised|revising|refine|refines|refined|refining|rework|reworks|reworked|reworking|redraft|redrafts|redrafted|redrafting|redo|improve|improves|improved|improving)\b[^.?!]*\buntil\b/,
  // a revise/improve verb paired with "approve(s)/approval" in the clause
  /\b(revise|revises|revised|revising|refine|refines|refined|refining|rework|reworks|reworked|reworking|redraft|redrafts|redrafted|redrafting|redo|improve|improves|improved|improving)\b[^.?!]*\bapprov(e|es|ed|al)\b/,
  // an explicit bounded count of rounds/iterations/revisions/passes
  /\b(max(imum)?\s+|up to\s+|at most\s+)?\d+\s*(rounds?|iterations?|revisions?|passes|attempts|cycles?)\b/,
];

/** True when the goal describes a bounded critique-and-revise loop (MAR-348). */
export function hasRevisionLoopSignal(goalLower: string): boolean {
  return REVISION_LOOP_PATTERNS.some((p) => p.test(goalLower));
}

/**
 * MAR-348: extract an explicit iteration bound from a revision/loop goal, e.g.
 * "maximum 3 rounds" → 3, "up to 5 iterations" → 5, "max 4 revisions" → 4.
 * Returns the first plausible bound (1–50) or null when none is stated. Used to
 * honour the user's stated cap in the loop_guidance contract rather than always
 * echoing the playbook default.
 */
export function extractIterationBound(goalLower: string): number | null {
  const m = goalLower.match(
    /\b(?:max(?:imum)?\s+|up to\s+|at most\s+)?(\d{1,3})\s*(?:rounds?|iterations?|revisions?|passes|attempts|cycles?|times)\b/,
  );
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : null;
}

/** Score penalty applied to the `to` component of a co-occurring avoid_when edge. */
const AVOID_PENALTY: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5,
};

/** Tokenize a string into lowercase words (length >= 3). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Tokens too generic to be meaningful as capability/summary matching signals.
 *
 * Applied only to the cap/summary substring passes — keyword hints and
 * id/name segment matching are unaffected.
 *
 * Key examples of why each group is here:
 *   - English function words ("and", "the", "for", …): appear inside compound
 *     capability IDs like `extract_audience_and_goals` — pure structural noise.
 *   - Generic architectural nouns ("workflow", "process", "system", "data"):
 *     nearly every component mentions these in its summary, so they provide
 *     zero discriminating signal.
 *   - Prepositions and conjunctions: only surface because capability names
 *     use snake_case which contains them as fragments.
 */
const MATCH_STOPWORDS = new Set([
  // English function words
  "and", "the", "for", "are", "but", "not", "all", "was", "one", "our",
  "has", "its", "did", "let", "put", "too", "use", "way", "new", "get",
  "may", "see", "per", "set", "via", "can", "own", "any", "how", "who",
  "that", "this", "from", "with", "when", "then", "into", "onto", "over",
  "under", "also", "each", "both", "been", "will", "have", "more", "than",
  "what", "when", "they", "them", "some", "such", "only", "very", "well",
  "your", "just", "even", "most", "like", "make", "take",
  // Generic architectural nouns that appear in nearly every component summary
  "workflow", "process", "system", "service", "agent", "step", "task",
  "item", "data", "input", "output", "result", "value", "type", "list",
  "adds", "based", "given", "used",
]);

/**
 * Components excluded from fuzzy token matching — the id-segment, capability and
 * summary passes (MAR-132). human_approval_gate is a safety gate whose id and
 * summary are built from generic English ("human", "approval", "gate", "review"),
 * so fuzzy matching inserted a blocking gate into goals that explicitly said the
 * opposite — "no human in the loop" / "unattended" scored it via the bare token
 * "human". It is still selected intentionally via KEYWORD_HINTS (approval /
 * approve / human review) and added deterministically by the safety augmenter for
 * real external writes, so excluding it from fuzzy matching loses no real signal.
 */
const HINT_ONLY_COMPONENTS = new Set([
  "human_approval_gate",
  // calendar_lookup/calendar_write are only valid in genuine calendar goals.
  // Fuzzy matching on "calendar" / "meeting" tokens in non-calendar goals
  // (e.g. "team meeting summary", "schedule social posts") injected these
  // write-side components inappropriately (MAR-140). They remain reachable via
  // KEYWORD_HINTS on "calendar" and "meeting".
  "calendar_lookup",
  "calendar_write",
  // P0-04: gmail_draft_write shares the single most ambient token in the email
  // domain — "draft" — with email_draft, plus "write"/"save"/"gmail" from its
  // id and summary. Left fuzzy-matchable it would attach a mailbox WRITE to
  // every goal that merely composes text ("draft a reply", "draft a post"),
  // which is precisely the hallucinated-external-write class the MAR-140
  // calendar_write entry above exists to prevent. Only the explicit
  // "save it in gmail drafts" family of hints below should reach it.
  "gmail_draft_write",
  // review_draft_composer and multi_variant_generator are composing/variant tools
  // that only belong in goals that explicitly mention staging/reviewing drafts or
  // A/B variants. Their id/summary tokens ("draft", "composer", "variant",
  // "generator") score positively on many generic content goals and dilute
  // playbook precision for content_approval_pipeline below the 0.72 floor.
  // They are reachable via KEYWORD_HINTS ("review draft", "editorial review",
  // "variant", "a/b", etc.).
  "review_draft_composer",
  "multi_variant_generator",
  // saga_compensation is a complex rollback orchestrator. Fuzzy matching on
  // "compensation" (salary), "undo" (text editing), or "rollback" (git) would
  // inject it into unrelated goals. Reachable via KEYWORD_HINTS (saga,
  // compensation, rollback, compensate).
  "saga_compensation",
  // MAR-145: the three trigger entrypoints share the id-segment "trigger" and
  // cross-reference each other in their summaries/capabilities (webhook_trigger's
  // summary lists "Stripe, GitHub, Slack, Airtable"; github_trigger's
  // capabilities include "webhook_receive"). The fuzzy id/summary/capability
  // passes therefore pulled ALL THREE whenever any one was mentioned — the bare
  // token "webhook" yielded webhook+github+scheduled (Dogfood Round 3 G2), and
  // the bare token "trigger" pulled all three. They are precise concepts with
  // dedicated KEYWORD_HINTS, so restrict them to hint-only selection:
  //   scheduled_trigger ← cron/scheduled/nightly/hourly/daily/weekly + time phrases
  //   webhook_trigger   ← webhook
  //   github_trigger    ← github / "github event" / "pull request"
  "scheduled_trigger",
  "webhook_trigger",
  "github_trigger",
  // MAR-145 (ChatGPT dogfood): stripe_data_read is a SPECIFIC Stripe integration,
  // but its summary mentions "invoices / payments / billing", so the fuzzy
  // summary pass pulled it into any invoice/accounting goal even after the
  // `invoice` hint was removed. Restrict to explicit Stripe hints
  // (stripe / billing / subscription) so a generic invoice workflow never gets it.
  "stripe_data_read",
  // MAR-215: page_monitor's capabilities include "hash_based_change_detection"
  // and its id contains "monitor" — tokens that score positively on code-review
  // / code-scanning goals ("scan the changed files", "monitor test results").
  // page_monitor is a web-URL polling component and has no business in software-
  // engineering contexts. Restrict to explicit monitoring hints (monitor / poll /
  // watch) so it only fires when the user is actually asking to watch a web page.
  "page_monitor",
  // MAR-215: data_scraper's id contains the segment "data", which appears in
  // virtually every data-pipeline / API-read goal ("pull Stripe payment data",
  // "fetch sensor data"). The id-segment pass (+2) fires even after removing
  // the `data` keyword hint, because tokenSet includes stopwords. data_scraper is
  // a WEB-SCRAPING tool — it has no business in structured-API-read or code-scan
  // contexts. Restrict to explicit scraping hints (scrape / crawl / extract) so
  // it only fires when the user explicitly names a scraping access pattern.
  "data_scraper",
  // MAR-120: chat_trigger is the inbound conversational entrypoint. Its id/summary
  // tokens ("chat", "message", "trigger") are generic and would inject it into
  // unrelated messaging/notification goals. It is a precise concept with dedicated
  // KEYWORD_HINTS (chatbot / "slack bot" / "slash command" / "responds to messages"
  // / "when mentioned" …), so restrict it to hint-only selection.
  "chat_trigger",
  // MAR-120: the platform notification egresses share the "notification" id segment
  // and their summaries contain generic words (channel / message / post / notify), so
  // the fuzzy id/summary/capability passes cross-match them on ANY notification goal
  // (the MAR-145 trigger lesson). slack_notification is included too: its capabilities
  // ("notify_channel") and summary ("posts… to a Slack channel") scored it onto
  // unrelated notification goals via generic tokens like "channel"/"posts" — e.g. a
  // Discord-bot goal mentioning "channel" pulled Slack. Every egress is now hint-only
  // and reachable solely via its explicit platform hint (slack / discord / teams /
  // telegram). All slack probes name "Slack" literally, so the hint still fires.
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
  // MAR-217: knowledge / second-brain components. Their id/summary tokens are
  // generic ("store", "index", "ingestion", "attribution", "linking") and would
  // fuzzy-match unrelated state/eval/processing goals. Each is reachable only via
  // its explicit knowledge KEYWORD_HINTS (second brain / my notes / vector store /
  // embeddings / attribution / backlink …) within the phrase-established
  // `knowledge` domain, so establishing the domain alone never injects them.
  "knowledge_ingestion",
  "vector_store",
  "source_attribution",
  "note_linking",
  // MAR-242: CRM-domain depth. Their id/summary/capability tokens are generic
  // ("read", "lookup", "record", "enrich", "score", "deal", "stage", "update")
  // and would fuzzy-match unrelated data-read / scoring / state goals. Each is
  // reachable only via its explicit CRM KEYWORD_HINTS (crm record / look up /
  // enrich / deal stage / advance the deal …) within the `crm_sales` domain, so
  // establishing the domain alone never injects them. crm_note_write stays
  // fuzzy-matchable (its tokens are CRM-specific) as the default CRM write.
  "crm_record_read",
  "lead_enrichment",
  "deal_stage_update",
  // MAR-243: monitoring-domain depth. Their id/summary tokens are generic
  // ("monitor", "check", "log", "metric", "event") and would fuzzy-match
  // unrelated scheduling / data / code goals (the page_monitor / data_scraper
  // lesson, MAR-215). Each is reachable only via its explicit monitoring
  // KEYWORD_HINTS (metric / error rate / latency / logs / anomaly / uptime /
  // downtime / health check …) within the `monitoring` domain. page_monitor
  // stays the web-page change monitor.
  "metric_threshold_monitor",
  "log_monitor",
  "uptime_check",
  // MAR-244: file_storage's id/summary/capability tokens ("file", "storage",
  // "save", "write", "records", "store") are among the most generic in any goal
  // and would fuzzy-match nearly every data/processing/state goal. It is a precise
  // destination, reachable only via its explicit storage hints (spreadsheet / csv /
  // google sheet / save to a file / store the records …) within the data_etl or
  // generic domain, so establishing the domain alone never injects it.
  "file_storage",
  // MAR-267: test_runner's capability/summary tokens include bare "diff" /
  // "code", so the fuzzy passes pulled it into READ-ONLY review goals ("review
  // the diff for problems") that never ask to run anything — polluting the
  // pr_review_readonly composed set below the playbook precision floor.
  // Reachable via its "test"/"testing" hints (substring — fires on "tests",
  // "test suite", "unit tests"); every probe/corpus goal that needs it names
  // tests literally.
  "test_runner",
  // MAR-266: airtable_lookup is a specific provider integration (the
  // stripe_data_read lesson, MAR-145). Its capability/summary tokens include
  // bare "read"/"records"/"lookup", so the fuzzy passes pulled it into any
  // goal that merely SAYS "read" — observed on "read-only on all external
  // sites", a pure CONSTRAINT phrase, where it polluted the price-monitor
  // composed set below the playbook precision floor. Reachable only via its
  // explicit "airtable" hint; both airtable probes name Airtable literally.
  "airtable_lookup",
  // MAR-254: the data-report spine. db_read's tokens ("database", "read",
  // "query", "data", "rows") and report_generation's ("report", "summary",
  // "document", "generate", "render") are ambient in most goals — fuzzy matching
  // would inject a SQL read into any "read X" goal and a report renderer into
  // any "summary" goal (the MAR-127 token class). Reachable only via their
  // explicit provider names and direction-carrying phrases above.
  "db_read",
  "report_generation",
]);

/**
 * MAR-215 / MAR-243 residual: the specific monitoring observers. When one of
 * these is selected, page_monitor's generic watch/monitor/poll verbs are noise
 * unless the goal actually names a web page (see the suppression in
 * matchCapabilities).
 */
const SPECIFIC_MONITOR_COMPONENTS = [
  "metric_threshold_monitor",
  "log_monitor",
  "uptime_check",
];

/** Web-page signals that legitimately justify page_monitor. */
const PAGE_MONITOR_SIGNALS = ["page", "webpage", "website", "url"];

/**
 * MAR-254: extraction-direction signals that legitimately justify
 * pdf_extraction. "Generate a PDF summary report" fires pdf_extraction via the
 * bare `pdf` hint even though the goal CREATES a document (the opposite arrow —
 * observed live in the 2026-07-01 audit G4). When report_generation matched
 * (a creation phrase is present) and none of these extraction signals appear,
 * pdf_extraction is direction-wrong noise and is dropped.
 */
const PDF_EXTRACTION_SIGNALS = [
  "extract",
  "parse",
  "parsing",
  "incoming",
  "attachment",
  "attachments",
  "invoice",
  "receipt",
  "from the pdf",
  "from a pdf",
  "from pdfs",
  "read pdf",
  "read the pdf",
  "scanned",
  "ocr",
];

const EXPLICIT_FAN_OUT_SIGNALS = [
  "parallel",
  "fan out",
  "fan-out",
  "branch",
  "branches",
  "merge",
];

const MEETING_TIME_CHOICE_SIGNALS = [
  "suggest two times",
  "two times",
  "two candidate",
  "two slots",
  "two meeting",
];

/** Domains a component belongs to (defaults to generic_orchestration). */
function componentDomains(id: string): Domain[] {
  return COMPONENT_DOMAINS[id] ?? ["generic_orchestration"];
}

/**
 * Match goal text to components using a two-phase, domain-gated strategy
 * (MAR-88):
 *
 * Phase 1 — Domain classification: rules-first keyword classifier maps the
 * goal to workflow domains.
 *
 * Phase 2 — Scoped matching: only components whose domain intersects the goal's
 * domains are eligible. Within that allowlist:
 *   1. Keyword hint dictionary (+2)
 *   2. Whole-segment id/name match (+2) — replaces the old unconstrained
 *      substring pass that injected cross-domain components.
 *   3. Capability substring match (+1)
 *   4. Summary substring match (+0.5)
 * Finally, cross-domain `avoid_when` edges penalise the avoided component when
 * both endpoints co-occur (e.g. data_scraper / research_synthesis → never
 * auto-wire external_publish).
 *
 * Returns matches sorted by score descending, the unmet must_have
 * capabilities, the detected domains, and any avoid-penalised components.
 */
export function matchCapabilities(
  goal: string,
  mustHaveCapabilities: string[],
  mustAvoid: string[],
  components: Component[],
  edges: Edge[] = [],
): MatchResult {
  // MAR-347: strip approval-gated prohibition clauses ("must not send email or
  // post to Slack until approved") before ANY string matching. The clause is a
  // gate constraint on actions the goal already names affirmatively — left in
  // place it both fires hints/domains as fresh demand ("post" → external_publish)
  // and trips the absolute no-send suppression rules on a send the user wants.
  const goalNeutralized = neutralizeApprovalGatedProhibitions(goal);
  const goalLower = goalNeutralized.toLowerCase();
  const goalTokens = tokenize(goalNeutralized);
  const tokenSet = new Set(goalTokens);
  const mustAvoidSet = new Set(mustAvoid.map((s) => s.toLowerCase()));

  // ── Phase 1: classify domains ──
  const goalDomains = classifyGoalDomains(goal);

  // Component is eligible iff one of its domains is in the goal's domains.
  const domainAllowed = new Set<string>();
  for (const component of components) {
    if (componentDomains(component.id).some((d) => goalDomains.has(d))) {
      domainAllowed.add(component.id);
    }
  }

  // MAR-161: honour explicit user constraints that forbid a capability — a code
  // goal that says "never edit code"/"read-only" drops code_editing, "do not
  // publish externally" drops external_publish, "no mailbox polling" drops
  // email_read, "drafts only"/"do not send" drops optional_email_send. Drops
  // happen here, before scoring, so neither keyword hints nor the fuzzy passes
  // can re-select them; nothing downstream re-adds them (see the engine doc).
  suppressConstrainedCapabilities(goalLower, domainAllowed, goalDomains);
  // MAR-302: email-as-document-source (invoice/PO ingest, no correspondence
  // intent) drops the email drafting/sending path — email is a SOURCE here.
  suppressEmailDraftForDocumentSource(goalLower, domainAllowed, goalDomains);
  suppressEmailDraftForInboxSummary(goalLower, domainAllowed);
  // MAR-303: a database-source report goal with no CRM-write intent drops the
  // crm_note_write false-positive ("sales" data subject → crm_sales domain).
  suppressCrmNoteForDataReport(goalLower, domainAllowed);
  // MAR-303: the "in the loop" idiom (with no real iteration/fan-out signal)
  // drops the loop_controller false-positive on unattended report/monitor goals.
  suppressLoopControllerForIdiom(goalLower, domainAllowed);
  // Adversarial-batch: "post to Slack if it's down" is a notification, not a
  // publish — drop the external_publish false-positive (and the approval gate it
  // dragged onto an unattended notify-only flow) unless real publish intent shows.
  suppressExternalPublishForChatPost(goalLower, domainAllowed);
  // P0-03: "watch it run" / "visible run logs" describe wanting insight into
  // the agent's own execution, not an external log source — drop the
  // log_monitor false-positive (and its Datadog/CloudWatch/Sentry/Loki Connect
  // entry) unless the goal also names a real log source to scan.
  suppressLogMonitorForRunObservability(goalLower, domainAllowed);

  // ── Phase 2: scoped scoring ──
  const scoreMap = new Map<
    string,
    { score: number; tokens: Set<string>; kinds: Set<MatchEvidenceKind> }
  >();

  const bump = (id: string, delta: number, token: string, kind: MatchEvidenceKind) => {
    const entry =
      scoreMap.get(id) ??
      { score: 0, tokens: new Set<string>(), kinds: new Set<MatchEvidenceKind>() };
    entry.score += delta;
    entry.tokens.add(token);
    entry.kinds.add(kind);
    scoreMap.set(id, entry);
  };

  // Pass 1: keyword hint dictionary (gated)
  for (const [keyword, ids] of Object.entries(KEYWORD_HINTS)) {
    if (goalLower.includes(keyword) && !isNegatedInContext(goalLower, keyword)) {
      for (const id of ids) {
        if (domainAllowed.has(id)) bump(id, 2, keyword, "hint");
      }
    }
  }

  // Pass 1b (MAR-253): weekday/clock schedule signal — regex, hint-strength.
  // "Every Monday at 8am" selects scheduled_trigger exactly like "every morning".
  if (domainAllowed.has("scheduled_trigger") && hasScheduleTimeSignal(goalLower)) {
    bump("scheduled_trigger", 2, "schedule-time phrase", "hint");
  }

  // Pass 1c (MAR-348): implicit revision-loop signal — regex, hint-strength.
  // "Revise the draft until the reviewer approves it, max 3 rounds" selects
  // loop_controller even though it carries none of the literal loop tokens.
  if (domainAllowed.has("loop_controller") && hasRevisionLoopSignal(goalLower)) {
    bump("loop_controller", 2, "revision-loop phrase", "hint");
  }

  // Passes 2–4: per-component token matching (gated)
  for (const component of components) {
    if (!domainAllowed.has(component.id)) continue;
    // MAR-132: safety gates are added via hints / the augmenter, never fuzzy-matched.
    if (HINT_ONLY_COMPONENTS.has(component.id)) continue;

    // Whole-segment id/name match — strong, but only on exact token equality
    // (not substring), so "summary" no longer pulls in pr_summary on a research
    // goal, "publish" no longer pulls external_publish onto ETL, etc.
    const idSegments = component.id.toLowerCase().split(/[^a-z0-9]+/);
    const nameWords = component.name.toLowerCase().split(/[^a-z0-9]+/);
    const identifierTokens = new Set([...idSegments, ...nameWords]);
    for (const seg of identifierTokens) {
      if (seg.length > 2 && tokenSet.has(seg)) {
        bump(component.id, 2, seg, "segment");
      }
    }

    for (const token of goalTokens) {
      if (MATCH_STOPWORDS.has(token)) continue;
      // Capability substring match
      for (const cap of component.capabilities) {
        if (cap.toLowerCase().includes(token)) {
          bump(component.id, 1, token, "capability");
          break;
        }
      }
      // Summary match — weak signal
      if (component.summary.toLowerCase().includes(token)) {
        bump(component.id, 0.5, token, "summary");
      }
    }
  }

  // ── Cross-domain avoid_when penalty ──
  // When an avoid_when edge's `from` and `to` both scored, penalise `to`. Both
  // registry avoid_when edges target external_publish (from data_scraper and
  // research_synthesis): this is a second, edge-grounded layer that suppresses
  // auto-wiring a publish step behind a scraper/synthesiser. Domain gating
  // already removes external_publish when content_publishing is absent; this
  // penalty handles the case where it slipped through.
  const avoidPenalized: string[] = [];
  for (const edge of edges) {
    if (edge.relation !== "avoid_when") continue;
    const fromEntry = scoreMap.get(edge.from);
    const toEntry = scoreMap.get(edge.to);
    if (!fromEntry || !toEntry) continue;
    if (fromEntry.score <= 0 || toEntry.score <= 0) continue;
    toEntry.score -= AVOID_PENALTY[edge.severity] ?? 1;
    avoidPenalized.push(edge.id);
  }

  // ── page_monitor contextual suppression (MAR-215 / MAR-243 residual) ──
  // page_monitor is the web-PAGE change monitor, reachable via the generic verbs
  // watch / monitor / poll. On a metric / log / uptime goal ("watch our API
  // uptime", "monitor the error rate") those verbs pull page_monitor in as noise
  // ALONGSIDE the specific observer the goal actually named. Drop it when a
  // specific monitoring observer scored AND the goal carries no web-page signal —
  // page_monitor stays whenever the goal really names a page/site/URL, and stays
  // as the sole fallback monitor when no specific observer matched.
  if (scoreMap.has("page_monitor")) {
    const hasPageSignal = PAGE_MONITOR_SIGNALS.some((t) => goalLower.includes(t));
    const hasSpecificMonitor = SPECIFIC_MONITOR_COMPONENTS.some((id) =>
      scoreMap.has(id),
    );
    if (!hasPageSignal && hasSpecificMonitor) scoreMap.delete("page_monitor");
  }

  // ── pdf_extraction direction suppression (MAR-254) ──
  // pdf_extraction PARSES an existing PDF; report_generation CREATES one. The
  // bare `pdf` hint fires the extractor on document-creation goals ("generate a
  // PDF summary report"). When the creation direction matched and the goal
  // carries no extraction signal, the extractor is direction-wrong noise.
  // Mirrors the page_monitor suppression above.
  if (scoreMap.has("pdf_extraction") && scoreMap.has("report_generation")) {
    const hasExtractionSignal = PDF_EXTRACTION_SIGNALS.some((t) =>
      goalLower.includes(t),
    );
    if (!hasExtractionSignal) scoreMap.delete("pdf_extraction");
  }

  if (scoreMap.has("fan_out_collector")) {
    const hasExplicitFanOutSignal = EXPLICIT_FAN_OUT_SIGNALS.some((t) =>
      goalLower.includes(t),
    );
    const isMeetingTimeChoice = goalDomains.has("email_calendar") &&
      MEETING_TIME_CHOICE_SIGNALS.some((t) => goalLower.includes(t));
    if (isMeetingTimeChoice && !hasExplicitFanOutSignal) scoreMap.delete("fan_out_collector");
  }

  // ── Build matches from positively-scored components ──
  //
  // Minimum score of 1 is required: a component that only matched via a weak
  // summary-substring hit (score = 0.5) is almost certainly noise — it got
  // domain-eligible as a side effect of a common word in the goal (e.g.
  // "published" triggers content_publishing, making content_idea_intake eligible,
  // which then scores 0.5 on "workflow" in its summary).
  const MIN_MATCH_SCORE = 1;
  const matches: CapabilityMatch[] = [];
  for (const component of components) {
    if (mustAvoidSet.has(component.id.toLowerCase())) continue;

    const entry = scoreMap.get(component.id);
    if (entry && entry.score >= MIN_MATCH_SCORE) {
      matches.push({
        component,
        score: entry.score,
        matched_tokens: Array.from(entry.tokens),
        evidence: Array.from(entry.kinds).sort(),
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  // ── Unmet must_have capabilities ──
  const missing_capabilities: string[] = [];
  for (const cap of mustHaveCapabilities) {
    const capLower = cap.toLowerCase();
    const covered = matches.some((m) =>
      m.component.capabilities.some((c) => c.toLowerCase().includes(capLower)),
    );
    if (!covered) {
      missing_capabilities.push(cap);
    }
  }

  return {
    matches,
    missing_capabilities,
    domains: Array.from(goalDomains),
    avoid_penalized: avoidPenalized,
  };
}
