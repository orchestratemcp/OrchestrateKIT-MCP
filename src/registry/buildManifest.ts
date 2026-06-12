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

export type RegistryBuild = {
  /** Short sha256 fingerprint of all YAML file paths + contents. */
  fingerprint: string;
  /** ISO timestamp of the newest YAML file in the registry dir. */
  newest_mtime: string;
  /** ISO timestamp written by the build script into `_build_manifest.json`. Null in dev (tsx) mode. */
  built_at: string | null;
  /** True when any YAML file is newer than built_at (dist is stale). Always false in dev mode. */
  stale: boolean;
  /** Up to 5 files that are newer than built_at. Empty when stale=false. */
  stale_files: string[];
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

  // Stale check
  let stale = false;
  const staleFiles: string[] = [];
  if (builtAt) {
    const builtAtDate = new Date(builtAt);
    for (const f of files) {
      if (f.mtime > builtAtDate) {
        stale = true;
        if (staleFiles.length < 5) {
          staleFiles.push(relative(dir, f.path).replaceAll("\\", "/"));
        }
      }
    }
  }

  return {
    fingerprint,
    newest_mtime: newestMtime.toISOString(),
    built_at: builtAt,
    stale,
    stale_files: staleFiles,
  };
}
