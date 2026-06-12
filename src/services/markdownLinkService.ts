/**
 * MAR-79 — Obsidian export: wikilink and filename utilities.
 *
 * Generates stable, sanitized filenames and wikilinks for the markdown vault.
 */

/** Sanitize an entity ID to a safe markdown filename (no spaces, no special chars). */
export function sanitizeFilename(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Generate a markdown wikilink `[[filename]]` from an entity id. */
export function toWikilink(id: string): string {
  return `[[${sanitizeFilename(id)}]]`;
}

/** Generate a markdown link `[text](path)` to an exported file. */
export function toMarkdownLink(text: string, filePath: string): string {
  return `[${text}](${filePath})`;
}

/**
 * Build the filename path for an entity within the export structure.
 * e.g. "components/email_draft.md" or "edges/external_publish_requires_human_approval_gate.md"
 */
export function buildExportPath(
  category: "components" | "edges" | "routes" | "playbooks" | "stacks" | "evals",
  id: string,
): string {
  return `${category}/${sanitizeFilename(id)}.md`;
}

/** Extract directory name from export path. */
export function getCategory(path: string): string {
  return path.split("/")[0]!;
}
