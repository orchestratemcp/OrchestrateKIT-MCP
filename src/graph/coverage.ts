/**
 * Coverage accounting (MAR-250) — the scope compiler's honesty layer.
 *
 * Answers three questions about a plan, deterministically and with no LLM:
 *   1. Which goal phrases did the route actually claim? (matched)
 *   2. Which goal steps matched NOTHING in the registry? (unmatched demand —
 *      the "save a note into Notion → 'nothing external'" failure class)
 *   3. Which routed components have no goal phrase supporting them?
 *      (unsupported supply — the "crm_note_write on a Postgres→PDF→Slack goal"
 *      failure class: selected on fuzzy capability/summary word overlap alone)
 *
 * Everything here is derived from the matcher's own scoring provenance
 * (CapabilityMatch.matched_tokens / .evidence) plus a fixed demand lexicon.
 * Unsupported supply is FLAGGED, never dropped — route membership is unchanged,
 * so no probe/corpus behavior moves; the verdict layer gets honest instead.
 */

import type { CapabilityMatch } from "./capabilityMatcher.js";
import { isNegatedInContext } from "./capabilityMatcher.js";

export type CoverageLabel = "full" | "partial" | "poor";

export type Coverage = {
  /** Goal tokens/phrases each route component actually claimed. */
  matched: Array<{ component_id: string; tokens: string[] }>;
  /**
   * Goal clauses that name workflow work (a demand verb/noun from the lexicon)
   * which NO selected component claimed. These steps are outside the registry —
   * the reading agent must treat them as 🔵 unguided, not silently drop them.
   */
  unmatched_demand: string[];
  /**
   * Route components selected on fuzzy evidence alone (capability/summary word
   * overlap; no keyword hint, no identifier match). No goal phrase asked for
   * them — verify before building, or remove.
   */
  unsupported_supply: string[];
  coverage_label: CoverageLabel;
};

/**
 * Action verbs that name a workflow step. A verb alone only flags a clause when
 * the clause has no demand NOUNS (nouns anchor the judgement — see
 * clauseIsUncovered). Deliberately excludes ambient verbs ("run", "use",
 * "check", "make") that appear in nearly every goal without naming a step.
 */
const DEMAND_VERBS = new Set([
  "read", "send", "draft", "reply", "classify", "generate", "create",
  "produce", "save", "store", "post", "publish", "pull", "fetch", "extract",
  "parse", "monitor", "watch", "alert", "notify", "summarize", "summarise",
  "enrich", "update", "write", "validate", "deduplicate", "scrape", "review",
  "approve", "upload", "download", "sync", "translate", "transcribe", "book",
]);

/**
 * System / artifact nouns that name WHAT the workflow touches. These are the
 * demand anchors: an unclaimed noun means a named system or artifact the route
 * does not carry. Includes systems the registry deliberately does NOT cover yet
 * (postgres, notion, …) — naming known-unknowns is the whole point.
 * Deliberately excludes ambient nouns ("api", "channel", "team", "data",
 * "message") that co-occur with covered work and would false-alarm.
 */
const DEMAND_NOUNS = new Set([
  // registry-covered systems (claimed when their component matches)
  "email", "emails", "inbox", "slack", "discord", "telegram", "notion",
  "airtable", "stripe", "pdf", "spreadsheet", "csv", "crm", "calendar",
  "github", "webhook", "invoice", "invoices", "uptime", "logs", "metric",
  "sources",
  // known-unknown systems/artifacts — not in the registry today; an unclaimed
  // hit here is exactly the gap the user must hear about
  "postgres", "postgresql", "mysql", "sqlite", "sql", "database", "warehouse",
  "bigquery", "snowflake", "report", "hubspot", "salesforce", "jira",
  "gitlab", "wordpress", "twitter", "linkedin", "instagram", "facebook",
  "youtube", "tiktok", "shopify", "zendesk", "intercom", "sms", "whatsapp",
  "dropbox", "s3",
]);

