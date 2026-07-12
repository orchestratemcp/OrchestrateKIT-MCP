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

export interface DashEvent {
  run_id: string;
  seq: number;
  ts: string;
  event: DashEventType;
  component_id?: string;
  detail?: string;
}

let seqCounter = 0;

export async function emitDashEvent(
  runId: string,
  event: DashEventType,
  componentId?: string,
  detail?: string
): Promise<void> {
  const payload: DashEvent = {
    run_id: runId,
    seq: ++seqCounter,
    ts: new Date().toISOString(),
    event,
    component_id: componentId,
    detail,
  };

  const endpoint = process.env.DASH_INGEST_URL;
  const token = process.env.DASH_INGEST_TOKEN;

  try {
    if (endpoint && token) {
      await fetch(`${endpoint}/api/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } else {
      appendJsonLine(PATHS.dashEvents, payload);
    }
  } catch (err) {
    // Non-fatal by contract — log and move on.
    console.warn(`[dash] emit failed (non-fatal): ${(err as Error).message}`);
  }
}
