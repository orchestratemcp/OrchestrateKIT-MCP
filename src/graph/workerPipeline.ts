/**
 * Worker pipeline composition (MAR-166).
 *
 * Given the worker registry, derive the multi-worker BUILD pipeline that would
 * implement a planned workflow in the user's own runtime: planner → coder →
 * reviewer → tester, threaded with the handoff contracts each worker declares.
 *
 * This is advisory-only, exactly like every other OrchestrateMCP output. We
 * recommend WHO builds and in WHAT order with WHAT contract; we never run them.
 * `plan_workflow` calls this and attaches the result to its plan.
 *
 * Determinism: ordering is by a fixed role rank (not the goal), so the same
 * worker set always yields the same pipeline. `handoff_to` edges supply the
 * contracts — a forward edge (to a later-ranked worker) is a pipeline handoff;
 * a backward edge (e.g. tester → coder) is a fix/feedback loop, surfaced
 * separately rather than corrupting the linear order.
 */
import type { Worker, WorkerRole } from "../registry/workerSchema.js";
import type { ModelTier } from "../registry/componentSchema.js";

/** Fixed pipeline rank per role. Lower runs earlier. */
const ROLE_ORDER: Record<WorkerRole, number> = {
  planner: 0,
  researcher: 1,
  coder: 2,
  reviewer: 3,
  tester: 4,
  operator: 5,
};

export type WorkerPipelineStep = {
  step: number;
  worker_id: string;
  role: WorkerRole;
  title: string;
  model_tier: ModelTier;
  inputs: string[];
  outputs: string[];
  allowed_tools: string[];
  forbidden_tools: string[];
  quality_gates: string[];
  hands_off_to: string[];
};

export type WorkerHandoff = {
  from: string;
  to: string;
  /** The handoff contract — producing worker's outputs feed the consumer. */
  contract: string;
};

export type WorkerPipeline = {
  /** Ordered build team, planner-first. */
  workers: WorkerPipelineStep[];
  /** Forward handoffs (producer → later consumer), in pipeline order. */
  handoffs: WorkerHandoff[];
  /** Backward handoffs — fix/feedback loops (e.g. tester → coder). */
  feedback_loops: WorkerHandoff[];
};

function rankOf(role: WorkerRole): number {
  return ROLE_ORDER[role] ?? 99;
}

/**
 * Compose the worker build pipeline from the available workers. Returns an
 * empty pipeline (no workers) when the registry has none, so callers can always
 * include the field unconditionally.
 */
export function composeWorkerPipeline(workers: Worker[]): WorkerPipeline {
  const ordered = [...workers].sort((a, b) => {
    const r = rankOf(a.role) - rankOf(b.role);
    return r !== 0 ? r : a.id.localeCompare(b.id);
  });

  const ids = new Set(ordered.map((w) => w.id));
  const rank = new Map(ordered.map((w, i) => [w.id, i]));

  const steps: WorkerPipelineStep[] = ordered.map((w, i) => ({
    step: i + 1,
    worker_id: w.id,
    role: w.role,
    title: w.title,
    model_tier: w.model_tier,
    inputs: w.inputs,
    outputs: w.outputs,
    allowed_tools: w.allowed_tools,
    forbidden_tools: w.forbidden_tools,
    quality_gates: w.quality_gates,
    hands_off_to: w.handoff_to,
  }));

  const handoffs: WorkerHandoff[] = [];
  const feedback_loops: WorkerHandoff[] = [];

  for (const w of ordered) {
    for (const target of w.handoff_to) {
      if (!ids.has(target)) continue; // unknown ids already flagged by lint
      const edge: WorkerHandoff = {
        from: w.id,
        to: target,
        contract: `${w.id}.outputs → ${target}.inputs`,
      };
      const later = (rank.get(target) ?? 0) > (rank.get(w.id) ?? 0);
      (later ? handoffs : feedback_loops).push(edge);
    }
  }

  return { workers: steps, handoffs, feedback_loops };
}
