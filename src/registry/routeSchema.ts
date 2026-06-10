import { z } from "zod";
import { RISK_LEVELS } from "./sharedSchemas.js";

export const ROUTE_STATUSES = [
  "candidate",
  "beta",
  "validated",
  "published",
  "deprecated",
] as const;

export const RouteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(ROUTE_STATUSES),
  summary: z.string().min(1),
  goal_patterns: z.array(z.string()).default([]),
  components: z.array(z.string()).default([]),
  edges: z.array(z.string()).default([]),
  known_playbooks_reused: z.array(z.string()).default([]),
  untested_edges: z.array(z.string()).default([]),
  risk_level: z.enum(RISK_LEVELS),
  confidence: z.number().min(0).max(1),
  required_evals: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type Route = z.infer<typeof RouteSchema>;
