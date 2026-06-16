// Central re-export of all registry entity types and the Registry aggregate.

export type { Source } from "./sharedSchemas.js";
export type { Component } from "./componentSchema.js";
export type { Edge, EdgeRelation } from "./edgeSchema.js";
export type { Stack } from "./stackSchema.js";
export type { Route } from "./routeSchema.js";
export type { Playbook } from "./playbookSchema.js";

import type { Component } from "./componentSchema.js";
import type { Edge } from "./edgeSchema.js";
import type { Stack } from "./stackSchema.js";
import type { Route } from "./routeSchema.js";
import type { Playbook } from "./playbookSchema.js";

export type Registry = {
  components: Component[];
  edges: Edge[];
  stacks: Stack[];
  routes: Route[];
  playbooks: Playbook[];
};

export type RegistryStatus = {
  component_count: number;
  edge_count: number;
  stack_count: number;
  route_count: number;
  playbook_count: number;
  /** Percentage of edges with tested=false, rounded to one decimal place. */
  untested_edge_pct: number;
  /** Components whose registry YAML is >90 days old by file mtime (MAR-137). */
  stale_component_count: number;
};
