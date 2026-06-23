import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import type { ZodObject, ZodRawShape } from "zod";
import { ComponentSchema } from "./componentSchema.js";
import { EdgeSchema } from "./edgeSchema.js";
import { StackSchema } from "./stackSchema.js";
import { RouteSchema } from "./routeSchema.js";
import { PlaybookSchema } from "./playbookSchema.js";
import { WorkerSchema, isWriteTool, READ_ONLY_ROLES } from "./workerSchema.js";
import type { Component } from "./componentSchema.js";
import type { Edge } from "./edgeSchema.js";
import type { Worker } from "./workerSchema.js";
import type { Playbook } from "./playbookSchema.js";
import type { Registry } from "./registryTypes.js";
import { loadRegistry, type LoaderOptions } from "./registryLoader.js";
import {
  validateCrossReferences,
  type ValidationError,
} from "./registryValidation.js";

/** External-write components that must declare permissions and side_effects. */
const CRITICAL_WRITE_COMPONENTS = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
]);

/** Registry subdirectories that hold YAML files (relative to the registry dir). */
const REGISTRY_YAML_DIRS = ["components", "edges", "stacks", "routes", "playbooks", "workers"];

export type LayerCompletion = {
  L0: number;
  L1: number;
  L2: number;
  L3: number;
  L4: number;
};

export type RegistryLintResult = {
  ok: boolean;
  errors: ValidationError[];
  brain_completion_pct: LayerCompletion;
  component_count: number;
};

function schemaKeys(schema: ZodObject<ZodRawShape>): Set<string> {
  return new Set(Object.keys(schema.shape));
}

function lintUnknownYamlFields(
  dir: string,
  schema: ZodObject<ZodRawShape>,
  entityType: string,
): ValidationError[] {
  if (!existsSync(dir)) return [];
  const allowed = schemaKeys(schema);
  const errors: ValidationError[] = [];

  for (const file of readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") && !f.startsWith("_"),
  )) {
    const filePath = join(dir, file);
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      if (!allowed.has(key)) {
        errors.push({
          entity: `${entityType}:${(raw as { id?: string }).id ?? file}`,
          field: key,
          message: `Unknown YAML field "${key}" (stripped by Zod — add to schema or remove from file ${file})`,
        });
      }
    }
  }
  return errors;
}

/**
 * Hygiene gate (MAR-160): no registry YAML file may begin with a UTF-8 BOM
 * (EF BB BF). The BOM is a Windows editor artifact — js-yaml tolerates it, but
 * it breaks naive byte-level tooling and pollutes diffs. Reads raw bytes so the
 * check is independent of UTF-8 decoding. Scans templates too, so a BOM can't
 * sneak in via a copied `_template`.
 */
export function lintNoByteOrderMark(registryDir: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const sub of REGISTRY_YAML_DIRS) {
    const dir = join(registryDir, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
      const buf = readFileSync(join(dir, file));
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        errors.push({
          entity: `${sub}:${file}`,
          field: "encoding",
          message: "File starts with a UTF-8 BOM — re-save as UTF-8 without BOM",
        });
      }
    }
  }
  return errors;
}

function lintTestedEdgesRequireRefs(edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const edge of edges) {
    if (edge.tested && edge.test_refs.length === 0) {
      errors.push({
        entity: `edge:${edge.id}`,
        field: "test_refs",
        message: "tested: true requires non-empty test_refs[]",
      });
    }
  }
  return errors;
}

/**
 * Worker contract lint (MAR-166). Enforces the structural invariants that make
 * a worker a SAFE specialist rather than a free-for-all agent:
 *  - a tool cannot be both allowed AND forbidden,
 *  - a read-only role (planner / reviewer / tester) must not list a write tool
 *    among its allowed_tools,
 *  - a worker that cannot hand off and is not a terminal role is a dead end.
 * (handoff_to id existence is checked in validateCrossReferences.)
 */
export function lintWorkerContracts(workers: Worker[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const w of workers) {
    const allowed = new Set(w.allowed_tools);
    for (const t of w.forbidden_tools) {
      if (allowed.has(t)) {
        errors.push({
          entity: `worker:${w.id}`,
          field: "allowed_tools",
          message: `Tool "${t}" is in both allowed_tools and forbidden_tools`,
        });
      }
    }
    if (READ_ONLY_ROLES.has(w.role)) {
      for (const t of w.allowed_tools) {
        if (isWriteTool(t)) {
          errors.push({
            entity: `worker:${w.id}`,
            field: "allowed_tools",
            message: `Read-only role "${w.role}" must not allow write tool "${t}"`,
          });
        }
      }
    }
  }
  return errors;
}

