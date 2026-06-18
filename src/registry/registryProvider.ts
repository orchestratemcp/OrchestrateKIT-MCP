/**
 * Registry dependency-injection seam (filesystem-free).
 *
 * Tools and the health check import loadRegistry / getRegistryStatus /
 * getRegistryBuild from THIS module — never directly from the fs-based
 * registryLoader. At startup each runtime injects its own implementation:
 *
 *   - Node (server.ts, server-http.ts): the fs loader + fs build manifest.
 *   - Worker (worker.ts): the build-time bundle loader + static build info.
 *
 * Because this module imports no node:fs, the Worker bundle never transitively
 * pulls the filesystem code path in.
 */

import {
  computeRegistryStatus,
  type LoadedRegistry,
  type LoaderOptions,
} from "./registryAssembly.js";
import type { RegistryStatus } from "./registryTypes.js";
import type { RegistryBuild } from "./buildInfoTypes.js";

export type RegistryLoaderFn = (opts?: LoaderOptions) => LoadedRegistry;
export type BuildInfoFn = () => RegistryBuild;

let activeLoader: RegistryLoaderFn | null = null;
let activeBuildInfo: BuildInfoFn | null = null;

export function setRegistryLoader(fn: RegistryLoaderFn): void {
  activeLoader = fn;
}

export function setBuildInfoProvider(fn: BuildInfoFn): void {
  activeBuildInfo = fn;
}

export function loadRegistry(opts: LoaderOptions = {}): LoadedRegistry {
  if (!activeLoader) {
    throw new Error(
      "Registry loader not configured — call setRegistryLoader() at startup.",
    );
  }
  return activeLoader(opts);
}

export function getRegistryStatus(opts: LoaderOptions = {}): RegistryStatus {
  return computeRegistryStatus(loadRegistry(opts));
}

export function getRegistryBuild(): RegistryBuild {
  if (!activeBuildInfo) {
    throw new Error(
      "Build-info provider not configured — call setBuildInfoProvider() at startup.",
    );
  }
  return activeBuildInfo();
}
