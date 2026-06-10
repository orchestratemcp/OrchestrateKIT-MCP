import { z } from "zod";
import { SourceSchema, ENTITY_STATUSES } from "./sharedSchemas.js";

const StackChoiceSchema = z.object({
  recommended: z.union([z.string(), z.array(z.string())]),
  alternatives: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

export const StackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(ENTITY_STATUSES),
  summary: z.string().min(1),
  best_for: z.array(z.string()).default([]),
  avoid_when: z.array(z.string()).default([]),
  choices: z.record(z.string(), StackChoiceSchema).default({}),
  tradeoffs: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export type Stack = z.infer<typeof StackSchema>;
