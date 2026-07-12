import fs from "node:fs";
import type { RawEmailMessage } from "../types.js";
import { PATHS } from "../runtimePaths.js";

// Route step 1 (email_read).
//
// REAL vs STUB: no GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
// were present in this environment (checked at build time), so this reads a
// fixture file instead of the live Gmail API. When those three env vars are
// set, swap the body of readNewLeads() for a googleapis Gmail client call
// (users.messages.list + users.messages.get) — the return shape below is
// already what that call needs to produce.
export function readNewLeads(): RawEmailMessage[] {
  const hasGmailCreds =
    !!process.env.GMAIL_CLIENT_ID &&
    !!process.env.GMAIL_CLIENT_SECRET &&
    !!process.env.GMAIL_REFRESH_TOKEN;

  if (!hasGmailCreds) {
    console.warn(
      "[DRY-RUN] email_read: no Gmail OAuth credentials in env — reading fixtures/leads.json instead of the live Gmail API."
    );
    const raw = fs.readFileSync(PATHS.leadsFixture, "utf8");
    return JSON.parse(raw) as RawEmailMessage[];
  }

  throw new Error(
    "Gmail credentials were detected but the live Gmail API client is not wired up in this build — " +
      "this branch is a placeholder for the real integration, not a silent fallback."
  );
}
