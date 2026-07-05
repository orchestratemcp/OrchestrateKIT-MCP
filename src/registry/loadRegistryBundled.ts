/**
 * Filesystem-free registry loader for runtimes without disk access
 * (Cloudflare Workers, Deno Deploy). Reads the build-time bundle and runs the
 * exact same assembly/validation as the Node fs loader.
 */
import { BUNDLE } from "./registryBundle.generated.js";
import {
  assembleRegistry,
  type LoadedRegistry,
  type LoaderOptions,
  type RawEntries,
} from "./registryAssembly.js";
import type { BundleEntry } from "./registryBundleTypes.js";
import type { RegistryBuild } from "./buildInfoTypes.js";

const PROCESS_STARTED_AT = new Date().toISOString();

function toRaw<T>(entries: BundleEntry<T>[]): { data: T; fileMtime: Date }[] {
  return entries.map((e) => ({ data: e.data, fileMtime: new Date(e.mtime) }));
}

export function loadRegistryBundled(opts: LoaderOptions = {}): LoadedRegistry {
  const raw: RawEntries = {
    components: toRaw(BUNDLE.components),
    edges: toRaw(BUNDLE.edges),
    stacks: toRaw(BUNDLE.stacks),
    routes: toRaw(BUNDLE.routes),
    playbooks: toRaw(BUNDLE.playbooks),
    workers: toRaw(BUNDLE.workers ?? []),
  };
  return assembleRegistry(raw, opts);
}

/**
 * Mtime-independent content fingerprint baked into the bundle at build time
 * (MAR-220). Used as the manifest `provenance.registry_fingerprint` (MAR-296) so
 * a DASH agent card records exactly which registry snapshot planned it. Falls
 * back to the mtime-based build fingerprint on older bundles that predate the
 * content hash.
 */
export function registryContentFingerprint(): string {
  return BUNDLE.content_fingerprint ?? BUNDLE.fingerprint;
}

/**
 * Static build info for the bundle. There is no "stale build" concept in a
 * Worker — the bundle is frozen at deploy time — so stale flags are always
 * false and built_at is the bundle generation timestamp.
 */
export function bundledBuildInfo(): RegistryBuild {
  return {
    fingerprint: BUNDLE.fingerprint,
    newest_mtime: BUNDLE.newest_mtime,
    built_at: BUNDLE.generated_at,
    stale: false,
    stale_files: [],
    process_started_at: PROCESS_STARTED_AT,
    process_stale: false,
  };
}
