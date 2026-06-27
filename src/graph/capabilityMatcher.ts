import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";

export type CapabilityMatch = {
  component: Component;
  score: number;
  matched_tokens: string[];
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
  // research
  source_retrieval: ["research"],
  source_ranking: ["research"],
  source_freshness_check: ["research"],
  citation_checker: ["research"],
  research_synthesis: ["research"],
  // content_publishing
  content_idea_intake: ["content_publishing"],
  copy_generation: ["content_publishing"],
  design_brief_generation: ["content_publishing"],
  external_publish: ["content_publishing"],
  // email_calendar
  email_read: ["email_calendar"],
  email_draft: ["email_calendar"],
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
  // code_agent
  codebase_scan: ["code_agent"],
  code_editing: ["code_agent"],
  plan_generation: ["code_agent"],
  test_runner: ["code_agent"],
  pr_summary: ["code_agent"],
  // crm_sales
  crm_note_write: ["crm_sales"],
  // monitoring
  page_monitor: ["monitoring"],
  // notification
  slack_notification: ["notification"],
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
  ],
  monitoring: [
    "monitor",
    "poll",
    "watch",
    "track changes",
    "change detection",
    "for changes",
    "uptime",
  ],
  notification: [
    "slack",
    "notify",
    "notification",
    "teams",
    "discord",
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
 * Strong, unambiguous email/calendar tokens (MAR-161). Used to tell a real
 * mailbox/calendar goal from one where an email word appears only incidentally.
 * Deliberately EXCLUDES "draft" (a content draft just as often as an email
 * draft), "schedule"/"scheduling" (infra timing) and "book" (overloaded) — those
 * never prove email intent on their own. Negation-aware via the caller.
 */
const STRONG_EMAIL_CALENDAR_TOKENS = [
  "email",
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
const NEGATION_WORDS = new Set(["no", "not", "never", "without"]);

/**
 * Returns true when `keyword` appears in `text` and the preceding 1-3 words
 * contain a negation word — e.g. "no emails sent", "never send notifications".
 * Only called when the keyword has already been found in text.
 */
function isNegatedInContext(text: string, keyword: string): boolean {
  const idx = text.indexOf(keyword);
  if (idx === -1) return false;
  // Grab up to 25 chars before the keyword and split into words.
  const before = text.slice(Math.max(0, idx - 25), idx).trim();
  const words = before.split(/\s+/).slice(-3);
  return words.some((w) => NEGATION_WORDS.has(w));
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
 * Classify a goal into workflow domains (MAR-88).
 * Always includes `generic_orchestration` so safety/orchestration components
 * are never blocked. Exported for unit testing.
 */
export function classifyGoalDomains(goal: string): Set<Domain> {
  const goalLower = goal.toLowerCase();
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
  inbox: ["email_read"],
  reply: ["email_draft"],
  draft: ["email_draft"],
  calendar: ["calendar_lookup", "calendar_write"],
  meeting: ["calendar_lookup", "calendar_write"],
  slack: ["slack_notification"],
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
  scrape: ["data_scraper"],
  crawl: ["data_scraper"],
  monitor: ["page_monitor"],
  poll: ["page_monitor"],
  watch: ["page_monitor"],
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
  webhook: ["webhook_trigger"],
  github: ["github_trigger"],
  "pull request": ["github_trigger", "pr_summary"],
  "github event": ["github_trigger"],
  loop: ["loop_controller"],
  iterate: ["loop_controller"],
  iterates: ["loop_controller"],
  // "iterating" does not contain "iterate" as a substring (i-t-e-r-a-t-e vs
  // i-t-e-r-a-t-i-n-g differ at position 7), so it needs its own hint entry.
  iterating: ["loop_controller"],
  iteration: ["loop_controller"],
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
]);

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
  const goalLower = goal.toLowerCase();
  const goalTokens = tokenize(goal);
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

  // ── Phase 2: scoped scoring ──
  const scoreMap = new Map<string, { score: number; tokens: Set<string> }>();

  const bump = (id: string, delta: number, token: string) => {
    const entry = scoreMap.get(id) ?? { score: 0, tokens: new Set<string>() };
    entry.score += delta;
    entry.tokens.add(token);
    scoreMap.set(id, entry);
  };

  // Pass 1: keyword hint dictionary (gated)
  for (const [keyword, ids] of Object.entries(KEYWORD_HINTS)) {
    if (goalLower.includes(keyword)) {
      for (const id of ids) {
        if (domainAllowed.has(id)) bump(id, 2, keyword);
      }
    }
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
        bump(component.id, 2, seg);
      }
    }

    for (const token of goalTokens) {
      if (MATCH_STOPWORDS.has(token)) continue;
      // Capability substring match
      for (const cap of component.capabilities) {
        if (cap.toLowerCase().includes(token)) {
          bump(component.id, 1, token);
          break;
        }
      }
      // Summary match — weak signal
      if (component.summary.toLowerCase().includes(token)) {
        bump(component.id, 0.5, token);
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
