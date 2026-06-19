import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { Route } from "../registry/routeSchema.js";
import type { Playbook } from "../registry/playbookSchema.js";
import type { Stack } from "../registry/stackSchema.js";
import type { Registry } from "../registry/registryLoader.js";
import { buildBacklinkMap, getBacklinks, type Backlink, type BacklinkMap } from "./graphBacklinkService.js";
import {
  sanitizeFilename,
  toWikilink,
  buildExportPath,
} from "./markdownLinkService.js";

/**
 * MAR-79 — Obsidian export: main export orchestrator.
 *
 * Transforms the OrchestrateMCP registry (components, edges, routes, playbooks, stacks)
 * into a set of markdown files with wikilinks suitable for Obsidian's graph view.
 */

export type ExportedFile = {
  path: string; // e.g., "components/email_draft.md"
  content: string;
};

export type ExportResult = {
  files: ExportedFile[];
  stats: ExportStats;
  warnings: string[];
};

export type ExportStats = {
  components_exported: number;
  edges_exported: number;
  routes_exported: number;
  playbooks_exported: number;
  stacks_exported: number;
  files_generated: number;
  timestamp: string;
};

export function exportToObsidian(registry: Registry, includeCandidates: boolean = false): ExportResult {
  const files: ExportedFile[] = [];
  const warnings: string[] = [];
  const backlinks = buildBacklinkMap(registry.components, registry.edges, registry.routes, registry.playbooks, registry.stacks);

  const startTime = new Date();

  // ── README ──
  files.push({
    path: "README.md",
    content: buildReadme(registry, includeCandidates, startTime),
  });

  // ── Components ──
  const componentFilter = (c: Component): boolean => includeCandidates || c.status === "published";
  for (const comp of registry.components.filter(componentFilter)) {
    files.push({
      path: buildExportPath("components", comp.id),
      content: buildComponentMarkdown(comp, registry, backlinks),
    });
  }

  // ── Edges ──
  const edgeFilter = (e: Edge): boolean => includeCandidates || e.status === "published";
  for (const edge of registry.edges.filter(edgeFilter)) {
    files.push({
      path: buildExportPath("edges", edge.id),
      content: buildEdgeMarkdown(edge, backlinks),
    });
  }

  // ── Routes ──
  for (const route of registry.routes) {
    files.push({
      path: buildExportPath("routes", route.id),
      content: buildRouteMarkdown(route, registry, backlinks),
    });
  }

  // ── Playbooks ──
  for (const playbook of registry.playbooks) {
    files.push({
      path: buildExportPath("playbooks", playbook.id),
      content: buildPlaybookMarkdown(playbook, registry, backlinks),
    });
  }

  // ── Stacks ──
  for (const stack of registry.stacks) {
    files.push({
      path: buildExportPath("stacks", stack.id),
      content: buildStackMarkdown(stack, registry, backlinks),
    });
  }

  // ── Warnings for broken links ──
  const allExportedIds = new Set([
    ...registry.components.map((c) => c.id),
    ...registry.edges.map((e) => e.id),
    ...registry.routes.map((r) => r.id),
    ...registry.playbooks.map((p) => p.id),
    ...registry.stacks.map((s) => s.id),
  ]);

  // Check for references to non-exported entities (candidates excluded or missing)
  const exportedEdges = registry.edges.filter(edgeFilter);
  for (const edge of exportedEdges) {
    if (!allExportedIds.has(edge.from)) {
      warnings.push(`Edge ${edge.id}: source component ${edge.from} not exported`);
    }
    if (!allExportedIds.has(edge.to)) {
      warnings.push(`Edge ${edge.id}: target component ${edge.to} not exported`);
    }
  }

  return {
    files,
    stats: {
      components_exported: registry.components.filter(componentFilter).length,
      edges_exported: registry.edges.filter(edgeFilter).length,
      routes_exported: registry.routes.length,
      playbooks_exported: registry.playbooks.length,
      stacks_exported: registry.stacks.length,
      files_generated: files.length,
      timestamp: startTime.toISOString(),
    },
    warnings,
  };
}

