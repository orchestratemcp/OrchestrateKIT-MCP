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
  sources: z.array(SourceSchema).default([]),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
