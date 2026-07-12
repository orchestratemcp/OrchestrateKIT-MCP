import type { Lead } from "../types.js";
import { PATHS, readJsonArray, writeJson } from "../runtimePaths.js";

// Route step 7 (crm_note_write) — high risk, only reachable after
// human_approval_gate returns "approved".
//
// STUB: no CRM credentials (HubSpot/Salesforce/Pipedrive) were available in
// this environment — the plan's own credential_advisory flags this
// component as needing one. This writes to runtime/crm_notes.json instead,
// matching the "Local filesystem ... CRM writes stubbed to a local JSON
// file for v1" output_location recorded in agent.manifest.json. Swap
// writeCrmNote() for a real CRM client call (upsert contact by email, then
// associate a note) when a token is available.
export interface CrmNote {
  emailId: string;
  contactEmail: string;
  contactName: string;
  note: string;
  createdAt: string;
}

export function writeCrmNote(lead: Lead, note: string): CrmNote {
  console.warn("[DRY-RUN] crm_note_write: no CRM credentials — writing to runtime/crm_notes.json instead of a live CRM.");
  const entry: CrmNote = {
    emailId: lead.emailId,
    contactEmail: lead.fromEmail,
    contactName: lead.fromName,
    note,
    createdAt: new Date().toISOString(),
  };
  const existing = readJsonArray<CrmNote>(PATHS.crmNotes);
  existing.push(entry);
  writeJson(PATHS.crmNotes, existing);
  return entry;
}
