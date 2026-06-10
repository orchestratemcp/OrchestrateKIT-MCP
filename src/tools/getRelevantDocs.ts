import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRegistry } from "../registry/registryLoader.js";
import { loadDocsIndex, matchDocsIndex } from "../docs-index/loader.js";
import type { Source } from "../registry/sharedSchemas.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const InputShape = {
  playbook_id: z.string().optional().describe(
    "Pull sources from this playbook and its component/edge members.",
  ),
  route_id: z.string().optional().describe(
    "Pull sources from the edges and components referenced by this route.",
  ),
  component_ids: z.array(z.string()).default([]).describe(
    "Pull sources from these specific component ids.",
  ),
  frameworks: z.array(z.string()).default([]).describe(
    "Match docs-index entries by framework tag (e.g. 'openai', 'cursor', 'anthropic').",
  ),
  topics: z.array(z.string()).default([]).describe(
    "Match docs-index entries by topic tag (e.g. 'mcp', 'agents', 'orchestration').",
  ),
  max_results: z.number().min(1).max(50).default(20).describe(
    "Maximum number of doc results to return.",
  ),
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

type DocResult = {
  title: string;
  url?: string;
  source_type: string;
  last_checked?: string;
  relevance_reason: string;
};

type GetRelevantDocsOutput = {
  status: "ok" | "empty";
  summary_markdown: string;
  docs: DocResult[];
  warnings: string[];
  next_recommended_tools: string[];
};

// ---------------------------------------------------------------------------
// Source collection helpers
// ---------------------------------------------------------------------------

function sourceToDoc(source: Source, reason: string): DocResult {
  return {
    title: source.title,
    url: source.url,
    source_type: source.source_type,
    last_checked: source.last_checked,
    relevance_reason: reason,
  };
}

/** Deduplicate by (title + url). Last writer wins. */
function deduplicateDocs(docs: DocResult[]): DocResult[] {
  const seen = new Map<string, DocResult>();
  for (const doc of docs) {
    const key = `${doc.title}||${doc.url ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, doc);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerGetRelevantDocs(server: McpServer): void {
  server.registerTool(
    "get_relevant_docs",
    {
      title: "Get Relevant Docs",
      description:
        "Returns documentation and source references relevant to a playbook, route, " +
        "set of components, or framework/topic from the workflow graph registry and the " +
        "internal docs-index. Only returns known indexed/internal sources — never fabricates " +
        "official documentation. Internal seed sources are labelled as 'internal_note'. " +
        "Use playbook_id or route_id to narrow to a specific workflow. " +
        "Use frameworks/topics for broad technology-level references.",
      inputSchema: InputShape,
    },
    async (input) => {
      try {
        const registry = loadRegistry({ includeBeta: true });
        const docsIndex = loadDocsIndex();

        const collected: DocResult[] = [];
        const warnings: string[] = [];

        // 1. Sources from playbook
        if (input.playbook_id) {
          const playbook = registry.playbooks.find((p) => p.id === input.playbook_id);
          if (!playbook) {
            warnings.push(
              `Playbook "${input.playbook_id}" not found in the loaded registry.`,
            );
          } else {
            for (const s of playbook.sources) {
              collected.push(sourceToDoc(s, `From playbook "${playbook.id}"`));
            }

            // Also pull sources from playbook's components and edges
            const compIds = new Set(playbook.components);
            const edgeIds = new Set(playbook.edges);

            for (const c of registry.components.filter((c) => compIds.has(c.id))) {
              for (const s of c.sources) {
                collected.push(sourceToDoc(s, `From component "${c.id}" (in playbook "${playbook.id}")`));
              }
            }

            for (const e of registry.edges.filter((e) => edgeIds.has(e.id))) {
              for (const s of e.sources) {
                collected.push(sourceToDoc(s, `From edge "${e.id}" (in playbook "${playbook.id}")`));
              }
            }
          }
        }

        // 2. Sources from route
        if (input.route_id) {
          const route = registry.routes.find((r) => r.id === input.route_id);
          if (!route) {
            warnings.push(
              `Route "${input.route_id}" not found in the loaded registry.`,
            );
          } else {
            const compIds = new Set(route.components);
            const edgeIds = new Set(route.edges);

            for (const c of registry.components.filter((c) => compIds.has(c.id))) {
              for (const s of c.sources) {
                collected.push(sourceToDoc(s, `From component "${c.id}" (in route "${route.id}")`));
              }
            }

            for (const e of registry.edges.filter((e) => edgeIds.has(e.id))) {
              for (const s of e.sources) {
                collected.push(sourceToDoc(s, `From edge "${e.id}" (in route "${route.id}")`));
              }
            }
          }
        }

        // 3. Sources from explicitly listed component ids
        if (input.component_ids.length > 0) {
          for (const cid of input.component_ids) {
            const comp = registry.components.find((c) => c.id === cid);
            if (!comp) {
              warnings.push(`Component "${cid}" not found in the loaded registry.`);
              continue;
            }
            for (const s of comp.sources) {
              collected.push(sourceToDoc(s, `From component "${comp.id}"`));
            }
          }
        }

        // 4. Docs-index matches by frameworks + topics + component/playbook/route ids
        const indexMatches = matchDocsIndex(docsIndex, {
          playbook_id: input.playbook_id,
          route_id: input.route_id,
          component_ids: input.component_ids,
          frameworks: input.frameworks,
          topics: input.topics,
        });

        for (const entry of indexMatches) {
          const isInternal = entry.source_type === "internal_note";
          const typeLabel = isInternal ? " (internal note — not official docs)" : "";
          collected.push({
            title: entry.title,
            url: entry.url,
            source_type: entry.source_type,
            last_checked: entry.last_checked,
            relevance_reason: `${entry.relevance_reason}${typeLabel}. ${entry.summary.trim()}`,
          });
        }

        // 5. Warn if nothing found at all but input was provided
        const hasAnyInput =
          input.playbook_id ||
          input.route_id ||
          input.component_ids.length > 0 ||
          input.frameworks.length > 0 ||
          input.topics.length > 0;

        if (collected.length === 0 && hasAnyInput) {
          warnings.push(
            "No documentation sources found for the provided criteria. " +
            "The registry entities may not have sources attached yet, " +
            "or the docs-index has no entries matching your frameworks/topics.",
          );
        }

        const deduped = deduplicateDocs(collected).slice(0, input.max_results);

        // --- Markdown summary ---
        const lines: string[] = [
          `## Relevant docs (${deduped.length})`,
          ``,
        ];

        if (deduped.length === 0) {
          lines.push("No documentation sources found for the provided criteria.");
        } else {
          for (const doc of deduped) {
            const urlPart = doc.url ? ` — [${doc.url}](${doc.url})` : "";
            lines.push(`### ${doc.title}${urlPart}`);
            lines.push(`**Type:** \`${doc.source_type}\``);
            if (doc.last_checked) lines.push(`**Last checked:** ${doc.last_checked}`);
            lines.push(`**Why:** ${doc.relevance_reason}`);
            lines.push(``)
          }
        }

        const output: GetRelevantDocsOutput = {
          status: deduped.length > 0 ? "ok" : "empty",
          summary_markdown: lines.join("\n"),
          docs: deduped,
          warnings,
          next_recommended_tools: [
            "get_playbook",
            "get_graph_component",
            "get_route",
          ],
        };

        logger.debug(`get_relevant_docs → ${deduped.length} docs`);
        return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
      } catch (err) {
        logger.error("get_relevant_docs failed", err);
        return toErrorResult(err);
      }
    },
  );
}
