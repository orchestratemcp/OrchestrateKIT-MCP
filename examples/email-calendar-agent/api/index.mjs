import { createHash, randomUUID } from "node:crypto";
import {
  encodeRawEmail,
  findAvailableSlots,
  safeTokenEqual,
  signApproval,
  toEmailMessage,
  verifyApproval,
} from "../src/core.mjs";

const AGENT = "email-calendar-assistant";

function send(response, status, body) {
  response.status(status).setHeader("content-type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function requireConfig(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

function authorize(request) {
  requireConfig(["APP_ACCESS_TOKEN"]);
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeTokenEqual(supplied, process.env.APP_ACCESS_TOKEN)) {
    const error = new Error("Unauthorized.");
    error.statusCode = 401;
    throw error;
  }
}

async function googleAccessToken() {
  requireConfig(["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`Google token refresh failed: ${data.error_description ?? data.error ?? response.status}`);
  return data.access_token;
}

async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`Google API ${response.status}: ${text.slice(0, 300)}`);
    error.statusCode = response.status;
    error.googleData = data;
    throw error;
  }
  return data;
}

async function openRouterJson(messages, schemaName, schema) {
  requireConfig(["OPENROUTER_API_KEY"]);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "http-referer": process.env.PUBLIC_APP_URL ?? "https://orchestratemcp.dev",
      "x-title": "OrchestrateKit Email Calendar Assistant",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
      temperature: 0,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no structured content.");
  return { value: JSON.parse(content), model: data.model ?? process.env.OPENROUTER_MODEL ?? "openrouter/free" };
}

