import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { readNewLeads } from "./steps/emailRead.js";
import { validateLead } from "./steps/schemaValidation.js";
import { classifyIntent } from "./steps/intentClassifier.js";
import { draftReply } from "./steps/emailDraft.js";
import { requestApproval } from "./steps/humanApprovalGate.js";
import { notifySlack } from "./steps/slackNotification.js";
import { writeCrmNote } from "./steps/crmNoteWrite.js";
import { queueOutboundDraft } from "./steps/optionalEmailSend.js";
import { recordAuditEvent } from "./steps/auditLog.js";
import { emitDashEvent } from "./dash.js";
import { PATHS, readJsonArray, writeJson } from "./runtimePaths.js";

const AUTO_APPROVE = process.argv.includes("--auto-approve") || process.env.AUTO_APPROVE === "1";

async function main(): Promise<void> {
  const runId = randomUUID();
  const startedAt = Date.now();

  console.log(`=== email-lead-to-crm run ${runId} ===`);
  console.log(`auto-approve: ${AUTO_APPROVE}\n`);

  await emitDashEvent(runId, "run_started");
  recordAuditEvent({ runId, componentId: "run", eventType: "run_started", detail: `autoApprove=${AUTO_APPROVE}`, actor: "system" });

  if (fs.existsSync(PATHS.killSwitch)) {
    console.error(`KILL SWITCH engaged (${PATHS.killSwitch} exists) — aborting before any step runs.`);
    recordAuditEvent({ runId, componentId: "run", eventType: "run_aborted_kill_switch", detail: "kill switch file present", actor: "system" });
    await emitDashEvent(runId, "run_failed", undefined, "kill_switch");
    process.exitCode = 1;
    return;
  }

  const processedIds = new Set(readJsonArray<string>(PATHS.processedIds));
  const effectIds = new Set(readJsonArray<string>(PATHS.effectIds));
  const summary = { total: 0, notLeads: 0, alreadyProcessed: 0, approved: 0, rejected: 0, failed: 0 };

  try {
    // Step 1: email_read
    await emitDashEvent(runId, "step_started", "email_read");
    const rawMessages = readNewLeads();
    summary.total = rawMessages.length;
    recordAuditEvent({ runId, componentId: "email_read", eventType: "step_completed", detail: `${rawMessages.length} message(s) read`, actor: "system" });
    await emitDashEvent(runId, "step_completed", "email_read", `${rawMessages.length} messages`);

    for (const raw of rawMessages) {
      console.log(`\n--- processing ${raw.id}: "${raw.subject}" ---`);

      if (processedIds.has(raw.id)) {
        console.log(`already processed in a prior run — skipping (idempotency).`);
        summary.alreadyProcessed++;
        recordAuditEvent({ runId, componentId: "run", eventType: "step_skipped_idempotent", detail: raw.id, actor: "system" });
        continue;
      }

      // Step 2: schema_validation
      await emitDashEvent(runId, "step_started", "schema_validation", raw.id);
      const validation = validateLead(raw);
      if (!validation.valid || !validation.lead) {
        console.warn(`schema_validation rejected ${raw.id}: ${validation.errorMessage}`);
        recordAuditEvent({ runId, componentId: "schema_validation", eventType: "step_failed", detail: validation.errorMessage ?? "invalid", actor: "system" });
        await emitDashEvent(runId, "step_completed", "schema_validation", "rejected");
        summary.failed++;
        continue;
      }
      const lead = validation.lead;
      recordAuditEvent({ runId, componentId: "schema_validation", eventType: "step_completed", detail: lead.emailId, actor: "system" });
      await emitDashEvent(runId, "step_completed", "schema_validation", lead.emailId);

      // Step 3: intent_classifier
      await emitDashEvent(runId, "step_started", "intent_classifier", lead.emailId);
      const intent = classifyIntent(lead);
      recordAuditEvent({ runId, componentId: "intent_classifier", eventType: "step_completed", detail: `${intent.intent} (${intent.confidence})`, actor: "system" });
      await emitDashEvent(runId, "step_completed", "intent_classifier", intent.intent);

      if (intent.intent !== "sales_lead") {
        console.log(`classified as "${intent.intent}" (${intent.reason}) — not a lead, routing to audit log only.`);
        summary.notLeads++;
        recordAuditEvent({ runId, componentId: "run", eventType: "not_a_lead", detail: intent.reason, actor: "system" });
        markProcessed(processedIds, raw.id);
        continue;
      }

      // Step 4: email_draft
      await emitDashEvent(runId, "step_started", "email_draft", lead.emailId);
      const draft = await draftReply(lead);
      recordAuditEvent({ runId, componentId: "email_draft", eventType: "step_completed", detail: `generatedBy=${draft.generatedBy}`, actor: "system" });
      await emitDashEvent(runId, "step_completed", "email_draft", draft.generatedBy);

      // Step 5: human_approval_gate
      await emitDashEvent(runId, "gate_requested", "human_approval_gate", lead.emailId);
      recordAuditEvent({ runId, componentId: "human_approval_gate", eventType: "gate_requested", detail: lead.emailId, actor: "system" });
      const approval = await requestApproval(runId, lead, draft, { autoApprove: AUTO_APPROVE });
      recordAuditEvent({
        runId,
        componentId: "human_approval_gate",
        eventType: "gate_resolved",
        detail: `${approval.decision} by ${approval.reviewer}`,
        actor: approval.reviewer,
      });
      await emitDashEvent(runId, "gate_resolved", "human_approval_gate", approval.decision);

      if (approval.decision !== "approved") {
        console.log(`approval gate: ${approval.decision} — stopping before any irreversible step.`);
        summary.rejected++;
        markProcessed(processedIds, raw.id);
        continue;
      }
      summary.approved++;

      const downstream = [
        {
          componentId: "slack_notification",
          run: async () => {
            const slackResult = await notifySlack(lead, approval.reviewer);
            return `via=${slackResult.via}`;
          },
        },
        {
          componentId: "crm_note_write",
          run: async () => {
            const note = writeCrmNote(lead, `Inbound lead reply drafted and approved. Subject: ${draft.subject}`);
            return note.emailId;
          },
        },
        {
          componentId: "optional_email_send",
          run: async () => {
            queueOutboundDraft(draft);
            return "queued draft-only";
          },
        },
      ] as const;

      let downstreamFailed = false;
      for (const step of downstream) {
        const effectKey = `${lead.emailId}:${step.componentId}`;
        if (effectIds.has(effectKey)) {
          console.log(`${step.componentId} already completed in a prior run - skipping duplicate effect.`);
          recordAuditEvent({ runId, componentId: step.componentId, eventType: "step_skipped_idempotent", detail: effectKey, actor: "system" });
          await emitDashEvent(runId, "step_completed", step.componentId, "idempotent-skip");
          continue;
        }

        try {
          await emitDashEvent(runId, "step_started", step.componentId, lead.emailId);
          const detail = await step.run();
          recordAuditEvent({ runId, componentId: step.componentId, eventType: "step_completed", detail, actor: "system" });
          await emitDashEvent(runId, "step_completed", step.componentId, detail);
          markEffect(effectIds, effectKey);
        } catch (err) {
          downstreamFailed = true;
          recordAuditEvent({ runId, componentId: step.componentId, eventType: "step_failed", detail: (err as Error).message, actor: "system" });
          await emitDashEvent(runId, "run_failed", step.componentId, (err as Error).message);
          console.error(`${step.componentId} failed: ${(err as Error).message}`);
        }
      }

      if (downstreamFailed) {
        summary.failed++;
      } else {
        markProcessed(processedIds, raw.id);
      }
    }

    recordAuditEvent({ runId, componentId: "audit_log", eventType: "run_completed", detail: JSON.stringify(summary), actor: "system" });
    await emitDashEvent(runId, "run_completed", undefined, JSON.stringify(summary));
  } catch (err) {
    recordAuditEvent({ runId, componentId: "run", eventType: "run_failed", detail: (err as Error).message, actor: "system" });
    await emitDashEvent(runId, "run_failed", undefined, (err as Error).message);
    console.error(`\nrun failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`\n=== run ${runId} summary ===`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`elapsed: ${elapsedMs}ms`);
  console.log(`audit log:   ${PATHS.auditLog}`);
  console.log(`crm notes:   ${PATHS.crmNotes}`);
  console.log(`slack outbox:${PATHS.slackOutbox}`);
}

function markProcessed(set: Set<string>, id: string): void {
  set.add(id);
  writeJson(PATHS.processedIds, Array.from(set));
}

function markEffect(set: Set<string>, id: string): void {
  set.add(id);
  writeJson(PATHS.effectIds, Array.from(set));
}

main();
