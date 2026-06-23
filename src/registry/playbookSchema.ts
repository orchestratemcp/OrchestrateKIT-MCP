import { z } from "zod";
import { SourceSchema, RISK_LEVELS } from "./sharedSchemas.js";

export const PLAYBOOK_STATUSES = [
  "draft",
  "candidate",
  "beta",
  "validated",
  "published",
  "deprecated",
] as const;

const RecommendedArchitectureSchema = z.object({
  pattern: z.string(),
  why: z.string(),
});

/**
 * Advisory loop contract (MAR-167) for a bounded, reviewer-independent
 * worker-loop playbook. OrchestrateMCP helps DESIGN this safely — it never runs
 * the loop. The contract is the framework-agnostic spec a builder exports to
 * Cowork / LangGraph / CrewAI; the graph itself stays DAG-only (these are
 * control-flow annotations, not cyclic edges).
 *
 * Every field is required WHEN a loop_contract is present — a loop without a
 * termination bound or a final gate is exactly the unsafe pattern this guards
 * against. The lint gate (registryLint) enforces the guardrails on any playbook
 * that declares one.
 */
export const LoopContractSchema = z.object({
  /** Hard upper bound on loop iterations — required; an unbounded loop is unsafe. */
  max_iterations: z.number().int().positive(),
  /** When the loop is allowed to stop (e.g. "reviewer_status == approved"). */
  stop_condition: z.string().min(1),
  /** When to break out to a human (iteration cap OR repeated failure). */
  escalation_condition: z.string().min(1),
  /** Loop state must be persisted between iterations. */
  state_required: z.literal(true),
  /** Every iteration must be audit-logged. */
  audit_required: z.literal(true),
  /** Action classes that require a human gate before they run. */
  human_gate_required_for: z.array(z.string()).min(1),
  /** Reviewer worker must be a different agent than the planner/coder. */
  reviewer_independent: z.literal(true),
  /** No external write / deploy / send / publish until the final approval gate. */
  no_write_until_final_gate: z.literal(true),
});

export type LoopContract = z.infer<typeof LoopContractSchema>;

export const PlaybookSchema = z.object({
  id: z.string().min(1),
  version: z.string(),
  status: z.enum(PLAYBOOK_STATUSES),
  title: z.string().min(1),
  summary: z.string().min(1),
  workflow_type: z.string(),
  golden_path_route_id: z.string(),
  components: z.array(z.string()).default([]),
  edges: z.array(z.string()).default([]),
  stack_id: z.string(),
  risk_level: z.enum(RISK_LEVELS),
  best_for: z.array(z.string()).default([]),
  avoid_when: z.array(z.string()).default([]),
  recommended_architecture: RecommendedArchitectureSchema.optional(),
  llm_driven_steps: z.array(z.string()).default([]),
  deterministic_steps: z.array(z.string()).default([]),
  permissions: z.record(z.string(), z.unknown()).default({}),
  guardrails: z.array(z.string()).default([]),
  failure_modes: z.array(z.string()).default([]),
  evals: z.array(z.string()).default([]),
  implementation_steps: z.array(z.string()).default([]),
  /**
   * Ordered worker ids forming the loop body (MAR-167) — references the worker
   * registry (registry/workers/*). Optional (no default) so the committed
   * bundle placeholder typechecks without regen; cross-ref validation checks
   * the ids exist.
   */
  worker_sequence: z.array(z.string()).optional(),
  /** Advisory bounded-loop contract (MAR-167). Present only on loop playbooks. */
  loop_contract: LoopContractSchema.optional(),
  sources: z.array(SourceSchema).default([]),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
