/**
 * constraintSignals — MAR-255 (BRIEF-03).
 *
 * The single source of truth for goal-constraint detection, shared by
 * plan_workflow (gate enforcement / waiver logic, MAR-132/229) and
 * export_build_brief (§0 Constraints). Extracted VERBATIM from planWorkflow so
 * the planner's behavior is unchanged; the brief previously had its own weaker
 * detector and opened with "No explicit … constraint detected" on goals the
 * planner had already constrained (audit 2026-07-01, live).
 *
 * Pure string logic — no registry, no LLM, no state.
 */

/**
 * Explicit "read-only / no-write" constraint phrases (MAR-142). Used by the
 * planner to warn when a write-bearing playbook is routed for a constrained
 * goal, and by the brief's §0.
 *
 * Send prohibitions ("never send", "no email sent") are NOT in this table:
 * they are the no_outbound class (NO_OUTBOUND_SIGNALS) and are handled
 * structurally by outboundComponentsExcludedByConstraints. Treating them as
 * read-only made "Never send the email" warn against the calendar/draft
 * writes the goal explicitly asked for (live golden-prompt finding, 2026-07-17).
 */
export const WRITE_CONSTRAINT_SIGNALS = [
  "read-only",
  "read only",
  "never write",
  "no write",
  "no writes",
  "no database update",
];

export function hasWriteConstraint(goal: string): boolean {
  const g = goal.toLowerCase();
  return WRITE_CONSTRAINT_SIGNALS.some((s) => g.includes(s));
}

/**
 * Explicit "no human gate" phrases. Substring-matched on the lowercased goal.
 * Deliberately narrow — only unambiguous opt-outs, never bare "automated".
 */
export const UNATTENDED_WAIVER_SIGNALS = [
  "unattended",
  "no human",
  "without human",
  "no approval",
  "without approval",
  "no gate",
  "without a gate",
  "no manual approval",
  "fully automated",
  "fully autonomous",
];

/**
 * Waiver signals whose meaning flips under a preceding negation ("not
 * unattended", "never fully automated"). The "no …" / "without …" signals are
 * already opt-outs and are left as-is. (MAR-229)
 */
const NEGATABLE_WAIVER_SIGNALS = ["unattended", "fully automated", "fully autonomous"];

/**
 * Explicit "I DO want the human gate" phrases. When any is present (and not
 * itself negated) the user is asking for an ENFORCED gate, so it outranks any
 * waiver phrasing — never downgrade to advisory. (MAR-229)
 *
 * Deliberately collision-free: phrases that appear inside waiver phrasings
 * ("no manual approval", "no human in the loop", "no approval required") are
 * excluded so they can't mis-fire. `\battended\b` is handled separately so it
 * matches "attended" but not "unattended".
 */
export const APPROVAL_REQUIRED_SIGNALS = [
  "must approve",
  "must be approved",
  "must review",
  "must be reviewed",
  "require approval",
  "requires approval",
  "needs approval",
  "need approval",
  "require human",
  "requires human",
  "human must",
  "approve before",
  "approval before",
  "review before",
  // MAR-347: gate-ordering phrases from constraint-expanded goals ("only after a
  // human approves", "must not send … until approved"). Both name an approval
  // that must happen before an action — an ENFORCED gate, not a prohibition.
  "until approved",
  "human approves",
];

/**
 * True when `phrase` occurs in `goal` with at least one occurrence NOT preceded
 * by a negation word. `includeNo` adds "no"/"without" to the negation set (used
 * for approval phrases like "no approval before"; the waiver path uses only the
 * not/never family). (MAR-229)
 */
