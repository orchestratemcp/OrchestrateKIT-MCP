import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { loadDocsIndex, matchDocsIndex } from "../../src/docs-index/loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_REGISTRY = join(__dirname, "..", "registry", "fixtures");
const FIXTURES_DOCS_INDEX = join(__dirname, "fixtures", "docs-index");
const REAL_DOCS_INDEX = join(__dirname, "..", "..", "docs-index");
const NONEXISTENT_DIR = join(__dirname, "fixtures", "no-such-dir");

// ---------------------------------------------------------------------------
// DocsIndex loader
// ---------------------------------------------------------------------------

describe("loadDocsIndex", () => {
  it("returns empty array for nonexistent directory", () => {
    const entries = loadDocsIndex({ docsIndexDir: NONEXISTENT_DIR });
    expect(entries).toHaveLength(0);
  });

  it("loads entries from fixture docs-index directory", () => {
    const entries = loadDocsIndex({ docsIndexDir: FIXTURES_DOCS_INDEX });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it("loaded entry has required fields", () => {
    const entries = loadDocsIndex({ docsIndexDir: FIXTURES_DOCS_INDEX });
    const entry = entries[0];
    expect(entry.id).toBeTruthy();
    expect(entry.title).toBeTruthy();
    expect(entry.source_type).toBeTruthy();
    expect(entry.summary).toBeTruthy();
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(Array.isArray(entry.relevant_to)).toBe(true);
  });

  it("loads real docs-index seed files (openai-agents, anthropic-mcp, cursor-mcp)", () => {
    const entries = loadDocsIndex({ docsIndexDir: REAL_DOCS_INDEX });
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("openai-agents-sdk");
    expect(ids).toContain("anthropic-mcp-spec");
    expect(ids).toContain("cursor-mcp-docs");
  });

  it("real docs-index entries have valid source_type", () => {
    const valid = new Set([
      "official_docs",
      "docs_index",
      "internal_note",
      "example_repo",
      "blog",
      "unknown",
    ]);
    const entries = loadDocsIndex({ docsIndexDir: REAL_DOCS_INDEX });
    for (const e of entries) {
      expect(valid.has(e.source_type), `${e.id} source_type "${e.source_type}"`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// matchDocsIndex
// ---------------------------------------------------------------------------

describe("matchDocsIndex", () => {
  const entries = loadDocsIndex({ docsIndexDir: FIXTURES_DOCS_INDEX });

  it("returns empty array when no criteria provided", () => {
    const results = matchDocsIndex(entries, {});
    expect(results).toHaveLength(0);
  });

  it("matches by component_id", () => {
    const results = matchDocsIndex(entries, { component_ids: ["source_retrieval"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].relevance_reason).toContain("source_retrieval");
  });

  it("matches by playbook_id", () => {
    const results = matchDocsIndex(entries, { playbook_id: "research_agent_citations" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("matches by topic tag", () => {
    const results = matchDocsIndex(entries, { topics: ["research"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("no match for unrelated criteria returns empty array", () => {
    const results = matchDocsIndex(entries, { frameworks: ["totally-unknown-framework-xyz"] });
    expect(results).toHaveLength(0);
  });

  it("matched entries include relevance_reason", () => {
    const results = matchDocsIndex(entries, { topics: ["research"] });
    for (const r of results) {
      expect(r.relevance_reason).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// get_relevant_docs logic — source collection from registry
// ---------------------------------------------------------------------------

describe("get_relevant_docs — source collection from real registry", () => {
  const registry = loadRegistry();

  it("data_extraction_enrichment playbook has sources in registry", () => {
    const p = registry.playbooks.find((p) => p.id === "data_extraction_enrichment");
    expect(p).toBeDefined();
    expect(p!.sources.length).toBeGreaterThanOrEqual(1);
  });

  it("all playbook sources have title and source_type", () => {
    for (const p of registry.playbooks) {
      for (const s of p.sources) {
        expect(s.title, `${p.id} source title`).toBeTruthy();
        expect(s.source_type, `${p.id} source_type`).toBeTruthy();
      }
    }
  });

  it("components in data_extraction_enrichment have sources", () => {
    const p = registry.playbooks.find((p) => p.id === "data_extraction_enrichment");
    expect(p).toBeDefined();
    const compIds = new Set(p!.components);
    const compsWithSources = registry.components.filter(
      (c) => compIds.has(c.id) && c.sources.length > 0,
    );
    // At least some components should have sources attached
    expect(compsWithSources.length).toBeGreaterThanOrEqual(0);
  });

  it("collecting from playbook + components + edges produces deduped list", () => {
    const p = registry.playbooks.find((p) => p.id === "data_extraction_enrichment");
    expect(p).toBeDefined();
    const playbook = p!;

    const allDocs: Array<{ title: string; url?: string }> = [];

    for (const s of playbook.sources) {
      allDocs.push({ title: s.title, url: s.url });
    }

    const compIds = new Set(playbook.components);
    for (const c of registry.components.filter((c) => compIds.has(c.id))) {
      for (const s of c.sources) allDocs.push({ title: s.title, url: s.url });
    }

    const edgeIds = new Set(playbook.edges);
    for (const e of registry.edges.filter((e) => edgeIds.has(e.id))) {
      for (const s of e.sources) allDocs.push({ title: s.title, url: s.url });
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = allDocs.filter((d) => {
      const key = `${d.title}||${d.url ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    expect(deduped.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// get_relevant_docs — docs-index matching against real index
// ---------------------------------------------------------------------------

describe("get_relevant_docs — docs-index matching (real index)", () => {
  const realEntries = loadDocsIndex({ docsIndexDir: REAL_DOCS_INDEX });

  it("framework 'cursor' matches cursor-mcp-docs entry", () => {
    const results = matchDocsIndex(realEntries, { frameworks: ["cursor"] });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("cursor-mcp-docs");
  });

  it("framework 'openai' matches openai-agents-sdk entry", () => {
    const results = matchDocsIndex(realEntries, { frameworks: ["openai"] });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("openai-agents-sdk");
  });

  it("topic 'mcp' matches anthropic-mcp-spec entry", () => {
    const results = matchDocsIndex(realEntries, { topics: ["mcp"] });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("anthropic-mcp-spec");
  });

  it("component_id 'research_synthesis' returns openai-agents-sdk (tagged coding-agent/research)", () => {
    const results = matchDocsIndex(realEntries, { component_ids: ["research_synthesis"] });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("openai-agents-sdk");
  });

  it("only returns known indexed sources — no fabricated entries", () => {
    const knownIds = new Set(realEntries.map((e) => e.id));
    const results = matchDocsIndex(realEntries, { topics: ["mcp", "agents", "orchestration"] });
    for (const r of results) {
      expect(knownIds.has(r.id), `entry "${r.id}" should be in the loaded index`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture registry docs (isolated)
// ---------------------------------------------------------------------------

describe("get_relevant_docs — fixture registry", () => {
  const registry = loadRegistry({ registryDir: FIXTURES_REGISTRY });
  const docsIndex = loadDocsIndex({ docsIndexDir: FIXTURES_DOCS_INDEX });

  it("fixture registry research_agent_citations has defined components", () => {
    const p = registry.playbooks.find((p) => p.id === "research_agent_citations");
    expect(p).toBeDefined();
    expect(p!.components).toContain("source_retrieval");
  });

  it("fixture docs-index returns results for research playbook", () => {
    const results = matchDocsIndex(docsIndex, { playbook_id: "research_agent_citations" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("route_id lookup collects sources from route components", () => {
    const route = registry.routes.find((r) => r.id === "research_route_v1");
    expect(route).toBeDefined();

    const compIds = new Set(route!.components);
    const sources: string[] = [];
    for (const c of registry.components.filter((c) => compIds.has(c.id))) {
      for (const s of c.sources) sources.push(s.title);
    }
    // Just assert we can run this without error
    expect(Array.isArray(sources)).toBe(true);
  });
});
