/** Filesystem-free docs-index loader for the Worker (reads the build bundle). */
import { DOCS_BUNDLE } from "./bundle.generated.js";
import type { DocsIndexEntry } from "./schema.js";
import type { DocsIndexLoaderOptions } from "./loaderTypes.js";

export function loadDocsIndexBundled(
  _opts: DocsIndexLoaderOptions = {},
): DocsIndexEntry[] {
  return DOCS_BUNDLE.entries;
}
