/**
 * Shape of the build-time registry bundle (fs-free).
 *
 * scripts/gen-registry-bundle.ts reads the YAML registry once at build time
 * and emits registryBundle.generated.ts conforming to this type. The Worker
 * imports that generated module instead of touching the filesystem.
 */
import type { Component } from "./componentSchema.js";
import type { Edge } from "./edgeSchema.js";
import type { Stack } from "./stackSchema.js";
import type { Route } from "./routeSchema.js";
import type { Playbook } from "./playbookSchema.js";

/** One entity plus its source-file mtime as an ISO string (JSON-serialisable). */
export type BundleEntry<T> = { mtime: string; data: T };

export type RegistryBundle = {
  /** ISO timestamp of when the bundle was generated. */
  generated_at: string;
  /** Short sha256 fingerprint of the bundled content. */
  fingerprint: string;
  /** ISO timestamp of the newest source file at generation time. */
  newest_mtime: string;
  components: BundleEntry<Component>[];
  edges: BundleEntry<Edge>[];
  stacks: BundleEntry<Stack>[];
  routes: BundleEntry<Route>[];
  playbooks: BundleEntry<Playbook>[];
};