/** Multi-word demand phrases checked before single tokens. */
const DEMAND_PHRASES = ["google drive", "google sheets", "pull request"];

/**
 * Clause boundaries: punctuation and step conjunctions. "and" is included so a
 * long conjunction chain reports each uncovered step as its own readable phrase
 * ("…trusted sources AND save a digest note into Notion" → the Notion step
 * surfaces whole instead of being truncated off the end of a mega-clause).
 */
const CLAUSE_SPLIT = /[,.;:!?—–]|\bthen\b|\band\b/;

/**
 * Safety / policy infrastructure the augmenter injects deterministically for
 * routes like these (MAR-88/117 chains). When one of them ALSO happens to
 * fuzzy-match the goal first (audit_log scored on the token "every"; observed
 * in the MAR-250 audit), it lands via the matcher instead of the augmenter —
 * but it is still policy-justified, never unsupported supply.
 */
const SAFETY_INFRA_COMPONENTS = new Set([
  "human_approval_gate",
  "audit_log",
  "schema_validation",
  "auth_failure_handler",
  "retry_policy",
  "state_store",
]);

const CLAUSE_MAX_CHARS = 80;

function tokenizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

/**
 * A demand item is claimed when any selected component's matched token equals
 * it or contains/is contained by it (≥3 chars both sides) — so "emails" is
 * claimed by the "email" hint, "replies" by "reply", and words inside a
 * multi-word hint ("every morning", "human review") claim their parts.
 */
function isClaimed(item: string, claimedTokens: Set<string>): boolean {
  if (claimedTokens.has(item)) return true;
  for (const t of claimedTokens) {
    if (t.length < 3 || item.length < 3) continue;
    if (t.includes(item) || item.includes(t)) return true;
  }
  return false;
}

/**
 * Nouns anchor the verdict: when a clause names demand-noun UNITS, it is
 * uncovered iff ANY unit is unclaimed. A clause with only demand verbs is
 * uncovered iff ALL of them are unclaimed — verbs are too generic for a single
 * miss to outweigh a claimed sibling ("post it to our team Slack channel" is
 * covered by the claimed `slack` even though `post` isn't).
 *
 * A UNIT is a compound: demand nouns within 2 words of each other in the clause
 * ("our Postgres database", "PDF summary report") name ONE system/artifact, and
 * the unit is claimed when ANY member is. Without grouping, "Postgres database"
 * false-alarmed after MAR-254: db_read claims `postgres` but no phrase claims
 * the adjacent `database`, and a covered step read as an uncovered one.
 */
function clauseIsUncovered(
  nounUnits: string[][],
  verbs: string[],
  claimedTokens: Set<string>,
): boolean {
  if (nounUnits.length > 0) {
    return nounUnits.some((unit) => unit.every((n) => !isClaimed(n, claimedTokens)));
  }
  if (verbs.length > 0) {
    return verbs.every((v) => !isClaimed(v, claimedTokens));
  }
  return false;
}

/**
 * Group a clause's demand nouns into compound units: nouns whose word positions
 * are within `maxGap` of each other merge ("pdf … report" with "summary"
 * between them is one artifact). Multi-word phrase hits are their own unit.
 */
function groupNounUnits(
  words: string[],
  phraseHits: string[],
  isDemandNoun: (w: string) => boolean,
): string[][] {
  const MAX_GAP = 2;
  const units: string[][] = [];
  let current: string[] = [];
  let lastIdx = -Infinity;
  words.forEach((w, i) => {
    if (!isDemandNoun(w)) return;
    if (i - lastIdx > MAX_GAP && current.length > 0) {
      units.push(current);
      current = [];
    }
    current.push(w);
    lastIdx = i;
  });
  if (current.length > 0) units.push(current);
  for (const p of phraseHits) units.push([p]);
  return units;
}

