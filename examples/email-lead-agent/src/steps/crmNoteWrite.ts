import type { Lead } from "../types.js";
import { PATHS, readJsonArray, writeJson } from "../runtimePaths.js";

// Route step 7 (crm_note_write) — high risk, only reachable after
// human_approval_gate returns "approved".
//
// REAL vs STUB: when HUBSPOT_PRIVATE_APP_TOKEN is set (scripts/connect.mjs
// mints + probes it), this upserts the contact by email and attaches a note
// via the HubSpot CRM v3 API. Without it, it writes to runtime/crm_notes.json
// — the local fallback recorded in agent.manifest.json. Either way the note
// is also appended locally so the audit trail is complete offline.

export interface CrmNote {
  emailId: string;
  contactEmail: string;
  contactName: string;
  note: string;
  createdAt: string;
  via: "hubspot" | "local";
}

export async function writeCrmNote(lead: Lead, note: string): Promise<CrmNote> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const entry: CrmNote = {
    emailId: lead.emailId,
    contactEmail: lead.fromEmail,
    contactName: lead.fromName,
    note,
    createdAt: new Date().toISOString(),
    via: token ? "hubspot" : "local",
  };

  if (token) {
    const contactId = await upsertHubspotContact(token, lead);
    await createHubspotNote(token, contactId, note);
    console.log(`crm_note_write: live HubSpot — note attached to contact ${lead.fromEmail}.`);
  } else {
    console.warn("[DRY-RUN] crm_note_write: no HUBSPOT_PRIVATE_APP_TOKEN — writing to runtime/crm_notes.json instead of a live CRM.");
  }

  const existing = readJsonArray<CrmNote>(PATHS.crmNotes);
  existing.push(entry);
  writeJson(PATHS.crmNotes, existing);
  return entry;
}

async function hubspotFetch(token: string, url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 409) {
    throw new Error(`HubSpot ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { ...data, __status: res.status };
}

async function upsertHubspotContact(token: string, lead: Lead): Promise<string> {
  const [firstname, ...rest] = lead.fromName.split(" ");
  const created = await hubspotFetch(token, "https://api.hubapi.com/crm/v3/objects/contacts", {
    properties: { email: lead.fromEmail, firstname, lastname: rest.join(" ") },
  });
  if (created.__status !== 409) return String(created.id);

  // 409 = contact exists; the error message carries "Existing ID: <id>".
  const message = String(created.message ?? "");
  const existingId = message.match(/Existing ID: (\d+)/)?.[1];
  if (existingId) return existingId;

  const search = await hubspotFetch(token, "https://api.hubapi.com/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.fromEmail }] }],
    limit: 1,
  });
  const hit = (search.results as { id: string }[] | undefined)?.[0];
  if (!hit) throw new Error(`HubSpot contact upsert failed for ${lead.fromEmail}: ${message}`);
  return hit.id;
}

async function createHubspotNote(token: string, contactId: string, note: string): Promise<void> {
  await hubspotFetch(token, "https://api.hubapi.com/crm/v3/objects/notes", {
    properties: { hs_note_body: note, hs_timestamp: new Date().toISOString() },
    associations: [
      {
        to: { id: contactId },
        // 202 = note-to-contact in HubSpot's default association type ids
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
      },
    ],
  });
}
