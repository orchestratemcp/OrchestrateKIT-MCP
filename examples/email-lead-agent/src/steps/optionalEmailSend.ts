import type { DraftReply } from "../types.js";
import { appendJsonLine, PATHS } from "../runtimePaths.js";

// Route step 8 (optional_email_send) — high risk, only reachable after
// human_approval_gate returns "approved".
//
// This step is deliberately draft-only for v1, per the plan's own
// recommendation ("Optionally send the approved email; v1 should probably
// stay draft-only"). It does NOT check for Gmail send credentials and send
// live even if they exist — that's a conscious policy choice, not a
// credential gap, and should be revisited explicitly (not silently) before
// this route is allowed to send mail on its own.
export function queueOutboundDraft(draft: DraftReply): { queued: true } {
  console.warn("[DRAFT-ONLY] optional_email_send: policy is draft-only for v1 — queuing, not sending.");
  appendJsonLine(PATHS.outboundDrafts, { ...draft, queuedAt: new Date().toISOString() });
  return { queued: true };
}
