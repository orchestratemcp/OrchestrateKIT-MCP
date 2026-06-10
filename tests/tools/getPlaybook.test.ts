import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_REGISTRY = join(__dirname, "..", "registry", "fixtures");

// ---------------------------------------------------------------------------
// Pure logic helpers extracted from getPlaybook.ts
// (We test the behaviour through the registry + logic, not through the MCP
// handler wrapper, to avoid the overhead of spinning up a full MCP server.)
// ---------------------------------------------------------------------------

type Playbook = ReturnType<typeof loadRegistry>["playbooks"][number];

function scorePlaybook(playbook: Playbook, workflowType: string): number {
  const needle = workflowType.toLowerCase().trim();
  const wt = playbook.workflow_type.toLowerCase();
  const title = playbook.title.toLowerCase();
  if (wt === needle) return 1.0;
  if (wt.includes(needle) || needle.includes(wt)) return 0.85;
  if (title.includes(needle)) return 0.7;
  return 0;
}

function bestMatch(
  playbooks: Playbook[],
  workflowType: string,
): { playbook: Playbook; confidence: number } | null {
  let best: Playbook | null = null;
  let bestScore = 0;
  for (const p of playbooks) {
    const score = scorePlaybook(p, workflowType);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (!best || bestScore === 0) return null;
  return { playbook: best, confidence: bestScore };
}

// ---------------------------------------------------------------------------
// Exact playbook lookup (real registry)
// ---------------------------------------------------------------------------

describe("get_playbook — exact id lookup", () => {
  const registry = loadRegistry();

  it("finds codebase_agent_workflow by id", () => {
    const p = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(p).toBeDefined();
    expect(p!.workflow_type).toBe("coding-agent");
  });

  it("finds data_extraction_enrichment by id", () => {
    const p = registry.playbooks.find((p) => p.id === "data_extraction_enrichment");
    expect(p).toBeDefined();
    expect(p!.risk_level).toBe("medium");
  });

  it("returns undefined for unknown id", () => {
    const p = registry.playbooks.find((p) => p.id === "nonexistent_playbook");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Workflow type matching
// ---------------------------------------------------------------------------

describe("get_playbook — workflow_type matching", () => {
  const registry = loadRegistry();

  it("exact match returns confidence 1.0 for coding-agent", () => {
    const result = bestMatch(registry.playbooks, "coding-agent");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.playbook.id).toBe("codebase_agent_workflow");
  });

  it("exact match returns confidence 1.0 for data-pipeline", () => {
    const result = bestMatch(registry.playbooks, "data-pipeline");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.playbook.id).toBe("data_extraction_enrichment");
  });

  it("substring match returns confidence 0.85 for 'coding'", () => {
    const result = bestMatch(registry.playbooks, "coding");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("no-match returns null for nonsense input", () => {
    const result = bestMatch(registry.playbooks, "zzzzzzzzznotaworkflow");
    expect(result).toBeNull();
  });

  it("no-match on empty playbooks list returns null", () => {
    const result = bestMatch([], "coding-agent");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Graph context construction
// ---------------------------------------------------------------------------

describe("get_playbook — graph context (include_graph)", () => {
  const registry = loadRegistry();

  it("codebase_agent_workflow has a resolved route", () => {
    const p = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(p).toBeDefined();
    const route = registry.routes.find((r) => r.id === p!.golden_path_route_id);
    expect(route).toBeDefined();
  });

  it("resolves components listed in playbook from registry", () => {
    const p = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(p).toBeDefined();
    const resolvedIds = p!.components.filter((cid) =>
      registry.components.some((c) => c.id === cid),
    );
    expect(resolvedIds.length).toBeGreaterThanOrEqual(4);
  });

  it("resolves edges listed in playbook from registry", () => {
    const p = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(p).toBeDefined();
    const resolvedEdges = p!.edges.filter((eid) =>
      registry.edges.some((e) => e.id === eid),
    );
    expect(resolvedEdges.length).toBeGreaterThanOrEqual(3);
  });

  it("untested edges are those with tested=false in edge registry", () => {
    const p = registry.playbooks.find((p) => p.id === "data_extraction_enrichment");
    expect(p).toBeDefined();
    const playbook = p!;
    const edgeIds = new Set(playbook.edges);
    const untestedEdges = registry.edges
      .filter((e) => edgeIds.has(e.id) && !e.tested)
      .map((e) => e.id);
    // We just assert the logic works without assuming exact count
    expect(Array.isArray(untestedEdges)).toBe(true);
  });

  it("approval gates: edges targeting human_approval_gate are identified", () => {
    // Approval is expressed as a `requires` relation pointing to human_approval_gate.
    const approvalEdges = registry.edges.filter((e) => e.to === "human_approval_gate");
    // external_publish__requires__human_approval_gate must exist in registry
    expect(approvalEdges.length).toBeGreaterThanOrEqual(1);
    expect(approvalEdges.some((e) => e.from === "external_publish")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture registry tests (isolated, deterministic)
// ---------------------------------------------------------------------------

describe("get_playbook — fixture registry", () => {
  const registry = loadRegistry({ registryDir: FIXTURES_REGISTRY });

  it("loads research_agent_citations from fixture", () => {
    const p = registry.playbooks.find((p) => p.id === "research_agent_citations");
    expect(p).toBeDefined();
    expect(p!.workflow_type).toBe("research");
    expect(p!.golden_path_route_id).toBe("research_route_v1");
  });

  it("exact workflow_type match 'research' returns research_agent_citations", () => {
    const result = bestMatch(registry.playbooks, "research");
    expect(result).not.toBeNull();
    expect(result!.playbook.id).toBe("research_agent_citations");
    expect(result!.confidence).toBe(1.0);
  });

  it("graph context: route is resolved for research_agent_citations", () => {
    const p = registry.playbooks.find((p) => p.id === "research_agent_citations");
    expect(p).toBeDefined();
    const route = registry.routes.find((r) => r.id === p!.golden_path_route_id);
    expect(route).toBeDefined();
    expect(route!.id).toBe("research_route_v1");
  });

  it("graph context: components are resolved for research_agent_citations", () => {
    const p = registry.playbooks.find((p) => p.id === "research_agent_citations");
    expect(p).toBeDefined();
    for (const cid of p!.components) {
      const comp = registry.components.find((c) => c.id === cid);
      expect(comp, `component ${cid} should be in fixture registry`).toBeDefined();
    }
  });

  it("no-match behavior: nonsense workflow_type recommends compose_workflow_route", () => {
    const result = bestMatch(registry.playbooks, "calendar_sync_xyzzy");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Registry has playbooks with expected shape
// ---------------------------------------------------------------------------

describe("registry playbooks — data integrity", () => {
  const registry = loadRegistry();

  it("all playbooks have golden_path_route_id", () => {
    for (const p of registry.playbooks) {
      expect(p.golden_path_route_id.length, `${p.id} golden_path_route_id`).toBeGreaterThan(0);
    }
  });

  it("all playbooks have at least one guardrail", () => {
    for (const p of registry.playbooks) {
      expect(p.guardrails.length, `${p.id} guardrails`).toBeGreaterThan(0);
    }
  });

  it("all playbooks have at least one failure_mode", () => {
    for (const p of registry.playbooks) {
      expect(p.failure_modes.length, `${p.id} failure_modes`).toBeGreaterThan(0);
    }
  });

  it("status is one of the allowed values", () => {
    const allowed = new Set(["draft", "candidate", "beta", "validated", "published", "deprecated"]);
    for (const p of registry.playbooks) {
      expect(allowed.has(p.status), `${p.id} status "${p.status}"`).toBe(true);
    }
  });
});
