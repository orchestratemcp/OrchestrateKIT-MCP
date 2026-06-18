import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
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
  assembleRegistry,
  computeRegistryStatus,
  type LoaderOptions,
  type LoadedRegistry,
  type RawEntries,
} from "./registryAssembly.js";

export type { Registry, RegistryStatus };
export type { LoaderOptions, LoadedRegistry };

export function defaultRegistryDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // When bundled (dist/server.js) the registry is copied next to the bundle.
  const sibling = join(__dirname, "registry");
  if (existsSync(sibling)) return sibling;

  // When running via tsx from src/registry/registryLoader.ts, go up two levels.
  return join(__dirname, "..", "..", "registry");
}

function loadYamlDir<T>(
  dir: string,
  schema: ZodTypeAny,
): Array<{ filePath: string; fileMtime: Date; data: T }> {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") && !f.startsWith("_"),
  );

  const results: Array<{ filePath: string; fileMtime: Date; data: T }> = [];

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

    const fileMtime = statSync(filePath).mtime;
    results.push({ filePath, fileMtime, data: result.data as T });
  }

  return results;
}

/**
 * Read every registry YAML file from disk, parse + schema-validate it, and
 * return raw entries. Node/fs only. The pure filtering/validation/status logic
 * lives in registryAssembly.ts so it can be shared with the Worker bundle.
 */
export function readRawEntries(registryDir: string = defaultRegistryDir()): RawEntries {
  const map = <T>(
    rows: Array<{ fileMtime: Date; data: T }>,
  ): Array<{ data: T; fileMtime: Date }> =>
    rows.map((r) => ({ data: r.data, fileMtime: r.fileMtime }));

  return {
    components: map(loadYamlDir<Component>(join(registryDir, "components"), ComponentSchema)),
    edges: map(loadYamlDir<Edge>(join(registryDir, "edges"), EdgeSchema)),
    stacks: map(loadYamlDir<Stack>(join(registryDir, "stacks"), StackSchema)),
    routes: map(loadYamlDir<Route>(join(registryDir, "routes"), RouteSchema)),
    playbooks: map(loadYamlDir<Playbook>(join(registryDir, "playbooks"), PlaybookSchema)),
  };
}

export function loadRegistry(opts: LoaderOptions = {}): LoadedRegistry {
  const registryDir = opts.registryDir ?? defaultRegistryDir();
  return assembleRegistry(readRawEntries(registryDir), opts);
}

export function getRegistryStatus(opts: LoaderOptions = {}): RegistryStatus {
  return computeRegistryStatus(loadRegistry(opts));
}
