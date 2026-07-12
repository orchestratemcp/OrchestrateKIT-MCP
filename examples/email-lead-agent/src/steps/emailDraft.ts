import type { DraftReply, Lead } from "../types.js";

// Route step 4 (email_draft). Registry model tier: "standard LLM".
//
// REAL vs STUB: if ANTHROPIC_API_KEY is set, this calls the Claude API for a
// real generated draft. No key was present in this environment, so it falls
// back to a deterministic template — good enough to exercise the approval
// gate and downstream steps, not good enough to actually send.
export async function draftReply(lead: Lead): Promise<DraftReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return draftWithClaude(lead, apiKey);
  }

  console.warn("[STUB] email_draft: no ANTHROPIC_API_KEY — using a fixed template instead of an LLM draft.");
  return {
    to: lead.fromEmail,
    subject: `Re: ${lead.subject}`,
    bodyText:
      `Hi ${lead.fromName.split(" ")[0] || "there"},\n\n` +
      `Thanks for reaching out about OrchestrateKit — happy to help.\n\n` +
      `Could you share a bit more about your team size and timeline so I can point you at the right ` +
      `plan and, if useful, get a demo on the calendar this week?\n\n` +
      `Best,\nSales`,
    generatedBy: "template",
  };
}

async function draftWithClaude(lead: Lead, apiKey: string): Promise<DraftReply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content:
            `Draft a short, friendly sales reply to this inbound lead email. ` +
            `Return only the reply body text, no subject line, no preamble.\n\n` +
            `From: ${lead.fromName} <${lead.fromEmail}>\nSubject: ${lead.subject}\nBody: ${lead.bodyText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API draft failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";

  return {
    to: lead.fromEmail,
    subject: `Re: ${lead.subject}`,
    bodyText: text,
    generatedBy: "llm",
  };
}
