import { z } from "zod";
import { SourceSchema, ENTITY_STATUSES, RISK_LEVELS } from "./sharedSchemas.js";

export const EDGE_RELATIONS = [
  "requires",
  "compatible_with",
  "conflicts_with",
  "alternative_to",
  "safer_with",
  "tested_with",
  "produces_input_for",
  "consumes_output_from",
  "must_run_before",
  "can_run_parallel",
  "requires_human_approval_when",
  "recommended_for",
  "avoid_when",
] as const;

export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

export const EdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(EDGE_RELATIONS),
  status: z.enum(ENTITY_STATUSES),
  reason: z.string().min(1),
  condition: z.string().default(""),
  severity: z.enum(RISK_LEVELS),
  tested: z.boolean().default(false),
  test_refs: z.array(z.string()).default([]),
  failure_modes: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export type Edge = z.infer<typeof EdgeSchema>;
