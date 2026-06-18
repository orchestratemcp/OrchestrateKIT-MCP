/**
 * MAR-136: plain-language register (audience: operator).
 *
 * explain_component is a non-technical alternative to get_graph_component.
 * Where get_graph_component returns structured JSON fields and markdown for
 * developers, explain_component renders plain conversational prose intended for
 * a non-technical workflow builder — someone assembling an AI agent on
 * ChatGPT / Claude Cowork who does not know what "schema_validation" or
 * "produces_input_for" mean.
 *
 * Output contract:
 *  - No raw component IDs in the body text (names are used instead).
 *  - No YAML field names or technical enum values.
 *  - Risk level translated to a plain-English consequence statement.
 *  - Relations translated to natural-language connectors.
 *  - Failure modes rephrased as "watch out for..." bullets.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryProvider.js";
import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { freshnessLabel } from "../lib/freshness.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const InputShape = {
  component_id: z.string().min(1).describe(
    "The id of the component to explain (e.g. 'human_approval_gate', 'data_scraper').",
  ),
};

// ---------------------------------------------------------------------------
// Plain-language helpers
// ---------------------------------------------------------------------------

function riskStatement(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "Low-risk step — generally safe to run automatically.";
    case "medium":
      return "Medium-risk step — review the output before letting it feed into a write operation.";
    case "high":
      return "High-risk step — should always be paired with a human approval check before it runs.";
    case "critical":
      return "Critical-risk step — requires explicit human sign-off and audit logging every time it executes.";
    default:
      return `Risk level: ${riskLevel}.`;
  }
}

function categoryStatement(category: string): string {
  const labels: Record<string, string> = {
    input: "data source or trigger",
    processing: "data transformation step",
    state: "state management component",
    safety: "safety and control checkpoint",
    tool: "tool or external lookup",
    output: "content generation or output step",
    eval: "evaluation and scoring step",
    orchestration: "workflow routing or orchestration",
    integration: "external service integration",
  };
  return labels[category] ?? category;
}

function relationPhrase(relation: string): string {
  const phrases: Record<string, string> = {
    produces_input_for: "feeds its output to",
    requires: "must always be paired with",
    safer_with: "works more safely when paired with",
    compatible_with: "works well alongside",
    recommended_for: "is recommended before",
    before: "should run before",
    tested: "has been tested with",
    avoid_when: "should be avoided together with",
  };
  return phrases[relation] ?? relation;
}

function componentName(id: string, components: Component[]): string {
  const c = components.find((x) => x.id === id);
  return c ? c.name : id;
}

function renderPlainText(
  component: Component,
  outgoing: Edge[],
  incoming: Edge[],
  components: Component[],
): string {
  const lines: string[] = [];

  // ── Header ──
  lines.push(`# ${component.name}`);
  lines.push(``);
  lines.push(component.summary.trim());
  lines.push(``);

  // ── At a glance ──
  lines.push(`**Type:** ${categoryStatement(component.category)}`);
  lines.push(`**Risk:** ${riskStatement(component.risk_level)}`);
  lines.push(``);

  // ── What it needs ──
  if (component.inputs.length > 0) {
    lines.push(`## What it needs as input`);
    for (const inp of component.inputs) {
      lines.push(`- ${inp}`);
    }
    lines.push(``);
  }

  // ── What it produces ──
  if (component.outputs.length > 0) {
    lines.push(`## What it produces`);
    for (const out of component.outputs) {
      lines.push(`- ${out}`);
    }
    lines.push(``);
  }

  // ── Required partners ──
  if (component.requires.length > 0) {
    lines.push(`## Required partners`);
    lines.push(`This component cannot be used safely on its own. It must always be paired with:`);
    for (const req of component.requires) {
      const name = componentName(req, components);
      lines.push(`- **${name}** — required for safe operation`);
    }
    lines.push(``);
  }

  // ── Recommended partners ──
  if (component.recommended_with.length > 0) {
    lines.push(`## Recommended partners`);
    lines.push(`These components work best alongside it:`);
    for (const rec of component.recommended_with) {
      const name = componentName(rec, components);
      lines.push(`- **${name}**`);
    }
    lines.push(``);
  }

  // ── Connections ──
  const meaningful = outgoing.filter(
    (e) => !["tested", "avoid_when"].includes(e.relation),
  );
  if (meaningful.length > 0) {
    lines.push(`## How it connects to other steps`);
    for (const e of meaningful) {
      const targetName = componentName(e.to, components);
      const phrase = relationPhrase(e.relation);
      lines.push(`- It **${phrase}** **${targetName}**${e.notes ? ` — ${e.notes}` : ""}`);
    }
    lines.push(``);
  }

  // ── Incoming from ──
  const incomingMeaningful = incoming.filter(
    (e) => e.relation === "produces_input_for",
  );
  if (incomingMeaningful.length > 0) {
    lines.push(`## What typically comes before it`);
    for (const e of incomingMeaningful) {
      const sourceName = componentName(e.from, components);
      lines.push(`- **${sourceName}** feeds its output into this step`);
    }
    lines.push(``);
  }

  // ── Side effects ──
  if (component.side_effects.length > 0) {
    lines.push(`## Side effects (what it changes outside the workflow)`);
    for (const se of component.side_effects) {
      lines.push(`- ${se}`);
    }
    lines.push(``);
  }

  // ── Failure modes ──
  if (component.failure_modes.length > 0) {
    lines.push(`## Watch out for`);
    for (const fm of component.failure_modes) {
      lines.push(`- ${fm}`);
    }
    lines.push(``);
  }

  // ── Avoid with ──
  if (component.avoid_with.length > 0) {
    lines.push(`## Do not use together with`);
    for (const av of component.avoid_with) {
      const name = componentName(av, components);
      lines.push(`- **${name}** — using both in the same workflow can cause problems`);
    }
    lines.push(``);
  }

  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerExplainComponent(server: McpServer): void {
  server.registerTool(
    "explain_component",
    {
      title: "Explain Component",
      description:
        "Returns a plain-language, operator-friendly explanation of a single workflow " +
        "component — what it does, what it needs, what it produces, which other steps " +
        "it connects to, and what can go wrong. Intended for non-technical builders who " +
        "are assembling an AI agent without deep technical knowledge. " +
        "Use get_graph_component instead when you need structured JSON fields for " +
        "programmatic processing or technical documentation.",
      inputSchema: InputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });
        const component = registry.components.find((c) => c.id === input.component_id);

        if (!component) {
          logger.debug(`explain_component → not_found: ${input.component_id}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "not_found",
                  message: `No component found with id "${input.component_id}". Use list_graph_components to see available component ids.`,
                }),
              },
            ],
          };
        }

        const outgoing = registry.edges.filter((e) => e.from === component.id);
        const incoming = registry.edges.filter((e) => e.to === component.id);

        const prose = renderPlainText(
          component,
          outgoing,
          incoming,
          registry.components,
        );

        const mtime = registry.componentMtimes.get(component.id);
        const last_updated = mtime ? mtime.toISOString().slice(0, 10) : null;
        const freshness = mtime ? freshnessLabel(mtime) : "unknown";

        logger.debug(`explain_component → ${component.id}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ok",
                component_id: component.id,
                name: component.name,
                last_updated,
                freshness,
                explanation: prose,
              }),
            },
          ],
        };
      } catch (err) {
        logger.error("explain_component failed", err);
        return toErrorResult(err);
      }
    },
  );
}
