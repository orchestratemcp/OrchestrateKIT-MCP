import type { Lead } from "../types.js";
import { appendJsonLine, PATHS } from "../runtimePaths.js";

// Route step 6 (slack_notification) — high risk, only reachable after
// human_approval_gate returns "approved".
//
// REAL vs STUB: if SLACK_WEBHOOK_URL is set, posts a real message. No
// webhook was configured in this environment, so it appends to
// runtime/slack_outbox.jsonl instead and logs to the console.
export async function notifySlack(lead: Lead, reviewer: string): Promise<{ delivered: boolean; via: "webhook" | "stub" }> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const text = `:email: New approved lead: *${lead.fromName}* <mailto:${lead.fromEmail}|${lead.fromEmail}> — "${lead.subject}" (approved by ${reviewer})`;

  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook POST failed: ${res.status} ${await res.text()}`);
    }
    return { delivered: true, via: "webhook" };
  }

  console.warn("[DRY-RUN] slack_notification: no SLACK_WEBHOOK_URL — writing to runtime/slack_outbox.jsonl instead.");
  appendJsonLine(PATHS.slackOutbox, { emailId: lead.emailId, text, sentAt: new Date().toISOString() });
  return { delivered: false, via: "stub" };
}
