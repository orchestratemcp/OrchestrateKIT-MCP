/**
 * Filesystem-free registry assembly.
 *
 * This module contains the pure logic that turns raw registry entries (already
 * parsed from YAML, regardless of source) into a validated, status-filtered
 * LoadedRegistry. It imports NO node:fs / node:path so it can run in any
 * runtime — Node, Cloudflare Workers, Deno, the browser.
 *
 * - Node loads entries from disk (registryLoader.ts) and calls assembleRegistry.
 * - The Worker loads entries from a build-time bundle (loadRegistryBundled.ts)
 *   and calls the same assembleRegistry — identical filtering + validation.
 */

import type { Component } from "./componentSchema.js";
import type { Edge } from "./edgeSchema.js";
import type { Stack } from "./stackSchema.js";
import type { Route } from "./routeSchema.js";
import type { Playbook } from "./playbookSchema.js";
import type { Registry, RegistryStatus } from "./registryTypes.js";
import {
  validateNoDuplicateIds,
  validateCrossReferences,
  RegistryValidationError,
  type ValidationError,
} from "./registryValidation.js";

export type { Registry, RegistryStatus };

export type LoaderOptions = {
  /** Include entities with status "beta". Default: false. */
  includeBeta?: boolean;
  /** Include entities with status "candidate". Default: false. */
  includeCandidates?: boolean;
  /**
   * Throw on broken cross-references. Default: true.
   * Set to false to get a warning array instead of throwing.
   */
  strict?: boolean;
  /** Override registry root directory (fs loader only; ignored by the bundle). */
  registryDir?: string;
};

export type LoadedRegistry = Registry & {
  validationWarnings: ValidationError[];
  /** Map from component id → file modification time (for freshness reporting). */
  componentMtimes: Map<string, Date>;
};

/** One parsed registry entity plus the mtime of its source file. */
export type RawEntry<T> = { data: T; fileMtime: Date };

export type RawEntries = {
  components: RawEntry<Component>[];
  edges: RawEntry<Edge>[];
  stacks: RawEntry<Stack>[];
  routes: RawEntry<Route>[];
  playbooks: RawEntry<Playbook>[];
};

const DEFAULT_ALLOWED = new Set(["published", "validated"]);

export function isAllowedStatus(status: string, opts: LoaderOptions): boolean {
  if (DEFAULT_ALLOWED.has(status)) return true;
  if (opts.includeBeta === true && status === "beta") return true;
  if (opts.includeCandidates === true && status === "candidate") return true;
  return false;
}

/**
 * Filter raw entries by status, build the mtime map, run duplicate-id and
 * cross-reference validation, and return a LoadedRegistry. Pure — no I/O.
 */
export function assembleRegistry(
  raw: RawEntries,
  opts: LoaderOptions = {},
): LoadedRegistry {
  const strict = opts.strict ?? true;

  const components = raw.components
    .map((r) => r.data)
    .filter((c) => isAllowedStatus(c.status, opts));
  const edges = raw.edges
    .map((r) => r.data)
    .filter((e) => isAllowedStatus(e.status, opts));
  const stacks = raw.stacks
    .map((r) => r.data)
    .filter((s) => isAllowedStatus(s.status, opts));
  const routes = raw.routes
    .map((r) => r.data)
    .filter((r) => isAllowedStatus(r.status, opts));
  const playbooks = raw.playbooks
    .map((r) => r.data)
    .filter((p) => isAllowedStatus(p.status, opts));

  const componentMtimes = new Map<string, Date>(
    raw.components
      .filter((r) => isAllowedStatus(r.data.status, opts))
      .map((r) => [r.data.id, r.fileMtime]),
  );

  validateNoDuplicateIds(components, "component");
  validateNoDuplicateIds(edges, "edge");
  validateNoDuplicateIds(stacks, "stack");
  validateNoDuplicateIds(routes, "route");
  validateNoDuplicateIds(playbooks, "playbook");

  const registry: Registry = { components, edges, stacks, routes, playbooks };
  const validationWarnings = validateCrossReferences(registry);

  if (strict && validationWarnings.length > 0) {
    const details = validationWarnings
      .map((e) => `  [${e.entity}] ${e.field}: ${e.message}`)
      .join("\n");
    throw new RegistryValidationError(
      `Registry cross-reference errors:\n${details}`,
      validationWarnings,
    );
  }

  return { ...registry, validationWarnings, componentMtimes };
}

/** Derive count/freshness summary from an already-assembled registry. Pure. */
export function computeRegistryStatus(registry: LoadedRegistry): RegistryStatus {
  const totalEdges = registry.edges.length;
  const untestedEdges = registry.edges.filter((e) => !e.tested).length;
  const untested_edge_pct =
    totalEdges > 0 ? Math.round((untestedEdges / totalEdges) * 1000) / 10 : 0;

  const STALE_THRESHOLD_MS = 90 * 86_400_000;
  const now = Date.now();
  const stale_component_count = [...registry.componentMtimes.values()].filter(
    (mtime) => now - mtime.getTime() > STALE_THRESHOLD_MS,
  ).length;

  return {
    component_count: registry.components.length,
    edge_count: registry.edges.length,
    stack_count: registry.stacks.length,
    route_count: registry.routes.length,
    playbook_count: registry.playbooks.length,
    untested_edge_pct,
    stale_component_count,
  };
}