export function occursUnnegated(goal: string, phrase: string, includeNo: boolean): boolean {
  const neg = includeNo
    ? /\b(not|never|no longer|isn't|is not|aren't|won't|wont|no|without)\b\W*$/
    : /\b(not|never|no longer|isn't|is not|aren't|won't|wont)\b\W*$/;
  let from = 0;
  for (;;) {
    const idx = goal.indexOf(phrase, from);
    if (idx < 0) return false;
    const before = goal.slice(Math.max(0, idx - 16), idx);
    if (!neg.test(before)) return true; // a clean, non-negated occurrence
    from = idx + phrase.length;
  }
}

/** True when the goal explicitly REQUIRES a human approval gate (MAR-229). */
export function hasExplicitApprovalRequirement(goal: string): boolean {
  const g = goal.toLowerCase();
  // \battended\b matches standalone "attended" but NOT "unattended" (the 'un'
  // prefix removes the leading word boundary).
  if (/\battended\b/.test(g)) return true;
  return APPROVAL_REQUIRED_SIGNALS.some((s) => occursUnnegated(g, s, true));
}

/**
 * True when the goal explicitly waives a human approval gate (MAR-132, hardened
 * in MAR-229). An explicit approval REQUIREMENT outranks any waiver phrase, and
 * negated waiver signals ("not unattended") do not count.
 */
export function hasUnattendedWaiver(goal: string): boolean {
  const g = goal.toLowerCase();
  if (hasExplicitApprovalRequirement(g)) return false;
  return UNATTENDED_WAIVER_SIGNALS.some((s) => {
    if (!g.includes(s)) return false;
    // negatable signals ("not unattended") don't count when negated
    if (NEGATABLE_WAIVER_SIGNALS.includes(s) && !occursUnnegated(g, s, false)) {
      return false;
    }
    return true;
  });
}

// ────────────── approval-gated prohibition clauses (MAR-347) ──────────────

/**
 * "It must not send email or post to Slack until approved" is an APPROVAL-GATE
 * constraint on actions the goal already asks for — not an absolute
 * no-send/no-post request and not new capability demand. Cursor's client-side
 * expansion of the first-run Gmail lead starter produces exactly this shape,
 * and the raw clause (a) fired the "post" → external_publish hint and
 * established content_publishing, dropping the validated email_lead_to_crm
 * playbook below the precision floor, and (b) lets absolute no-send suppression
 * phrases ("do not send") fire on a send the user DOES want, merely gated.
 *
 * A clause is gated when, within one sentence/clause, it reads:
 *   negation → outbound verb → until/unless/before/without → approval word.
 * The match stops at the approval word so trailing text ("… until approved by
 * the sales manager") survives. True draft-only / no-send goals ("drafts only,
 * do not send anything", "Must never auto-send.") carry no approval
 * conjunction inside the clause and are untouched (MAR-161/MAR-219 behavior).
 */
const GATED_PROHIBITION_CLAUSE =
  /\b(?:must not|may not|cannot|can't|cant|does not|doesn't|do not|don't|dont|will not|won't|wont|never|no)\s+(?:auto[- ]?)?(?:send|sends|sending|post|posts|posting|publish|publishes|publishing|email|emails|share|shares|sharing|notify|reply|respond)\b[^.!?;]{0,100}?\b(?:until|unless|before|without)\b[^.!?;]{0,60}?\b(?:approv\w*|review\w*|sign[- ]?off|signoff|confirm\w*)/gi;

/**
 * Replace every approval-gated prohibition clause with a space, so downstream
 * string matching (domain classification, keyword hints, capability
 * suppression) never reads a gated send as either fresh demand or an absolute
 * prohibition. The ORIGINAL goal keeps flowing to the constraint predicates
 * above — "until approved" is an APPROVAL_REQUIRED_SIGNALS entry, so the gate
 * semantics are preserved where they belong. (MAR-347)
 */
export function neutralizeApprovalGatedProhibitions(goal: string): string {
  return goal.replace(GATED_PROHIBITION_CLAUSE, " ");
}

// ───────────────────── §0 constraint detection (MAR-255) ─────────────────────

export type ConstraintSignal = {
  detected: boolean;
  /** The goal phrase that triggered detection — the compiler shows its work. */
  trigger: string | null;
};

export type ConstraintSignals = {
  read_only: ConstraintSignal;
  unattended: ConstraintSignal;
  attended_required: ConstraintSignal;
  draft_only: ConstraintSignal;
  no_outbound: ConstraintSignal;
  /** unattended + attended both present — surface both with a ⚠️ marker. */
  conflict: boolean;
};

/** First matching phrase from a list (substring on the lowercased goal). */
function firstMatch(g: string, phrases: string[]): string | null {
  for (const p of phrases) if (g.includes(p)) return p;
  return null;
}

/**
 * §0-only trigger phrases. These EXTEND the planner's signal sets for the
 * brief's rendering — they are deliberately NOT used by hasUnattendedWaiver /
 * hasExplicitApprovalRequirement, whose phrase tables are load-bearing for
 * gate enforcement (MAR-229) and must not drift under a rendering change.
 */
const DRAFT_ONLY_SIGNALS = [
  "draft-only",
  "draft only",
  "drafts only",
  "as drafts",
  "save as draft",
  "saves everything as drafts",
  "never send anything automatically",
  "never auto-send",
  "never auto send",
  "no auto-send",
  "must never auto-send",
];

const ATTENDED_SIGNALS_FOR_BRIEF = [
  "for my approval",
  "for approval",
  "for my review",
  "human reviews",
  "a human reviews",
  "human review before",
  "i review",
  "i approve",
];

const NO_OUTBOUND_SIGNALS = [
  "no outbound",
  "no outbound email",
  "no outbound emails",
  "never send anything",
  "do not send anything",
  "don't send anything",
  "no emails sent",
  "no email sent",
  "never send",
  "internal only",
  "stays internal",
  "do not send",
  "don't send",
  "do not want it to send",
  "don't want it to send",
  "dont want it to send",
  "nothing gets sent",
  "nothing sent out",
  "nothing is sent",
  "nothing goes out",
  "nothing sent externally",
  "no external sends",
];

const EMAIL_SEND_COMPONENTS_EXCLUDED_BY_NO_OUTBOUND = [
  "optional_email_send",
  "reviewer_notification",
] as const;

const ALL_SEND_COMPONENTS_EXCLUDED_BY_NO_OUTBOUND = [
  "external_publish",
  "optional_email_send",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
  "reviewer_notification",
] as const;

function hasBroadNoOutboundConstraint(goal: string): boolean {
  const g = neutralizeApprovalGatedProhibitions(goal).toLowerCase();
  return [
    "no outbound",
    "internal only",
    "stays internal",
    "no external sends",
    "never send anything",
    "do not send anything",
    "don't send anything",
    "dont send anything",
    "do not want it to send anything",
    "don't want it to send anything",
    "dont want it to send anything",
    "nothing gets sent",
    "nothing sent out",
    "nothing is sent",
    "nothing goes out",
    "nothing sent externally",
  ].some((s) => g.includes(s));
}

const READ_ONLY_SIGNALS = [
  "read-only",
  "read only",
  "never write",
  "no write",
  "no writes",
  "no database update",
  "never edit",
  "never commit",
];

/**
 * Detect the goal's explicit constraints with their trigger phrases (MAR-255).
 * Uses the planner's own predicates for unattended/attended (single source),
 * plus brief-side phrase tables for the classes the planner tracks implicitly
 * (draft-only, no-outbound, read-only-as-a-class).
 */
export function detectConstraintSignals(goal: string): ConstraintSignals {
  const rawGoal = goal.toLowerCase();
  const g = neutralizeApprovalGatedProhibitions(goal).toLowerCase();

  const readOnlyTrigger = firstMatch(g, READ_ONLY_SIGNALS);
  const draftOnlyTrigger = firstMatch(g, DRAFT_ONLY_SIGNALS);
  const noOutboundTrigger = firstMatch(g, NO_OUTBOUND_SIGNALS);

  const unattended = hasUnattendedWaiver(rawGoal);
  const unattendedTrigger = unattended
    ? firstMatch(rawGoal, UNATTENDED_WAIVER_SIGNALS)
    : null;

  const attended =
    hasExplicitApprovalRequirement(rawGoal) ||
    ATTENDED_SIGNALS_FOR_BRIEF.some((s) => occursUnnegated(rawGoal, s, true));
  const attendedTrigger = attended
    ? (/\battended\b/.test(rawGoal) ? "attended" : null) ??
      firstMatch(rawGoal, APPROVAL_REQUIRED_SIGNALS) ??
      firstMatch(rawGoal, ATTENDED_SIGNALS_FOR_BRIEF)
    : null;

  // hasUnattendedWaiver already yields to an explicit approval requirement
  // (MAR-229), so a true conflict is only visible via the brief-side attended
  // phrases co-occurring with a waiver phrase — mirror the planner: attended
  // wins, but SHOW both with a marker instead of silently dropping one.
  const rawWaiverPhrase = firstMatch(rawGoal, UNATTENDED_WAIVER_SIGNALS);
  const conflict = attended && rawWaiverPhrase !== null;

  return {
    read_only: { detected: readOnlyTrigger !== null, trigger: readOnlyTrigger },
    unattended: {
      detected: unattended || (conflict && rawWaiverPhrase !== null),
      trigger: unattendedTrigger ?? (conflict ? rawWaiverPhrase : null),
    },
    attended_required: { detected: attended, trigger: attendedTrigger },
    draft_only: { detected: draftOnlyTrigger !== null, trigger: draftOnlyTrigger },
    no_outbound: { detected: noOutboundTrigger !== null, trigger: noOutboundTrigger },
    conflict,
  };
}

/**
 * Components that must be structurally absent when the user states a no-send /
 * no-outbound constraint. Email-specific phrases ("never send the email") only
 * remove email sending; broad phrases ("internal only", "no outbound") remove
 * all outbound send/post/publish components. Calendar writes are deliberately
 * not in this set because booking a meeting can be explicitly requested while
 * the email reply must stay draft-only.
 */
export function outboundComponentsExcludedByConstraints(goal: string): Set<string> {
  const signals = detectConstraintSignals(goal);
  if (!signals.no_outbound.detected && !signals.draft_only.detected) {
    return new Set();
  }

  const excluded = new Set<string>(EMAIL_SEND_COMPONENTS_EXCLUDED_BY_NO_OUTBOUND);
  if (signals.no_outbound.detected && hasBroadNoOutboundConstraint(goal)) {
    for (const id of ALL_SEND_COMPONENTS_EXCLUDED_BY_NO_OUTBOUND) {
      excluded.add(id);
    }
  }
  return excluded;
}