function buildReadme(registry: Registry, includeCandidates: boolean, timestamp: Date): string {
  const lines: string[] = [
    "# OrchestrateMCP Workflow Graph — Obsidian Vault",
    "",
    `Exported: ${timestamp.toISOString()}`,
    `Include candidates: ${includeCandidates}`,
    "",
    "## How to use this vault",
    "",
    "1. Open this folder in Obsidian (`Open folder as vault`)",
    "2. Use the Graph view (Ctrl/Cmd+G) to see the workflow graph",
    "3. Click any node to open its markdown file",
    "4. Wikilinks like `[[component_id]]` are clickable and navigate the graph",
    "",
    "## Structure",
    "",
    "- **components/** — workflow nodes (agents, tools, transformers, deterministic steps)",
    "- **edges/** — relationships between components (requires, produces_input_for, safer_with, etc.)",
    "- **routes/** — composed workflows (sequences of components for specific goals)",
    "- **playbooks/** — validated, tested workflow templates",
    "- **stacks/** — LLM tier recommendations (frontier, standard, small, none)",
    "",
    "## Key files by type",
    "",
    `Components: ${registry.components.length}`,
    `Edges: ${registry.edges.length}`,
    `Routes: ${registry.routes.length}`,
    `Playbooks: ${registry.playbooks.length}`,
    `Stacks: ${registry.stacks.length}`,
    "",
    "## Notes",
    "",
    "- Obsidian shows published entities by default.",
    "- Candidate (in-development) entities are included if `include_candidates=true` was set during export.",
    "- Backlinks (incoming references) are listed at the bottom of each file.",
    "- Wikilinks are case-insensitive in Obsidian and resolve to the matching markdown file.",
  ];
  return lines.join("\n");
}

function buildComponentMarkdown(
  comp: Component,
  registry: Registry,
  backlinks: BacklinkMap,
): string {
  const lines: string[] = [
    "---",
    `id: ${comp.id}`,
    "type: component",
    `status: ${comp.status}`,
    ...(comp.risk_level ? [`risk_level: ${comp.risk_level}`] : []),
    `last_exported: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${comp.id}`,
    "",
    `**Category:** ${comp.category}`,
    `**Status:** ${comp.status}`,
    `**Risk level:** ${comp.risk_level}`,
    `**Model tier:** ${comp.model_tier}`,
    "",
    ...(comp.summary ? [`${comp.summary}`, ""] : []),
    "",
  ];

  // Capabilities
  if (comp.capabilities && comp.capabilities.length > 0) {
    lines.push("## Capabilities", "", comp.capabilities.map((c) => `- ${c}`).join("\n"), "");
  }

  // Permissions
  if ((comp.permissions.read?.length ?? 0) > 0 || (comp.permissions.write?.length ?? 0) > 0) {
    lines.push("## Permissions", "");
    if (comp.permissions.read?.length) {
      lines.push("**Read:**", comp.permissions.read.map((p) => `- ${p}`).join("\n"), "");
    }
    if (comp.permissions.write?.length) {
      lines.push("**Write:**", comp.permissions.write.map((p) => `- ${p}`).join("\n"), "");
    }
  }

  // Outgoing edges
  const outgoing = registry.edges.filter((e) => e.from === comp.id && e.status === "published");
  if (outgoing.length > 0) {
    lines.push("## Relationships");
    lines.push("");
    const byRelation = new Map<string, typeof outgoing>();
    for (const edge of outgoing) {
      if (!byRelation.has(edge.relation)) byRelation.set(edge.relation, []);
      byRelation.get(edge.relation)!.push(edge);
    }
    for (const [relation, edges] of byRelation) {
      lines.push(`**${relation}:**`);
      for (const edge of edges) {
        lines.push(`- ${toWikilink(edge.to)} (${edge.relation})`);
      }
      lines.push("");
    }
  }

  // Backlinks / used by
  const incomingLinks = getBacklinks(comp.id, backlinks).filter((b) => b.source_type === "component" || b.source_type === "route" || b.source_type === "playbook");
  if (incomingLinks.length > 0) {
    lines.push("## Used by", "");
    for (const link of incomingLinks) {
      lines.push(`- ${toWikilink(link.source_id)} (${link.relation})`);
    }
    lines.push("");
  }

  // Test coverage
  const totalEvals = (comp.tested_in_playbooks?.length ?? 0) + (comp.tested_in_routes?.length ?? 0);
  if (totalEvals > 0) {
    lines.push("## Test coverage", "");
    if (comp.tested_in_playbooks && comp.tested_in_playbooks.length > 0) {
      lines.push(`**Playbooks:** ${comp.tested_in_playbooks.join(", ")}`);
    }
    if (comp.tested_in_routes && comp.tested_in_routes.length > 0) {
      lines.push(`**Routes:** ${comp.tested_in_routes.join(", ")}`);
    }
    lines.push("");
  } else {
    lines.push("## Test coverage", "", "❌ No test coverage yet", "");
  }

  return lines.join("\n");
}

