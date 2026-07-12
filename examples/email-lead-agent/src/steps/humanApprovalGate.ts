import readline from "node:readline/promises";
import type { ApprovalDecision, DraftReply, Lead } from "../types.js";

// Route step 5 (human_approval_gate) — the one enforced gate in this plan.
// Nothing after this step (slack_notification, crm_note_write,
// optional_email_send) may run without an "approved" decision recorded here.
//
// Modes:
// - interactive TTY: prompts y/n on stdin.
// - --auto-approve flag / AUTO_APPROVE=1 env: approves without prompting,
//   for CI/demo runs. Never the default — approval must be opted into.
// - anything else (non-TTY, no auto-approve): rejects closed, safe default.
export async function requestApproval(
  runId: string,
  lead: Lead,
  draft: DraftReply,
  opts: { autoApprove: boolean }
): Promise<ApprovalDecision> {
  const decidedAt = () => new Date().toISOString();

  if (opts.autoApprove) {
    return {
      runId,
      gate: "human_approval_gate",
      emailId: lead.emailId,
      decision: "approved",
      reviewer: "auto-approve-flag",
      decidedAt: decidedAt(),
      notes: "Approved via --auto-approve / AUTO_APPROVE=1 (demo/CI mode).",
    };
  }

  if (!process.stdin.isTTY) {
    return {
      runId,
      gate: "human_approval_gate",
      emailId: lead.emailId,
      decision: "rejected",
      reviewer: "system",
      decidedAt: decidedAt(),
      notes: "No TTY and no --auto-approve — rejecting closed rather than running unattended.",
    };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n--- Approval requested for lead ${lead.emailId} (${lead.fromEmail}) ---`);
  console.log(`Subject: ${draft.subject}`);
  console.log(`Body:\n${draft.bodyText}\n`);
  const answer = (await rl.question("Approve CRM write + Slack alert for this lead? [y/N] ")).trim().toLowerCase();
  rl.close();

  return {
    runId,
    gate: "human_approval_gate",
    emailId: lead.emailId,
    decision: answer === "y" || answer === "yes" ? "approved" : "rejected",
    reviewer: "interactive-operator",
    decidedAt: decidedAt(),
  };
}
