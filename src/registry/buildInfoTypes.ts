/**
 * Build-info type, split out of buildManifest.ts (which is fs-bound) so that
 * fs-free runtimes (the Cloudflare Worker) can reference the shape without
 * pulling node:fs into their bundle.
 */
export type RegistryBuild = {
  /** Short sha256 fingerprint of all YAML file paths + contents. */
  fingerprint: string;
  /**
   * Mtime-independent fingerprint of entity content only (MAR-220/P0-06).
   * Reproducible across checkouts and deploys — compared against
   * `EXPECTED_RELEASE_FINGERPRINT` (src/config.ts) to tell a build serving the
   * exact published release apart from one that merely clears the count
   * floors.
   */
  content_fingerprint: string;
  /** ISO timestamp of the newest YAML file in the registry dir. */
  newest_mtime: string;
  /** ISO timestamp written by the build into the manifest. Null in dev mode. */
  built_at: string | null;
  /** True when any YAML/source is newer than built_at (dist is stale). */
  stale: boolean;
  /** Up to 5 files/reasons that are newer than built_at. Empty when stale=false. */
  stale_files: string[];
  /** ISO timestamp of when this process started (module import time). */
  process_started_at: string;
  /** True when the on-disk build is newer than this process started (MAR-141). */
  process_stale: boolean;
};
