import { z } from "zod";
import { SourceSchema, ENTITY_STATUSES } from "./sharedSchemas.js";
import { MODEL_TIERS } from "./componentSchema.js";

/**
 * Worker playbooks (MAR-166).
 *
 * A worker is a SPECIALIST AGENT with a safe contract — NOT a "swarm". Each
 * worker declares the role it plays in a build pipeline (planner → coder →
 * reviewer → tester), the handoff contract (inputs/outputs), the tools it may
 * and may not use (a planner is forbidden from write tools; a reviewer never
 * mutates the tree), which workers it can hand off to, its cost tier, the
 * quality gates it must satisfy, and the evals that check it.
 *
 * This is advisory data, exactly like components/edges/playbooks: OrchestrateMCP
 * RECOMMENDS a worker pipeline for building a planned workflow. It never runs
 * one. `plan_workflow` composes these into a multi-worker pipeline.
 */
export const WORKER_ROLES = [
  "planner",
  "coder",
  "reviewer",
  "tester",
  "researcher",
  "operator",
] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export const WorkerSchema = z.object({
  id: z.string().min(1),
  version: z.string(),
  status: z.enum(ENTITY_STATUSES),
  title: z.string().min(1),
  role: z.enum(WORKER_ROLES),
  summary: z.string().min(1),
  /** Goals/situations this worker is the right specialist for. */
  best_for: z.array(z.string()).default([]),
  /** Handoff contract: what this worker consumes from the previous worker. */
  inputs: z.array(z.string()).default([]),
  /** Handoff contract: what this worker produces for the next worker. */
  outputs: z.array(z.string()).default([]),
  /** Tool capabilities this worker MAY use. */
  allowed_tools: z.array(z.string()).default([]),
  /** Tool capabilities this worker MUST NOT use (e.g. planner ⊅ write tools). */
  forbidden_tools: z.array(z.string()).default([]),
  /** Worker ids this worker may hand control to (forward step or fix-loop). */
  handoff_to: z.array(z.string()).default([]),
  /** Cost profile — the cheapest model tier that can do this role well. */
  model_tier: z.enum(MODEL_TIERS).default("standard"),
  /** Contract invariants this worker must satisfy on every run. */
  quality_gates: z.array(z.string()).default([]),
  /** Checks that verify the worker honours its contract. */
  evals: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export type Worker = z.infer<typeof WorkerSchema>;

/**
 * Substrings that mark a tool as state-mutating / irreversible. Read-only
 * roles (planner, reviewer, tester) must keep all such tools in
 * `forbidden_tools` and out of `allowed_tools`. Used by the registry lint and
 * the per-worker contract probes (MAR-166 acceptance).
 */
export const WRITE_TOOL_MARKERS = [
  "write",
  "commit",
  "push",
  "publish",
  "deploy",
  "send",
  "delete",
  "merge",
] as const;

/** True when a tool name denotes a state-mutating / irreversible action. */
export function isWriteTool(toolName: string): boolean {
  const t = toolName.toLowerCase();
  return WRITE_TOOL_MARKERS.some((m) => t.includes(m));
}

/**
 * Roles that must never hold a write tool. The planner only reads + reasons,
 * the reviewer only inspects, the tester only runs the suite — none of them
 * edit source or ship. The coder (and a future operator) is the only role
 * allowed to mutate.
 */
export const READ_ONLY_ROLES: ReadonlySet<WorkerRole> = new Set<WorkerRole>([
  "planner",
  "reviewer",
  "tester",
]);
