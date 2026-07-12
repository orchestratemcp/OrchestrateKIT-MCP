export interface RawEmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
}

export interface Lead {
  emailId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
}

export interface IntentResult {
  intent: "sales_lead" | "not_a_lead";
  confidence: number;
  reason: string;
}

export interface DraftReply {
  to: string;
  subject: string;
  bodyText: string;
  generatedBy: "template" | "llm";
}

export type ApprovalStatus = "approved" | "rejected" | "timed_out";

export interface ApprovalDecision {
  runId: string;
  gate: "human_approval_gate";
  emailId: string;
  decision: ApprovalStatus;
  reviewer: string;
  decidedAt: string;
  notes?: string;
}

export interface StepResult<T = unknown> {
  runId: string;
  componentId: string;
  step: number;
  status: "success" | "skipped" | "failed";
  output?: T;
  errorMessage?: string;
}

export interface AuditEvent {
  runId: string;
  componentId: string;
  eventType: string;
  timestamp: string;
  detail: string;
  actor: string;
}

export interface RunContext {
  runId: string;
  startedAt: string;
  dryRun: boolean;
  autoApprove: boolean;
}
