import fs from "node:fs";
import type { RawEmailMessage } from "../types.js";
import { PATHS } from "../runtimePaths.js";

// Route step 1 (email_read).
//
// REAL vs STUB: when GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
// are set (scripts/connect.mjs writes them after a live probe), this reads the
// live Gmail API via raw fetch — refresh-token → access-token → messages.list
// → messages.get, no googleapis dependency, mirroring LAB's lib/google.ts.
// Without them it falls back to fixtures/leads.json for dry runs and CI.
//
// GMAIL_QUERY (default "is:unread category:primary") and GMAIL_MAX_MESSAGES
// (default 10) bound what a single run can pull in.

export async function readNewLeads(): Promise<RawEmailMessage[]> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn(
      "[DRY-RUN] email_read: no Gmail OAuth credentials in env — reading fixtures/leads.json instead of the live Gmail API."
    );
    const raw = fs.readFileSync(PATHS.leadsFixture, "utf8");
    return JSON.parse(raw) as RawEmailMessage[];
  }

  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  const query = process.env.GMAIL_QUERY ?? "is:unread category:primary";
  const maxMessages = Number(process.env.GMAIL_MAX_MESSAGES ?? "10");

  const listRes = await gmailGet(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxMessages}`,
    accessToken,
  );
  const ids = ((listRes.messages ?? []) as { id: string; threadId: string }[]).map((m) => m.id);
  console.log(`email_read: live Gmail — ${ids.length} message(s) matching "${query}".`);

  const messages: RawEmailMessage[] = [];
  for (const id of ids) {
    const msg = await gmailGet(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      accessToken,
    );
    messages.push(toRawEmailMessage(msg));
  }
  return messages;
}

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token;
}

async function gmailGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function toRawEmailMessage(msg: Record<string, unknown>): RawEmailMessage {
  const payload = msg.payload as GmailPart & { headers?: { name: string; value: string }[] };
  const header = (name: string) =>
    payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: String(msg.id),
    threadId: String(msg.threadId),
    from: header("From"),
    to: header("To"),
    subject: header("Subject"),
    bodyText: extractPlainText(payload) || String(msg.snippet ?? ""),
    receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
  };
}

function extractPlainText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const text = extractPlainText(child);
    if (text) return text;
  }
  return "";
}
