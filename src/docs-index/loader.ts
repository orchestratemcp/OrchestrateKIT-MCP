import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { DocsIndexEntrySchema, type DocsIndexEntry } from "./schema.js";
import { matchDocsIndex, type DocsMatchCriteria } from "./match.js";
import type { DocsIndexLoaderOptions } from "./loaderTypes.js";

export type { DocsIndexEntry };
// Re-export the pure matcher so existing importers (and tests) keep working
// while the Worker imports it directly from ./match.js (fs-free).
export { matchDocsIndex };
export type { DocsMatchCriteria, DocsIndexLoaderOptions };

export function defaultDocsIndexDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // When bundled (dist/server.js) the docs-index is copied next to the bundle.
  const sibling = join(__dirname, "docs-index");
  if (existsSync(sibling)) return sibling;

  // When running via tsx from src/docs-index/loader.ts, go up two levels.
  return join(__dirname, "..", "..", "docs-index");
}

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
