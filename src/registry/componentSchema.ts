import { z } from "zod";
import { SourceSchema, ENTITY_STATUSES, RISK_LEVELS } from "./sharedSchemas.js";

/** LLM tier required to run this component. "none" = deterministic / no LLM. */
export const MODEL_TIERS = ["none", "small", "standard", "frontier"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** How much context window this component typically consumes at runtime. */
export const CONTEXT_NEEDS = ["minimal", "moderate", "large", "full"] as const;
export type ContextNeed = (typeof CONTEXT_NEEDS)[number];

/** Strategy for reducing context when window limits are approached. */
export const COMPRESSION_STRATEGIES = [
  "none",
  "truncate",
  "summarise",
  "chunk",
  "rank_and_drop",
] as const;
export type CompressionStrategy = (typeof COMPRESSION_STRATEGIES)[number];

export const COMPONENT_CATEGORIES = [
  "input",
  "processing",
  "state",
  "safety",
  "tool",
  "output",
  "eval",
  "orchestration",
  "integration",
] as const;

const PermissionsSchema = z.object({
  read: z.array(z.string()).default([]),
  write: z.array(z.string()).default([]),
  approval_required_for: z.array(z.string()).default([]),
});

export const ComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(ENTITY_STATUSES),
  category: z.enum(COMPONENT_CATEGORIES),
  summary: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  risk_level: z.enum(RISK_LEVELS),
  side_effects: z.array(z.string()).default([]),
  permissions: PermissionsSchema.default({ read: [], write: [], approval_required_for: [] }),
  requires: z.array(z.string()).default([]),
  recommended_with: z.array(z.string()).default([]),
  avoid_with: z.array(z.string()).default([]),
  failure_modes: z.array(z.string()).default([]),
  evals: z.array(z.string()).default([]),
  tested_in_playbooks: z.array(z.string()).default([]),
  tested_in_routes: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
  /** LLM tier this component typically requires. "none" = fully deterministic. */
  model_tier: z.enum(MODEL_TIERS).default("none"),
  /** Tier to fall back to when the primary tier is unavailable or over budget. */
  fallback_tier: z.enum(MODEL_TIERS).default("none"),
  /** Approximate context window demand at runtime. */
  context_need: z.enum(CONTEXT_NEEDS).default("minimal"),
  /** How to reduce context when the window limit is approached. */
  compression_strategy: z.enum(COMPRESSION_STRATEGIES).default("none"),
});

export type Component = z.infer<typeof ComponentSchema>;
