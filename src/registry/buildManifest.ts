import {
  readFileSync,
  statSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { defaultRegistryDir } from "./registryLoader.js";

type RawManifest = { built_at: string };

/**
 * ISO timestamp of when this module was first imported (i.e. when the process
 * started). Used to detect whether the running binary is stale — if built_at is
 * newer than this, the process was started before the most recent build and must
 * be restarted to pick up the new code (MAR-141).
 */
const PROCESS_STARTED_AT = new Date().toISOString();

export type RegistryBuild = {
  /** Short sha256 fingerprint of all YAML file paths + contents. */
  fingerprint: string;
  /** ISO timestamp of the newest YAML file in the registry dir. */
  newest_mtime: string;
  /** ISO timestamp written by the build script into `_build_manifest.json`. Null in dev (tsx) mode. */
  built_at: string | null;
  /** True when any YAML file or TypeScript source is newer than built_at (dist is stale). Always false in dev mode. */
  stale: boolean;
  /** Up to 5 files/reasons that are newer than built_at. Empty when stale=false. */
  stale_files: string[];
  /**
   * ISO timestamp of when this process started (module import time). Enables
   * detection of the "rebuilt but not reconnected" trap: when built_at >
   * process_started_at the binary on disk is newer than what this process loaded.
   * The process must be restarted for the new code to take effect (MAR-141).
   */
  process_started_at: string;
  /**
   * True when the on-disk build (built_at) is newer than this process started.
   * The running process is serving code compiled BEFORE the latest build — restart
   * the server and reconnect the MCP client to pick up the new logic (MAR-141).
   */
  process_stale: boolean;
};

type YamlEntry = { path: string; content: string; mtime: Date };

function collectYamlFiles(dir: string): YamlEntry[] {
  if (!existsSync(dir)) return [];
  const out: YamlEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectYamlFiles(full));
    } else if (entry.name.endsWith(".yaml") && !entry.name.startsWith("_")) {
      out.push({
        path: full,
        content: readFileSync(full, "utf-8"),
        mtime: statSync(full).mtime,
      });
    }
  }
  return out;
}

/** Walk a directory recursively and return the newest .ts file mtime, or null. */
function newestTsMtime(dir: string): Date | null {
  if (!existsSync(dir)) return null;
  let newest: Date | null = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = newestTsMtime(full);
      if (sub && (!newest || sub > newest)) newest = sub;
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      const mtime = statSync(full).mtime;
      if (!newest || mtime > newest) newest = mtime;
    }
  }
  return newest;
}

export function getRegistryBuild(registryDir?: string): RegistryBuild {
  const dir = registryDir ?? defaultRegistryDir();
  const files = collectYamlFiles(dir).sort((a, b) => a.path.localeCompare(b.path));

  // Fingerprint: sha256 of sorted path+content pairs
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f.path);
    hash.update(f.content);
  }
  const fingerprint = hash.digest("hex").slice(0, 16);

  // Newest mtime
  let newestMtime = new Date(0);
  for (const f of files) {
    if (f.mtime > newestMtime) newestMtime = f.mtime;
  }

  // Build manifest (only present in bundled dist)
  const manifestPath = join(dir, "_build_manifest.json");
  let builtAt: string | null = null;
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as RawManifest;
      builtAt = raw.built_at ?? null;
    } catch {
      // corrupt manifest — treat as dev mode
    }
  }

  // ── Stale checks ──
  let stale = false;
  const staleFiles: string[] = [];

  if (builtAt) {
    const builtAtDate = new Date(builtAt);

    // 1. YAML files newer than built_at (registry content changed, needs rebuild)
    for (const f of files) {
      if (f.mtime > builtAtDate) {
        stale = true;
        if (staleFiles.length < 5) {
          staleFiles.push(relative(dir, f.path).replaceAll("\\", "/"));
        }
      }
    }

    // 2. TypeScript source newer than dist/server.js (code changed, needs rebuild).
    //    dist/server.js sits one level above the registry dir; src/ is two levels up.
    //    These paths only exist in local dev — gracefully skipped in CI/prod.
    const serverJsPath = join(dir, "..", "server.js");
    const srcDir = join(dir, "..", "..", "src");
    if (existsSync(serverJsPath) && existsSync(srcDir)) {
      const serverMtime = statSync(serverJsPath).mtime;
      const newestSrc = newestTsMtime(srcDir);
      if (newestSrc && newestSrc > serverMtime) {
        stale = true;
        if (staleFiles.length < 5) {
          staleFiles.push("src/ (TypeScript source newer than dist/server.js — run pnpm build)");
        }
      }
    }
  }

  // ── Process stale check (MAR-141) ──
  // True when the binary on disk was built AFTER this process started — the
  // running process is serving old code and must be restarted + reconnected.
  const process_stale = builtAt
    ? new Date(builtAt) > new Date(PROCESS_STARTED_AT)
    : false;

  return {
    fingerprint,
    newest_mtime: newestMtime.toISOString(),
    built_at: builtAt,
    stale,
    stale_files: staleFiles,
    process_started_at: PROCESS_STARTED_AT,
    process_stale,
  };
}
