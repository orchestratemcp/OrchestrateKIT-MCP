import { z } from "zod";
import { SourceSchema, ENTITY_STATUSES, RISK_LEVELS } from "./sharedSchemas.js";

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
});

export type Component = z.infer<typeof ComponentSchema>;