function buildEdgeMarkdown(edge: Edge, backlinks: BacklinkMap): string {
  const lines: string[] = [
    "---",
    `id: ${edge.id}`,
    "type: edge",
    `from: ${edge.from}`,
    `to: ${edge.to}`,
    `relation: ${edge.relation}`,
    `status: ${edge.status}`,
    `severity: ${edge.severity}`,
    `tested: ${edge.tested}`,
    `last_exported: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${edge.id}`,
    "",
    `**From:** ${toWikilink(edge.from)}`,
    `**To:** ${toWikilink(edge.to)}`,
    `**Relation:** ${edge.relation}`,
    `**Severity:** ${edge.severity}`,
    `**Tested:** ${edge.tested ? "✓" : "❌"}`,
    "",
    ...(edge.reason ? [`## Reason`, "", edge.reason, ""] : []),
    ...(edge.notes ? [`## Notes`, "", edge.notes, ""] : []),
  ];

  if (edge.tested && edge.test_refs && edge.test_refs.length > 0) {
    lines.push("## Test references", "", edge.test_refs.join(", "), "");
  }

  return lines.join("\n");
}

function buildRouteMarkdown(route: Route, registry: Registry, backlinks: BacklinkMap): string {
  const lines: string[] = [
    "---",
    `id: ${route.id}`,
    "type: route",
    `status: ${route.status}`,
    `last_exported: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${route.id}`,
    "",
    `**Name:** ${route.name}`,
    `**Status:** ${route.status}`,
    `**Risk level:** ${route.risk_level}`,
    "",
    ...(route.summary ? [`${route.summary}`, ""] : []),
    "",
    "## Components",
    "",
    route.components.map((compId) => `- ${toWikilink(compId)}`).join("\n"),
    "",
  ];

  const usedInPlaybooks = registry.playbooks.filter((p) => p.golden_path_route_id === route.id);
  if (usedInPlaybooks.length > 0) {
    lines.push("## Used in playbooks", "");
    for (const pb of usedInPlaybooks) {
      lines.push(`- ${toWikilink(pb.id)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPlaybookMarkdown(playbook: Playbook, registry: Registry, backlinks: BacklinkMap): string {
  const lines: string[] = [
    "---",
    `id: ${playbook.id}`,
    "type: playbook",
    `status: ${playbook.status}`,
    `last_exported: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${playbook.id}`,
    "",
    `**Title:** ${playbook.title}`,
    `**Type:** ${playbook.workflow_type}`,
    `**Risk level:** ${playbook.risk_level}`,
    ...(playbook.golden_path_route_id ? [`**Route:** ${toWikilink(playbook.golden_path_route_id)}`] : []),
    ...(playbook.stack_id ? [`**Stack:** ${toWikilink(playbook.stack_id)}`] : []),
    "",
    ...(playbook.summary ? [`${playbook.summary}`, ""] : []),
    "",
    "## Components",
    "",
    playbook.components.map((compId) => `- ${toWikilink(compId)}`).join("\n"),
    "",
  ];

  if (playbook.best_for && playbook.best_for.length > 0) {
    lines.push("## Best for", "");
    lines.push(playbook.best_for.map((t) => `- ${t}`).join("\n"), "");
  }

  if (playbook.avoid_when && playbook.avoid_when.length > 0) {
    lines.push("## Avoid when", "");
    lines.push(playbook.avoid_when.map((t) => `- ${t}`).join("\n"), "");
  }

  return lines.join("\n");
}

function buildStackMarkdown(stack: Stack, registry: Registry, backlinks: BacklinkMap): string {
  const lines: string[] = [
    "---",
    `id: ${stack.id}`,
    "type: stack",
    `status: ${stack.status}`,
    `last_exported: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${stack.id}`,
    "",
    `**Name:** ${stack.name}`,
    `**Status:** ${stack.status}`,
    "",
    ...(stack.summary ? [`${stack.summary}`, ""] : []),
    "",
    "## Choices",
    "",
  ];

  for (const [choiceName, choice] of Object.entries(stack.choices)) {
    const recommended = Array.isArray(choice.recommended) ? choice.recommended : [choice.recommended];
    lines.push(`### ${choiceName}`, "");
    lines.push("**Recommended:**");
    for (const compId of recommended) {
      lines.push(`- ${toWikilink(compId)}`);
    }
    if (choice.alternatives && choice.alternatives.length > 0) {
      lines.push("", "**Alternatives:**");
      for (const compId of choice.alternatives) {
        lines.push(`- ${toWikilink(compId)}`);
      }
    }
    if (choice.reason) {
      lines.push("", `**Why:** ${choice.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