export type CoverageInput = {
  goal: string;
  /** Matcher matches restricted to components present in the FINAL route. */
  routeMatches: CapabilityMatch[];
  /** Final route component ids (matcher-selected + injected). */
  finalComponentIds: string[];
  /**
   * Components added by policy rather than by the matcher (safety augmenter,
   * `requires` expansion, prerequisite chain). Policy additions are supported
   * by construction and never count as unsupported supply.
   */
  injectedComponentIds: Set<string>;
  /**
   * "playbook" plans serve a validated fixed component set — unsupported-supply
   * accounting does not apply to it (the set is evidence-backed as a whole).
   */
  mode?: "composed" | "playbook";
};

export function computeCoverage(input: CoverageInput): Coverage {
  const { goal, routeMatches, finalComponentIds, injectedComponentIds } = input;
  const mode = input.mode ?? "composed";
  const goalLower = goal.toLowerCase();

  // ── matched: each route component's claimed goal tokens ──
  const matched = routeMatches
    .filter((m) => finalComponentIds.includes(m.component.id))
    .map((m) => ({
      component_id: m.component.id,
      tokens: [...m.matched_tokens].sort(),
    }))
    .sort((a, b) => a.component_id.localeCompare(b.component_id));

  // Claimed-token set: every token any route component matched on, plus the
  // words inside multi-word hint tokens.
  const claimedTokens = new Set<string>();
  for (const m of matched) {
    for (const token of m.tokens) {
      claimedTokens.add(token);
      for (const w of tokenizeWords(token)) claimedTokens.add(w);
    }
  }

  // ── unmatched demand: clause-by-clause ──
  const unmatched_demand: string[] = [];
  for (const rawClause of goal.split(CLAUSE_SPLIT)) {
    const clause = rawClause.trim();
    if (clause.length < 4) continue;
    const clauseLower = clause.toLowerCase();

    const words = tokenizeWords(clause);
    // A negated demand word is a constraint ("never send", "no emails"), not a
    // step — check negation against the FULL goal so a negation just before the
    // clause boundary still counts.
    const phraseHits = DEMAND_PHRASES.filter(
      (p) => clauseLower.includes(p) && !isNegatedInContext(goalLower, p),
    );
    const nounUnits = groupNounUnits(
      words,
      phraseHits,
      (w) => DEMAND_NOUNS.has(w) && !isNegatedInContext(goalLower, w),
    );
    const verbs = words.filter(
      (w) => DEMAND_VERBS.has(w) && !isNegatedInContext(goalLower, w),
    );
    if (nounUnits.length === 0 && verbs.length === 0) continue;

    if (clauseIsUncovered(nounUnits, verbs, claimedTokens)) {
      const shown =
        clause.length > CLAUSE_MAX_CHARS
          ? `${clause.slice(0, CLAUSE_MAX_CHARS - 1).trimEnd()}…`
          : clause;
      unmatched_demand.push(shown);
    }
  }

  // ── unsupported supply: fuzzy-evidence-only route components ──
  let unsupported_supply: string[] = [];
  if (mode === "composed") {
    unsupported_supply = routeMatches
      .filter(
        (m) =>
          finalComponentIds.includes(m.component.id) &&
          !injectedComponentIds.has(m.component.id) &&
          !SAFETY_INFRA_COMPONENTS.has(m.component.id) &&
          !m.evidence.includes("hint") &&
          !m.evidence.includes("segment"),
      )
      .map((m) => m.component.id)
      .sort();
  }

  // full    — nothing missing, nothing unjustified.
  // partial — a single soft gap: one uncovered step OR unjustified extras only.
  //           (Extras alone are a verify-list, not a broken plan.)
  // poor    — several uncovered steps, or an uncovered step alongside
  //           unjustified extras, or extras piling up: the route needs rework.
  const unmatchedN = unmatched_demand.length;
  const unsupportedN = unsupported_supply.length;
  const coverage_label: CoverageLabel =
    unmatchedN === 0 && unsupportedN === 0
      ? "full"
      : unmatchedN >= 2 || (unmatchedN >= 1 && unsupportedN >= 1) || unsupportedN >= 3
      ? "poor"
      : "partial";

  return { matched, unmatched_demand, unsupported_supply, coverage_label };
}