/**
 * Loop-playbook guardrail gate (MAR-167). The Zod LoopContractSchema already
 * enforces the static guardrails (bounded max_iterations, state/audit required,
 * reviewer_independent + no_write_until_final_gate literally true, ≥1 gated
 * action class). This lint enforces the STRUCTURAL claim the boolean cannot:
 * a playbook asserting `reviewer_independent` must actually sequence an
 * independent reviewer — a reviewer-role worker AND a coder-role worker that
 * are different agents. Keeps the contract honest against its worker_sequence.
 */
export function lintLoopPlaybooks(
  playbooks: Playbook[],
  workers: Worker[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const roleById = new Map(workers.map((w) => [w.id, w.role]));

  for (const pb of playbooks) {
    if (!pb.loop_contract) continue;
    const seq = pb.worker_sequence ?? [];
    const reviewers = seq.filter((id) => roleById.get(id) === "reviewer");
    const coders = seq.filter((id) => roleById.get(id) === "coder");

    if (reviewers.length === 0) {
      errors.push({
        entity: `playbook:${pb.id}`,
        field: "worker_sequence",
        message: "loop_contract.reviewer_independent requires a reviewer-role worker in worker_sequence",
      });
    }
    if (coders.length === 0) {
      errors.push({
        entity: `playbook:${pb.id}`,
        field: "worker_sequence",
        message: "loop playbook requires a coder-role worker in worker_sequence",
      });
    }
    // A worker cannot be both the reviewer and the coder — that breaks independence.
    if (reviewers.some((r) => coders.includes(r))) {
      errors.push({
        entity: `playbook:${pb.id}`,
        field: "worker_sequence",
        message: "reviewer and coder must be different workers (reviewer not independent)",
      });
    }
  }
  return errors;
}

function lintComponentRefs(registry: Registry): ValidationError[] {
  const errors: ValidationError[] = [];
  const componentIds = new Set(registry.components.map((c) => c.id));
  const edgeIds = new Set(registry.edges.map((e) => e.id));

  for (const c of registry.components) {
    for (const ref of c.requires) {
      if (!componentIds.has(ref) && !edgeIds.has(ref)) {
        errors.push({
          entity: `component:${c.id}`,
          field: "requires",
          message: `Unknown reference "${ref}"`,
        });
      }
    }
    for (const ref of c.recommended_with) {
      if (!componentIds.has(ref) && !edgeIds.has(ref)) {
        errors.push({
          entity: `component:${c.id}`,
          field: "recommended_with",
          message: `Unknown reference "${ref}"`,
        });
      }
    }
    for (const ref of c.avoid_with) {
      if (!componentIds.has(ref) && !edgeIds.has(ref)) {
        errors.push({
          entity: `component:${c.id}`,
          field: "avoid_with",
          message: `Unknown reference "${ref}"`,
        });
      }
    }
  }
  return errors;
}

function layerComplete(c: Component): Record<keyof LayerCompletion, boolean> {
  const hasPermissions =
    c.permissions.read !== undefined &&
    c.permissions.write !== undefined &&
    c.permissions.approval_required_for !== undefined;

  return {
    L0: Boolean(c.risk_level) && Array.isArray(c.side_effects) && hasPermissions,
    L1:
      c.capabilities.length >= 3 &&
      c.inputs.length >= 1 &&
      c.outputs.length >= 1,
    L2:
      c.requires.length > 0 ||
      c.recommended_with.length > 0 ||
      c.avoid_with.length > 0,
    L3: c.failure_modes.length >= 2 && c.evals.length >= 1,
    L4:
      (c.tested_in_playbooks.length > 0 || c.tested_in_routes.length > 0) &&
      c.sources.length >= 1,
  };
}

function lintPublishedComponents(components: Component[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const c of components.filter((x) => x.status === "published")) {
    const layers = layerComplete(c);
    if (!layers.L0) {
      errors.push({
        entity: `component:${c.id}`,
        field: "L0",
        message: "Published component missing L0 (risk_level, side_effects, permissions)",
      });
    }
    if (!layers.L1) {
      errors.push({
        entity: `component:${c.id}`,
        field: "L1",
        message: "Published component missing L1 (≥3 capabilities, inputs, outputs)",
      });
    }
    if (!layers.L2) {
      errors.push({
        entity: `component:${c.id}`,
        field: "L2",
        message: "Published component missing L2 (requires, recommended_with, or avoid_with)",
      });
    }
  }
  return errors;
}

function lintValidatedComponents(components: Component[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const c of components.filter((x) => x.status === "validated")) {
    const layers = layerComplete(c);
    if (!layers.L3) {
      errors.push({
        entity: `component:${c.id}`,
        field: "L3",
        message: "Validated component missing L3 (≥2 failure_modes, ≥1 eval)",
      });
    }
    if (!layers.L4) {
      errors.push({
        entity: `component:${c.id}`,
        field: "L4",
        message: "Validated component missing L4 (tested_in_* refs and ≥1 source)",
      });
    }
  }
  return errors;
}

function lintCriticalWriteComponents(components: Component[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const c of components) {
    if (!CRITICAL_WRITE_COMPONENTS.has(c.id)) continue;
    if (c.side_effects.length === 0) {
      errors.push({
        entity: `component:${c.id}`,
        field: "side_effects",
        message: "Critical write component must declare side_effects",
      });
    }
    const perms = c.permissions;
    if (
      perms.read.length === 0 &&
      perms.write.length === 0 &&
      perms.approval_required_for.length === 0
    ) {
      errors.push({
        entity: `component:${c.id}`,
        field: "permissions",
        message: "Critical write component must declare permissions",
      });
    }
  }
  return errors;
}

export function computeBrainCompletionPct(
  components: Component[],
): LayerCompletion {
  const published = components.filter((c) => c.status === "published" || c.status === "validated");
  if (published.length === 0) {
    return { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  }

  const totals = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const c of published) {
    const layers = layerComplete(c);
    for (const key of Object.keys(totals) as (keyof LayerCompletion)[]) {
      if (layers[key]) totals[key]++;
    }
  }

  const n = published.length;
  return {
    L0: Math.round((totals.L0 / n) * 1000) / 10,
    L1: Math.round((totals.L1 / n) * 1000) / 10,
    L2: Math.round((totals.L2 / n) * 1000) / 10,
    L3: Math.round((totals.L3 / n) * 1000) / 10,
    L4: Math.round((totals.L4 / n) * 1000) / 10,
  };
}

export function lintRegistry(opts: LoaderOptions = {}): RegistryLintResult {
  const registryDir = opts.registryDir ?? join(process.cwd(), "registry");
  const errors: ValidationError[] = [];

  errors.push(
    ...lintNoByteOrderMark(registryDir),
    ...lintUnknownYamlFields(join(registryDir, "components"), ComponentSchema, "component"),
    ...lintUnknownYamlFields(join(registryDir, "edges"), EdgeSchema, "edge"),
    ...lintUnknownYamlFields(join(registryDir, "stacks"), StackSchema, "stack"),
    ...lintUnknownYamlFields(join(registryDir, "routes"), RouteSchema, "route"),
    ...lintUnknownYamlFields(join(registryDir, "playbooks"), PlaybookSchema, "playbook"),
    ...lintUnknownYamlFields(join(registryDir, "workers"), WorkerSchema, "worker"),
  );

  const registry = loadRegistry({ ...opts, strict: true, includeBeta: true, includeCandidates: true });
  const allComponents = loadRegistry({
    ...opts,
    strict: false,
    includeBeta: true,
    includeCandidates: true,
  }).components;

  errors.push(
    ...validateCrossReferences(registry),
    ...lintTestedEdgesRequireRefs(registry.edges),
    ...lintComponentRefs(registry),
    ...lintWorkerContracts(registry.workers),
    ...lintLoopPlaybooks(registry.playbooks, registry.workers),
    ...lintPublishedComponents(allComponents),
    ...lintValidatedComponents(allComponents),
    ...lintCriticalWriteComponents(allComponents),
  );

  const brain_completion_pct = computeBrainCompletionPct(allComponents);

  return {
    ok: errors.length === 0,
    errors,
    brain_completion_pct,
    component_count: allComponents.length,
  };
}
