import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { DocsIndexEntrySchema, type DocsIndexEntry } from "./schema.js";

export type { DocsIndexEntry };

function defaultDocsIndexDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // When bundled (dist/server.js) the docs-index is copied next to the bundle.
  const sibling = join(__dirname, "docs-index");
  if (existsSync(sibling)) return sibling;

  // When running via tsx from src/docs-index/loader.ts, go up two levels.
  return join(__dirname, "..", "..", "docs-index");
}

export type DocsIndexLoaderOptions = {
  /** Override docs-index root directory (useful for tests). */
  docsIndexDir?: string;
};

export function loadDocsIndex(opts: DocsIndexLoaderOptions = {}): DocsIndexEntry[] {
  const dir = opts.docsIndexDir ?? defaultDocsIndexDir();

  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") && !f.startsWith("_"),
  );

  const entries: DocsIndexEntry[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    let raw: unknown;

    try {
      raw = parseYaml(readFileSync(filePath, "utf-8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse docs-index YAML at ${filePath}: ${msg}`);
    }

    const result = DocsIndexEntrySchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Docs-index schema validation failed for ${filePath}:\n${issues}`);
    }

    entries.push(result.data);
  }

  return entries;
}

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
