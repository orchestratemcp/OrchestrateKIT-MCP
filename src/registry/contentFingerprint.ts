/**
 * Deterministic fingerprint over registry ENTITY CONTENT only (MAR-220).
 *
 * Unlike the build `fingerprint` (which includes per-file mtimes), this hash is
 * computed purely from each entity's parsed `data`, sorted by id. It is therefore
 * reproducible across git checkouts — git does not preserve file mtimes, so any
 * mtime-based hash differs on every clone. The release-trust gate compares the
 * source-derived content fingerprint against the one baked into the generated
 * bundle to prove the committed/generated bundle still matches the YAML source.
 */
import { createHash } from "node:crypto";
import type { RawEntries } from "./registryAssembly.js";

function idOf(data: unknown): string {
  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id: unknown }).id);
  }
  return "";
}

/** Stable sha256 (first 16 hex chars) over entity content only, mtime-excluded. */
export function contentFingerprint(raw: RawEntries): string {
  const sections: Record<string, { data: unknown }[]> = {
    components: raw.components,
    edges: raw.edges,
    stacks: raw.stacks,
    routes: raw.routes,
    playbooks: raw.playbooks,
    workers: raw.workers ?? [],
  };

  const canonical: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(sections)) {
    canonical[name] = rows
      .map((r) => r.data)
      .sort((a, b) => idOf(a).localeCompare(idOf(b)));
  }

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}
