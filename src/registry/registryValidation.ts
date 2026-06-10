import type { Registry } from "./registryTypes.js";

export type ValidationError = {
  entity: string;
  field: string;
  message: string;
};

export class RegistryValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
  ) {
    super(message);
    this.name = "RegistryValidationError";
  }
}

export function validateNoDuplicateIds(
  items: ReadonlyArray<{ id: string }>,
  entityType: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new RegistryValidationError(`Duplicate ${entityType} id: "${item.id}"`, [
        { entity: `${entityType}:${item.id}`, field: "id", message: `Duplicate id "${item.id}"` },
      ]);
    }
    seen.add(item.id);
  }
}

export function validateCrossReferences(registry: Registry): ValidationError[] {
  const errors: ValidationError[] = [];
  const componentIds = new Set(registry.components.map((c) => c.id));
  const edgeIds = new Set(registry.edges.map((e) => e.id));
  const stackIds = new Set(registry.stacks.map((s) => s.id));
  const routeIds = new Set(registry.routes.map((r) => r.id));

  for (const edge of registry.edges) {
    if (!componentIds.has(edge.from)) {
      errors.push({
        entity: `edge:${edge.id}`,
        field: "from",
        message: `Unknown component id "${edge.from}"`,
      });
    }
    if (!componentIds.has(edge.to)) {
      errors.push({
        entity: `edge:${edge.id}`,
        field: "to",
        message: `Unknown component id "${edge.to}"`,
      });
    }
  }

  for (const route of registry.routes) {
    for (const cid of route.components) {
      if (!componentIds.has(cid)) {
        errors.push({
          entity: `route:${route.id}`,
          field: "components",
          message: `Unknown component id "${cid}"`,
        });
      }
    }
    for (const eid of route.edges) {
      if (!edgeIds.has(eid)) {
        errors.push({
          entity: `route:${route.id}`,
          field: "edges",
          message: `Unknown edge id "${eid}"`,
        });
      }
    }
  }

  for (const pb of registry.playbooks) {
    if (pb.golden_path_route_id && !routeIds.has(pb.golden_path_route_id)) {
      errors.push({
        entity: `playbook:${pb.id}`,
        field: "golden_path_route_id",
        message: `Unknown route id "${pb.golden_path_route_id}"`,
      });
    }
    if (pb.stack_id && !stackIds.has(pb.stack_id)) {
      errors.push({
        entity: `playbook:${pb.id}`,
        field: "stack_id",
        message: `Unknown stack id "${pb.stack_id}"`,
      });
    }
    for (const cid of pb.components) {
      if (!componentIds.has(cid)) {
        errors.push({
          entity: `playbook:${pb.id}`,
          field: "components",
          message: `Unknown component id "${cid}"`,
        });
      }
    }
    for (const eid of pb.edges) {
      if (!edgeIds.has(eid)) {
        errors.push({
          entity: `playbook:${pb.id}`,
          field: "edges",
          message: `Unknown edge id "${eid}"`,
        });
      }
    }
  }

  return errors;
}
