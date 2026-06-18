/**
 * Pure docs-index matching (no fs) — shared by the Node loader and the Worker
 * bundle so both runtimes match identically.
 */
import type { DocsIndexEntry } from "./schema.js";

export type { DocsIndexEntry };

export type DocsMatchCriteria = {
  playbook_id?: string;
  route_id?: string;
  component_ids?: string[];
  frameworks?: string[];
  topics?: string[];
};

/**
 * Returns docs-index entries that are relevant to any of the provided criteria.
 * Matching is done against `tags` and `relevant_to` fields (case-insensitive substring).
 */
export function matchDocsIndex(
  entries: DocsIndexEntry[],
  criteria: DocsMatchCriteria,
): Array<DocsIndexEntry & { relevance_reason: string }> {
  const needles = new Set<string>();

  if (criteria.playbook_id) needles.add(criteria.playbook_id.toLowerCase());
  if (criteria.route_id) needles.add(criteria.route_id.toLowerCase());
  for (const c of criteria.component_ids ?? []) needles.add(c.toLowerCase());
  for (const f of criteria.frameworks ?? []) needles.add(f.toLowerCase());
  for (const t of criteria.topics ?? []) needles.add(t.toLowerCase());

  if (needles.size === 0) return [];

  const results: Array<DocsIndexEntry & { relevance_reason: string }> = [];

  for (const entry of entries) {
    const haystack = [
      ...entry.tags.map((t) => t.toLowerCase()),
      ...entry.relevant_to.map((r) => r.toLowerCase()),
      entry.id.toLowerCase(),
    ];

    const matchedNeedle = [...needles].find((n) =>
      haystack.some((h) => h.includes(n) || n.includes(h)),
    );

    if (matchedNeedle) {
      results.push({
        ...entry,
        relevance_reason: `Matched via "${matchedNeedle}"`,
      });
    }
  }

  return results;
}
