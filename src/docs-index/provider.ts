/**
 * Docs-index dependency-injection seam (fs-free), mirroring the registry
 * provider. getRelevantDocs imports loadDocsIndex from here; Node injects the
 * fs loader, the Worker injects the bundle loader.
 */
import type { DocsIndexEntry } from "./schema.js";
import type { DocsIndexLoaderOptions } from "./loaderTypes.js";

export { matchDocsIndex, type DocsMatchCriteria } from "./match.js";

export type DocsIndexLoaderFn = (opts?: DocsIndexLoaderOptions) => DocsIndexEntry[];

let activeLoader: DocsIndexLoaderFn | null = null;

export function setDocsIndexLoader(fn: DocsIndexLoaderFn): void {
  activeLoader = fn;
}

export function loadDocsIndex(opts: DocsIndexLoaderOptions = {}): DocsIndexEntry[] {
  if (!activeLoader) {
    throw new Error(
      "Docs-index loader not configured — call setDocsIndexLoader() at startup.",
    );
  }
  return activeLoader(opts);
}
