import type { IntentResult, Lead } from "../types.js";

// Route step 3 (intent_classifier). Registry model tier: "small LLM".
//
// STUB: this is a deterministic keyword heuristic, not a model call — no
// ANTHROPIC_API_KEY was present at build time. It exists so the rest of the
// route (draft -> approval -> CRM/Slack) has something real to run against.
// Swap classify() for a small-model call before relying on this for
// anything beyond a demo; keyword matching will misclassify short or
// non-English leads.
const LEAD_SIGNALS = [
  "pricing",
  "quote",
  "demo",
  "trial",
  "budget",
  "proposal",
  "rollout",
  "seats",
  "integration",
  "call",
];
const NOISE_SIGNALS = ["unsubscribe", "newsletter", "roundup", "no-reply"];

export function classifyIntent(lead: Lead): IntentResult {
  const haystack = `${lead.subject} ${lead.bodyText} ${lead.fromEmail}`.toLowerCase();

  const noiseHits = NOISE_SIGNALS.filter((s) => haystack.includes(s));
  if (noiseHits.length > 0) {
    return {
      intent: "not_a_lead",
      confidence: 0.8,
      reason: `matched noise signal(s): ${noiseHits.join(", ")}`,
    };
  }

  const leadHits = LEAD_SIGNALS.filter((s) => haystack.includes(s));
  if (leadHits.length > 0) {
    return {
      intent: "sales_lead",
      confidence: Math.min(0.5 + leadHits.length * 0.15, 0.95),
      reason: `matched lead signal(s): ${leadHits.join(", ")}`,
    };
  }

  return { intent: "not_a_lead", confidence: 0.55, reason: "no lead or noise signals matched" };
}
