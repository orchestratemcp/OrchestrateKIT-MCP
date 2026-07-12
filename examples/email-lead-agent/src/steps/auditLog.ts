import type { AuditEvent } from "../types.js";
import { appendJsonLine, PATHS } from "../runtimePaths.js";

// Route step 9 (audit_log). Also called by every other step to record
// start/completion/failure — the registry route treats audit_log as the
// terminal step, but "record every sensitive or external action" only
// works if earlier steps emit into the same log as they run.
export function recordAuditEvent(event: Omit<AuditEvent, "timestamp">): AuditEvent {
  const full: AuditEvent = { ...event, timestamp: new Date().toISOString() };
  appendJsonLine(PATHS.auditLog, full);
  return full;
}