function audit(runId, type, componentId, detail, seq) {
  const event = { event_version: 1, agent: AGENT, run_id: runId, seq, ts: new Date().toISOString(), type, component_id: componentId, detail };
  console.log(JSON.stringify({ kind: "orchestratekit_audit", ...event }));
  const endpoint = process.env.DASH_INGEST_URL;
  const token = process.env.DASH_INGEST_TOKEN;
  if (endpoint && token) {
    fetch(`${endpoint.replace(/\/$/, "")}/api/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(event),
    }).catch((error) => console.warn(`[lab optional] ${error.message}`));
  }
}

async function scanInbox() {
  requireConfig(["APPROVAL_SECRET"]);
  const runId = randomUUID();
  let seq = 0;
  audit(runId, "run_started", "run", "scan requested", ++seq);
  const accessToken = await googleAccessToken();
  const query = process.env.GMAIL_QUERY ?? 'is:unread newer_than:7d (meeting OR calendar OR call OR chat)';
  audit(runId, "step_started", "email_read", query, ++seq);
  const list = await googleJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
    accessToken,
  );
  const messages = await Promise.all((list.messages ?? []).map(async ({ id }) =>
    toEmailMessage(await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, accessToken)),
  ));
  if (!messages.length) throw new Error(`No Gmail messages matched: ${query}`);
  audit(runId, "step_completed", "email_read", `${messages.length} messages`, ++seq);

  audit(runId, "step_started", "intent_classifier", "classifying inbox candidates", ++seq);
  const classification = await openRouterJson([
    {
      role: "system",
      content: "Select one genuine request to schedule a meeting. Ignore newsletters, automated mail, and existing calendar notifications. Return no_match when none qualifies.",
    },
    {
      role: "user",
      content: JSON.stringify(messages.map((message, index) => ({ index, from: message.from, subject: message.subject, body: message.bodyText.slice(0, 1800) }))),
    },
  ], "meeting_request", {
    type: "object",
    additionalProperties: false,
    required: ["intent", "messageIndex", "reason"],
    properties: {
      intent: { enum: ["schedule_meeting", "no_match"] },
      messageIndex: { type: "integer", minimum: -1, maximum: Math.max(-1, messages.length - 1) },
      reason: { type: "string" },
    },
  });
  if (classification.value.intent !== "schedule_meeting" || !messages[classification.value.messageIndex]) {
    throw new Error(`No meeting request found: ${classification.value.reason}`);
  }
  const message = messages[classification.value.messageIndex];
  if (!message.fromMailbox.email.includes("@")) throw new Error("Selected meeting request has no valid sender email.");
  audit(runId, "step_completed", "intent_classifier", `${message.subject}; model=${classification.model}`, ++seq);

  const now = new Date();
  const timeZone = process.env.DEMO_TIMEZONE ?? "Europe/Stockholm";
  audit(runId, "step_started", "calendar_lookup", timeZone, ++seq);
  const freeBusy = await googleJson("https://www.googleapis.com/calendar/v3/freeBusy", accessToken, {
    method: "POST",
    body: JSON.stringify({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      timeZone,
      items: [{ id: "primary" }],
    }),
  });
  const slots = findAvailableSlots({ busy: freeBusy.calendars?.primary?.busy ?? [], now, timeZone });
  audit(runId, "step_completed", "calendar_lookup", slots.map((slot) => slot.label).join(" | "), ++seq);

  audit(runId, "step_started", "email_draft", message.id, ++seq);
  const drafted = await openRouterJson([
    {
      role: "system",
      content: "Draft a concise, warm reply offering exactly the two supplied slots. Do not claim anything is booked. Return plain text without markdown. Also propose a short calendar title.",
    },
    {
      role: "user",
      content: JSON.stringify({ sender: message.from, subject: message.subject, body: message.bodyText.slice(0, 3000), slots: slots.map((slot) => slot.label), timeZone }),
    },
  ], "meeting_reply", {
    type: "object",
    additionalProperties: false,
    required: ["subject", "bodyText", "eventTitle"],
    properties: {
      subject: { type: "string" },
      bodyText: { type: "string" },
      eventTitle: { type: "string" },
    },
  });
  audit(runId, "step_completed", "email_draft", `model=${drafted.model}`, ++seq);

  const approvalId = randomUUID();
  const proposal = {
    version: 1,
    approvalId,
    runId,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    message: {
      id: message.id,
      threadId: message.threadId,
      from: message.from,
      fromEmail: message.fromMailbox.email,
      subject: message.subject,
      bodyText: message.bodyText.slice(0, 4000),
      messageId: message.messageId,
    },
    slots,
    timeZone,
    eventTitle: drafted.value.eventTitle,
    draft: { to: message.fromMailbox.email, subject: drafted.value.subject, bodyText: drafted.value.bodyText },
  };
  audit(runId, "gate_requested", "human_approval_gate", approvalId, ++seq);
  return { proposal, approvalToken: signApproval(proposal, process.env.APPROVAL_SECRET), model: drafted.model };
}

async function approve(token, selectedSlotIndex) {
  const proposal = verifyApproval(token, process.env.APPROVAL_SECRET);
  const index = Number(selectedSlotIndex);
  const slot = proposal.slots[index];
  if (!Number.isInteger(index) || !slot) throw new Error("Select one of the signed proposed slots.");
  const accessToken = await googleAccessToken();
  let seq = 100;
  audit(proposal.runId, "gate_resolved", "human_approval_gate", `approved:${proposal.approvalId}`, ++seq);

  const eventId = `okit${createHash("sha256").update(proposal.approvalId).digest("hex").slice(0, 32)}`;
  audit(proposal.runId, "step_started", "calendar_write", eventId, ++seq);
  let event;
  try {
    event = await googleJson(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          id: eventId,
          summary: proposal.eventTitle,
          description: `Created after explicit approval ${proposal.approvalId}. Source email: ${proposal.message.subject}`,
          start: { dateTime: slot.start, timeZone: proposal.timeZone },
          end: { dateTime: slot.end, timeZone: proposal.timeZone },
          attendees: [{ email: proposal.message.fromEmail }],
          extendedProperties: { private: { orchestratekitApprovalId: proposal.approvalId } },
        }),
      },
    );
  } catch (error) {
    if (error.statusCode !== 409) throw error;
    event = await googleJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, accessToken);
  }
  audit(proposal.runId, "step_completed", "calendar_write", event.htmlLink ?? event.id, ++seq);

  audit(proposal.runId, "step_started", "optional_email_send", "draft-only", ++seq);
  const draftMessageId = `<${proposal.approvalId}@orchestratekit.local>`;
  const existing = await googleJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`in:drafts rfc822msgid:${draftMessageId}`)}&maxResults=1`,
    accessToken,
  );
  let draftId = existing.messages?.[0]?.id;
  if (!draftId) {
    const created = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts", accessToken, {
      method: "POST",
      body: JSON.stringify({
        message: {
          threadId: proposal.message.threadId,
          raw: encodeRawEmail({ ...proposal.draft, messageId: proposal.message.messageId, approvalId: proposal.approvalId }),
        },
      }),
    });
    draftId = created.id;
  }
  audit(proposal.runId, "step_completed", "optional_email_send", `gmail-draft:${draftId}`, ++seq);
  audit(proposal.runId, "run_completed", "audit_log", `calendar=${event.id};draft=${draftId}`, ++seq);
  return { runId: proposal.runId, event: { id: event.id, htmlLink: event.htmlLink, start: event.start }, draft: { id: draftId }, labOptional: Boolean(process.env.DASH_INGEST_URL && process.env.DASH_INGEST_TOKEN) };
}

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      return send(response, 200, {
        ok: true,
        agent: AGENT,
        configured: {
          google: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN),
          openrouter: Boolean(process.env.OPENROUTER_API_KEY),
          approval: Boolean(process.env.APPROVAL_SECRET && process.env.APP_ACCESS_TOKEN),
          labOptional: Boolean(process.env.DASH_INGEST_URL && process.env.DASH_INGEST_TOKEN),
        },
      });
    }
    authorize(request);
    const operation = request.query?.operation ?? request.url?.split("/").pop()?.split("?")[0];
    if (request.method === "POST" && operation === "scan") return send(response, 200, await scanInbox());
    if (request.method === "POST" && operation === "approve") {
      return send(response, 200, await approve(request.body?.approvalToken, request.body?.selectedSlotIndex));
    }
    return send(response, 404, { error: "Use POST /api/scan or POST /api/approve." });
  } catch (error) {
    console.error(JSON.stringify({ kind: "orchestratekit_error", message: error.message, stack: error.stack }));
    return send(response, error.statusCode ?? 500, { error: error.message });
  }
}
