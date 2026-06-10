import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import type { ZodTypeAny } from "zod";
import { ComponentSchema } from "./componentSchema.js";
import { EdgeSchema } from "./edgeSchema.js";
import { StackSchema } from "./stackSchema.js";
import { RouteSchema } from "./routeSchema.js";
import { PlaybookSchema } from "./playbookSchema.js";
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
  /** Override registry root directory (useful for tests). */
  registryDir?: string;
};

const DEFAULT_ALLOWED = new Set(["published", "validated"]);

function isAllowedStatus(status: string, opts: LoaderOptions): boolean {
  if (DEFAULT_ALLOWED.has(status)) return true;
  if (opts.includeBeta === true && status === "beta") return true;
  if (opts.includeCandidates === true && status === "candidate") return true;
  return false;
}

function defaultRegistryDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // When bundled (dist/server.js) the registry is copied next to the bundle.
  const sibling = join(__dirname, "registry");
  if (existsSync(sibling)) return sibling;

  // When running via tsx from src/registry/registryLoader.ts, go up two levels.
  return join(__dirname, "..", "..", "registry");
}

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; filePath: string };

function loadYamlDir<T>(
  dir: string,
  schema: ZodTypeAny,
): Array<{ filePath: string; data: T }> {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") && !f.startsWith("_"),
  );

  const results: Array<{ filePath: string; data: T }> = [];

  for (const file of files) {
    const filePath = join(dir, file);
    let raw: unknown;

    try {
      raw = parseYaml(readFileSync(filePath, "utf-8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse YAML at ${filePath}: ${msg}`);
    }

    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Schema validation failed for ${filePath}:\n${issues}`);
    }

    results.push({ filePath, data: result.data as T });
  }

  return results;
}

export type LoadedRegistry = Registry & {
  validationWarnings: ValidationError[];
};

export function loadRegistry(opts: LoaderOptions = {}): LoadedRegistry {
  const strict = opts.strict ?? true;
  const registryDir = opts.registryDir ?? defaultRegistryDir();

  const allComponents = loadYamlDir<Component>(join(registryDir, "components"), ComponentSchema);
  const allEdges = loadYamlDir<Edge>(join(registryDir, "edges"), EdgeSchema);
  const allStacks = loadYamlDir<Stack>(join(registryDir, "stacks"), StackSchema);
  const allRoutes = loadYamlDir<Route>(join(registryDir, "routes"), RouteSchema);
  const allPlaybooks = loadYamlDir<Playbook>(join(registryDir, "playbooks"), PlaybookSchema);

  const components = allComponents.map((r) => r.data).filter((c) => isAllowedStatus(c.status, opts));
  const edges = allEdges.map((r) => r.data).filter((e) => isAllowedStatus(e.status, opts));
  const stacks = allStacks.map((r) => r.data).filter((s) => isAllowedStatus(s.status, opts));
  const routes = allRoutes.map((r) => r.data).filter((r) => isAllowedStatus(r.status, opts));
  const playbooks = allPlaybooks.map((r) => r.data).filter((p) => isAllowedStatus(p.status, opts));

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

  return { ...registry, validationWarnings };
}

export function getRegistryStatus(opts: LoaderOptions = {}): RegistryStatus {
  const registry = loadRegistry(opts);
  const totalEdges = registry.edges.length;
  const untestedEdges = registry.edges.filter((e) => !e.tested).length;
  const untested_edge_pct =
    totalEdges > 0 ? Math.round((untestedEdges / totalEdges) * 1000) / 10 : 0;
  return {
    component_count: registry.components.length,
    edge_count: registry.edges.length,
    stack_count: registry.stacks.length,
    route_count: registry.routes.length,
    playbook_count: registry.playbooks.length,
    untested_edge_pct,
  };
}
