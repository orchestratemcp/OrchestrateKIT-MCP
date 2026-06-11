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
  // generic_orchestration — always eligible
  user_goal_intake: ["generic_orchestration"],
  intent_classifier: ["generic_orchestration"],
  state_store: ["generic_orchestration"],
  audit_log: ["generic_orchestration"],
  retry_policy: ["generic_orchestration"],
  job_queue: ["generic_orchestration"],
  human_approval_gate: ["generic_orchestration"],
  schema_validation: ["generic_orchestration"],
};

/**
 * Rules-first domain classifier keywords. Matched as case-insensitive
 * substrings against the goal. Phrases are used where a bare token would
 * over-trigger (e.g. "design tool" instead of "design", "external source" is
 * NOT a research trigger because research uses the plural "sources").
 *
 * IMPORTANT: research is intentionally NOT triggered by the bare word
 * "summary" (so "PR summary" stays a code concern) — only by explicit research
 * verbs/nouns (research, sources, citation, synthesize/summarize, freshness…).
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
};

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
    if (keywords.some((kw) => goalLower.includes(kw))) {
      domains.add(domain);
    }
  }

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
  schedule: ["calendar_lookup", "calendar_write"],
  meeting: ["calendar_lookup", "calendar_write"],
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
  extract: ["data_scraper", "data_normalizer"],
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
  "pull request": ["pr_summary"],
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
  data: ["data_scraper", "data_normalizer"],
};

/** Score penalty applied to the `to` component of a co-occurring avoid_when edge. */
const AVOID_PENALTY: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5,
};

/** Tokenize a string into lowercase words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

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
  const matches: CapabilityMatch[] = [];
  for (const component of components) {
    if (mustAvoidSet.has(component.id.toLowerCase())) continue;

    const entry = scoreMap.get(component.id);
    if (entry && entry.score > 0) {
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
