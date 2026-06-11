# OrchestrateKit MCP

Local stdio MCP server that gives Cursor and Claude Desktop access to an opinionated, evidence-backed **workflow graph** for designing production-ready AI workflows.

**Status:** M2.5 complete — full registry (33 components, 54 edges, 2 stacks, 6 routes, 6 playbooks), 13 tools, benchmark protocol v2.

---

## What it does

OrchestrateKit MCP exposes a structured registry of:

```
components  →  the building blocks of AI workflows
edges       →  tested relations between components (requires, safer_with, conflicts_with, …)
stacks      →  opinionated technology choices for different deployment contexts
routes      →  tested paths through the component graph
playbooks   →  golden-path routes with full implementation guidance
```

When a user describes a workflow goal, the MCP can:

1. Match the goal to required capabilities and components.
2. Traverse tested component relationships.
3. Reuse sections of known golden-path playbooks.
4. Compose a candidate route when no exact playbook exists.
5. Score route confidence (coverage, tested edges, stack fit, safety, simplicity).
6. Return the route as structured implementation context for Cursor or Claude.

---

## What works right now

- MCP server starts on stdio with 13 registered tools.
- `health_check` returns `{ name, version, registry: { component_count, edge_count, stack_count, route_count, playbook_count, untested_edge_pct } }`.
- Registry loaded from YAML: 33 components, 54 edges, 2 stacks, 6 routes, 6 playbooks.
- `pnpm verify` (typecheck + lint + tests) passes from a clean clone and install.

---

## Requirements

- Node.js ≥ 20
- pnpm

---

## Local setup

```bash
cd orchestratekit-mcp
pnpm install
pnpm verify        # typecheck + tests — must pass before anything else
pnpm dev           # starts the MCP server on stdio
```

The server reads from `stdin` and writes JSON-RPC to `stdout`. All log output goes to `stderr`.

---

## Connect from Cursor

Copy `examples/cursor-mcp.json` content into your Cursor workspace MCP config at `.cursor/mcp.json`. Replace the `cwd` value with the absolute path to this directory.

```json
{
  "mcpServers": {
    "orchestratekit": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/absolute/path/to/orchestratekit-mcp"
    }
  }
}
```

---

## Connect from Claude Desktop

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "orchestratekit": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/absolute/path/to/orchestratekit-mcp"
    }
  }
}
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run server directly with tsx (no build step) |
| `pnpm build` | Compile to `dist/` with tsup |
| `pnpm typecheck` | TypeScript type-check only (no emit) |
| `pnpm test` | Run unit tests with vitest |
| `pnpm verify` | Run `typecheck` then `test` |

---

## Project structure

```
orchestratekit-mcp/
  src/
    server.ts               Entry point — wires MCP server to stdio transport
    config.ts               Server name and version constants
    tools/
      index.ts              Tool registration (13 tools: health_check + 12 graph tools)
      composeWorkflowRoute.ts
      listGraphComponents.ts / getGraphComponent.ts
      listGraphEdges.ts / getGraphEdge.ts
      getStackRecommendation.ts
      listKnownRoutes.ts / getRoute.ts
    registry/
      registryLoader.ts     YAML loader with validation, status filtering, cross-ref checks
      componentSchema.ts / edgeSchema.ts / stackSchema.ts / routeSchema.ts / playbookSchema.ts
      registryTypes.ts / registryValidation.ts
    graph/
      capabilityMatcher.ts  Keyword + token matching: goal text → components
      routeComposer.ts      Orchestrates all graph modules into a composed route
      routeScoring.ts       Deterministic 0-100 score with breakdown
      routeOrdering.ts      Topological sort via Kahn's algorithm
      safetyAugmenter.ts    Auto-adds approval gates and audit log
      playbookOverlap.ts    Detects overlap with known playbooks/routes
    docs-index/             Supplementary docs loader (future)
    lib/
      errors.ts             McpToolError class and toErrorResult helper
      logger.ts             Stderr-only logger (stdout reserved for transport)

  registry/
    components/             33 component YAML files
    edges/                  54 edge/relation YAML files
    stacks/                 2 stack YAML files
    routes/                 6 route YAML files
    playbooks/              6 golden-path playbook YAML files

  docs-index/               Supplementary context documents
  examples/
    cursor-mcp.json         Example Cursor MCP config
    claude-desktop-config.json  Example Claude Desktop config
  tests/
    health-check.test.ts
```

---

## Non-goals (this phase)

- No remote hosting
- No auth / OAuth
- No vector database
- No graph database (Neo4j etc.)
- No automatic registry updates
- No LLM API calls inside MCP tools
- No SaaS dashboard
- No dependency on OrchestrateLab at runtime

---

## Build order

```
MAR-35  ✅  Scaffold — done
MAR-37  ✅  Graph registry schemas: components, edges, stacks, routes, playbooks
MAR-38  ✅  Seed workflow graph: 30 components, 47 edges, 1 stack, 5 playbooks
MAR-77  ✅  Graph lookup tools: list/get components, edges, stacks, routes
MAR-78  ✅  compose_workflow_route — deterministic route composer
MAR-49  ✅  Benchmark setup — see docs/BENCHMARKING.md
MAR-88  ✅  Domain-gated capability matcher — eliminates cross-domain false positives
MAR-92  ✅  Registry lint + untested_edge_pct in health_check
MAR-95  ✅  crm_note_write component + research→content bridge edge
MAR-96  ✅  Benchmark protocol v2 — rubric, prompts-v2.yaml, PROTOCOL.md
MAR-97  ✅  Docs truth pass — registry counts, tool count, verify path
```

---

## Benchmarking

To validate that the workflow graph improves planning quality over vanilla Cursor/Claude,
run the manual benchmark described in **[docs/BENCHMARKING.md](docs/BENCHMARKING.md)**.

Quick start:

```bash
# v2 protocol — print session guide for all 7 prompts
pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --all

# v2 — single prompt
pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --prompt p6_email_lead_crm

# v1 (legacy)
pnpm tsx scripts/benchmark-template.ts
```

Results go in `benchmarks/results-YYYY-MM-DD.md`.
