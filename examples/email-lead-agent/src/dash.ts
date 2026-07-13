import { appendJsonLine, PATHS } from "./runtimePaths.js";

// §9 Observability wiring from the build brief: emit run_started, step_started,
// step_completed, gate_requested, gate_resolved, run_completed, run_failed to
// DASH via DASH_INGEST_URL/DASH_INGEST_TOKEN. No DASH instance is configured in
// this environment, so this fire-and-forget emitter falls back to appending
// the same event shape to runtime/dash_events.jsonl — same contract, no import
// step required to inspect it locally, and it upgrades to a real POST the
// moment the two env vars are set. Never throws: a DASH outage must not break
// the agent run.
export type DashEventType =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "gate_requested"
  | "gate_resolved"
  | "run_completed"
  | "run_failed";

// Telemetry contract v1 (LAB/DASH contracts/run-event.schema.json):
// event_version + agent + type are REQUIRED — events missing them are
// rejected 400 by LAB's /api/events. Found live during the MAR-363 rehearsal
// (the old shape used `event` and omitted both, and the fire-and-forget
// emitter swallowed the rejections silently).
export interface DashEvent {
  event_version: 1;
  agent: string;
  run_id: string;
  seq: number;
  ts: string;
  type: DashEventType;
  component_id?: string;
  detail?: string;
}

const AGENT_NAME = "email-lead-crm-slack-agent"; // agent.manifest.json agent.name

let seqCounter = 0;

export function buildDashEvent(
  runId: string,
  event: DashEventType,
  seq: number,
  componentId?: string,
  detail?: string,
  ts = new Date().toISOString(),
): DashEvent {
  return {
    event_version: 1,
    agent: AGENT_NAME,
    run_id: runId,
    seq,
    ts,
    type: event,
    component_id: componentId,
    detail,
  };
}

export async function emitDashEvent(
  runId: string,
  event: DashEventType,
  componentId?: string,
  detail?: string
): Promise<void> {
  const payload = buildDashEvent(
    runId,
    event,
    ++seqCounter,
    componentId,
    detail,
  );

  const endpoint = process.env.DASH_INGEST_URL;
  const token = process.env.DASH_INGEST_TOKEN;

  try {
    if (endpoint && token) {
      const res = await fetch(`${endpoint}/api/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Still non-fatal, but never silent — a rejected event means the
        // /agents view is missing data and someone should know why.
        console.warn(`[dash] ingest rejected ${payload.type} (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
    } else {
      appendJsonLine(PATHS.dashEvents, payload);
    }
  } catch (err) {
    // Non-fatal by contract — log and move on.
    console.warn(`[dash] emit failed (non-fatal): ${(err as Error).message}`);
  }
}
