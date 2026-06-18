/**
 * Node entry points call this once at startup to wire the filesystem-based
 * registry loader and build manifest into the provider. The Worker uses its
 * own bundle-based bootstrap instead (see worker.ts).
 */
import { setRegistryLoader, setBuildInfoProvider } from "./registryProvider.js";
import { loadRegistry } from "./registryLoader.js";
import { getRegistryBuild } from "./buildManifest.js";
import { setDocsIndexLoader } from "../docs-index/provider.js";
import { loadDocsIndex } from "../docs-index/loader.js";

export function bootstrapNodeRegistry(): void {
  setRegistryLoader(loadRegistry);
  setBuildInfoProvider(getRegistryBuild);
  setDocsIndexLoader(loadDocsIndex);
}
