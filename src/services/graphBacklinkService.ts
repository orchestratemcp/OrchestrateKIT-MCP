import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { Route } from "../registry/routeSchema.js";
import type { Playbook } from "../registry/playbookSchema.js";
import type { Stack } from "../registry/stackSchema.js";

/**
 * MAR-79 — Obsidian export: backlink (incoming reference) computation.
 *
 * For each entity, collect all incoming edges and mentions so the exported
 * markdown can include a "backlinks" / "used by" section.
 */

export type BacklinkMap = Map<string, Backlink[]>;

export type Backlink = {
  source_id: string;
  source_type: "component" | "edge" | "route" | "playbook" | "stack";
  relation: string; // "requires", "produces_input_for", "in_route", "in_playbook", etc.
  reason: string; // human-readable description
};

export function buildBacklinkMap(
  components: Component[],
  edges: Edge[],
  routes: Route[],
  playbooks: Playbook[],
  stacks: Stack[],
): BacklinkMap {
  const backlinks: BacklinkMap = new Map();

  const add = (targetId: string, link: Backlink) => {
    if (!backlinks.has(targetId)) backlinks.set(targetId, []);
    backlinks.get(targetId)!.push(link);
  };

  // ── Edges: both from and to create backlinks ──
  for (const edge of edges) {
    add(edge.to, {
      source_id: edge.from,
      source_type: "component",
      relation: edge.relation,
      reason: `${edge.from} → ${edge.relation} → ${edge.to}`,
    });

    // Backward reference: from component mentions edge that requires/produces from it
    add(edge.from, {
      source_id: edge.to,
      source_type: "component",
      relation: `${edge.relation}_target`,
      reason: `${edge.from} ${edge.relation} ${edge.to}`,
    });
  }

  // ── Routes: components in the route link to the route ──
  for (const route of routes) {
    for (const compId of route.components) {
      add(compId, {
        source_id: route.id,
        source_type: "route",
        relation: "in_route",
        reason: `component of route ${route.id}`,
      });
    }

  }

  // ── Playbooks: components in the playbook, routes and stacks that they use ──
  for (const playbook of playbooks) {
    for (const compId of playbook.components) {
      add(compId, {
        source_id: playbook.id,
        source_type: "playbook",
        relation: "in_playbook",
        reason: `component of playbook ${playbook.id}`,
      });
    }

    // Playbook links to its route
    if (playbook.golden_path_route_id) {
      add(playbook.golden_path_route_id, {
        source_id: playbook.id,
        source_type: "playbook",
        relation: "uses_route",
        reason: `playbook ${playbook.id} uses route ${playbook.golden_path_route_id}`,
      });
    }

    // Playbook links to its stack
    if (playbook.stack_id) {
      add(playbook.stack_id, {
        source_id: playbook.id,
        source_type: "playbook",
        relation: "uses_stack",
        reason: `playbook ${playbook.id} uses stack ${playbook.stack_id}`,
      });
    }
  }

  // ── Stacks: components mentioned in choices ──
  for (const stack of stacks) {
    for (const choice of Object.values(stack.choices)) {
      const comps = Array.isArray(choice.recommended) ? choice.recommended : [choice.recommended];
      for (const compId of comps) {
        add(compId, {
          source_id: stack.id,
          source_type: "stack",
          relation: "in_stack_choice",
          reason: `component option in stack ${stack.id}`,
        });
      }
    }
  }

  return backlinks;
}

export function getBacklinks(targetId: string, backlinks: BacklinkMap): Backlink[] {
  return backlinks.get(targetId) ?? [];
}
