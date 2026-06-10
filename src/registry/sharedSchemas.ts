import { z } from "zod";

export const SOURCE_TYPES = [
  "official_docs",
  "docs_index",
  "internal_note",
  "example_repo",
  "blog",
  "unknown",
] as const;

export const ENTITY_STATUSES = [
  "draft",
  "beta",
  "validated",
  "published",
  "deprecated",
] as const;

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export const SourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().optional(),
  source_type: z.enum(SOURCE_TYPES),
  last_checked: z.string().optional(),
});

export type Source = z.infer<typeof SourceSchema>;
