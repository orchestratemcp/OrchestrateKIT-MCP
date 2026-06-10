import { z } from "zod";
import { SOURCE_TYPES } from "../registry/sharedSchemas.js";

export const DocsIndexEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().optional(),
  source_type: z.enum(SOURCE_TYPES),
  last_checked: z.string().optional(),
  summary: z.string().min(1),
  /** Free-form tags for framework/topic matching (e.g. "openai", "mcp", "cursor"). */
  tags: z.array(z.string()).default([]),
  /**
   * Registry entity IDs (component, playbook, route) this doc is relevant to.
   * Also accepts plain topic strings for framework/topic-level matching.
   */
  relevant_to: z.array(z.string()).default([]),
});

export type DocsIndexEntry = z.infer<typeof DocsIndexEntrySchema>;
