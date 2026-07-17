/**
 * Single source of truth for Google Workspace (Gmail/Calendar) OAuth scopes,
 * keyed by registry component id (P0-05).
 *
 * Before this module existed, the scope for each component was hardcoded
 * independently in two places — `connectContract.ts` (credential manifest,
 * connect.mjs, build brief §11) and `planWorkflow.ts` (`what_you_need`) — and
 * they had drifted: `what_you_need` claimed Gmail draft creation required
 * `gmail.send`, while `connectContract.ts` correctly omitted it. Google's
 * `users.drafts.create` accepts `gmail.compose` (or the broader
 * `gmail.modify`); `gmail.send` is only required to actually transmit a
 * message, never to create or update a draft.
 * https://developers.google.com/gmail/api/reference/rest/v1/users.drafts/create
 *
 * Every surface that renders a Gmail/Calendar scope must derive it from
 * `GOOGLE_SCOPE_CATALOG` below rather than holding its own copy.
 */

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export type GoogleScopeCatalogEntry = {
  /** Least-privilege OAuth scopes this component needs, in display order. */
  scopes: readonly string[];
  /** Why this scope set is sufficient, surfaced next to it in rendered output. */
  note?: string;
  /**
   * What the provider DOES when this scope is exercised, beyond the write the
   * user asked for. A side effect is not a permission: it does not widen the
   * grant and cannot be requested or withheld at consent time, so it must never
   * be rendered in a scope list (a reader who sees it there reasonably concludes
   * it is a checkbox on the consent screen). Kept next to the scope because the
   * two are read together — the scope says what the agent may do, this says what
   * the provider does to other people when it does it.
   */
  side_effect?: string;
};

/**
 * Google emails every attendee when an event is created or updated, unless the
 * call opts out. This is the disclosure behind the `calendar_notification`
 * clarifying question (plan_workflow) and the calendar_write build gotcha —
 * both derive from this constant so the wording cannot drift.
 */
export const CALENDAR_INVITE_SIDE_EFFECT =
  "Creating an event with attendees sends email invitations automatically — add sendUpdates=none to suppress";

/**
 * Scopes required per registry component_id. Read-only components get
 * read-only scopes; draft creation gets compose (never send); calendar
 * write gets the events scope.
 */
export const GOOGLE_SCOPE_CATALOG: Readonly<Record<string, GoogleScopeCatalogEntry>> = {
  email_read: {
    scopes: [GMAIL_READONLY_SCOPE],
  },
  email_draft: {
    scopes: [GMAIL_COMPOSE_SCOPE],
    note: "Draft-only: gmail.compose is sufficient for users.drafts.create — gmail.send is never requested for drafting.",
  },
  gmail_draft_write: {
    scopes: [GMAIL_COMPOSE_SCOPE],
    note: "Saves the approved reply via users.drafts.create. Same compose scope as email_draft — persisting a draft needs no more privilege than composing one, and gmail.send stays out of the grant so the agent is incapable of transmitting.",
  },
  calendar_lookup: {
    scopes: [CALENDAR_READONLY_SCOPE],
  },
  calendar_write: {
    scopes: [CALENDAR_EVENTS_SCOPE],
    side_effect: CALENDAR_INVITE_SIDE_EFFECT,
  },
};

/**
 * Dedup-merge the Google scopes needed for a set of route component ids, in
 * stable catalog order (Gmail before Calendar, read before write).
 */
export function googleScopesForComponents(componentIds: readonly string[]): string[] {
  const present = new Set(componentIds);
  const scopes: string[] = [];
  for (const id of [
    "email_read",
    "email_draft",
    "gmail_draft_write",
    "calendar_lookup",
    "calendar_write",
  ]) {
    if (!present.has(id)) continue;
    for (const scope of GOOGLE_SCOPE_CATALOG[id].scopes) {
      if (!scopes.includes(scope)) scopes.push(scope);
    }
  }
  return scopes;
}
