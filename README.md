# OrchestrateMCP

[![CI](https://github.com/orchestratemcp/OrchestrateKIT-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/orchestratemcp/OrchestrateKIT-MCP/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-orchestratemcp.dev-7c3aed.svg)](https://orchestratemcp.dev)

An evidence-backed **workflow-design advisor** for AI agents. Connect it to ChatGPT, Claude (web), Cursor, or Claude Desktop and it plans safer, more grounded AI workflows from a documented component graph and published playbooks. Read-only, stateless, holds no secrets.

**Status:** hosted `health_check` reports 64 components, 151 connections, 4 workers, 1 reference stack, 12 published routes, and 12 published playbooks; available over stdio and as a free hosted endpoint (`https://mcp.orchestratemcp.dev/mcp`). See the [public claim ledger](docs/PUBLIC_CLAIM_LEDGER.md) for definitions, evidence, and held claims.

---

## What it does

OrchestrateMCP exposes a structured registry of:

```
components  →  the building blocks of AI workflows
edges       →  documented relations between components (requires, safer_with, conflicts_with, …)
stacks      →  opinionated technology choices for different deployment contexts
routes      →  published or candidate paths through the component graph
playbooks   →  published patterns with implementation guidance
```

When a user describes a workflow goal, the MCP can:

1. Match the goal to required capabilities and components.
2. Traverse documented component relationships and surface their evidence state.
3. Reuse sections of known published playbooks.
4. Compose a candidate route when no exact playbook exists.
5. Score route confidence (coverage, tested edges, stack fit, safety, simplicity).
6. Return the route as structured implementation context for Cursor or Claude.

---

## What works right now

- MCP server runs on stdio (Cursor, Claude Desktop) and over Streamable HTTP / a Cloudflare Worker (ChatGPT, claude.ai) — 18 registered tools.
- `health_check` returns `{ name, version, registry: { component_count, edge_count, stack_count, route_count, playbook_count, worker_count, untested_edge_pct } }`.
- Hosted registry: 64 components, 151 connections, 1 reference stack, 12 published routes, 12 published playbooks, 4 workers.
- Coverage accounting reports unmatched demand and unsupported supply instead of silently pretending the graph covers everything.
- Corpus regression tests and release-trust floors ratchet the registry forward in CI.
- `pnpm verify` (typecheck + lint + tests) passes from a clean clone and install.

---

## Why trust this

OrchestrateMCP is stateless, read-only, holds no secrets, and makes no LLM calls inside its tools. Plans are composed from registry YAML, provenance tags mark computed fields, coverage accounting calls out unsupported pieces, and corpus contracts plus release-trust checks run in CI to catch drift. Registry evidence is not a promise that a proposed workflow is production-ready; see the [claim ledger](docs/PUBLIC_CLAIM_LEDGER.md).

---

## Requirements

- Node.js ≥ 20
- pnpm

Project policies: **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Changelog](CHANGELOG.md)**

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

## Connect from ChatGPT or claude.ai (hosted)

No install, no terminal — point your AI client at the free hosted endpoint:

```
https://mcp.orchestratemcp.dev/mcp
```

Full walkthrough (ChatGPT Developer-Mode connector + claude.ai): **[docs/CHATGPT_USAGE.md](docs/CHATGPT_USAGE.md)**.

---

## Try This First

After connecting, paste this wrapper plus one starter goal. The default response
should be a short product card: title, route, steps, connections, safety note,
build controls, and four continuation choices.

```text
Use the orchestratekit MCP tools.

Goal: [paste one starter goal here]

Call plan_workflow with this goal and render the returned summary_markdown
verbatim, including the A) B) C) D) continuation menu.
```

Starter goals:

```text
Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.
```

```text
Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.
```

```text
When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.
```

```text
When a PDF invoice arrives in the shared AP Gmail inbox, extract totals and line items, match against purchase orders, notify AP in Slack for discrepancies, and hold every invoice for human approval before accounting.
```

```text
Use a content brief to generate social copy variants and a design brief, send it to a reviewer for approval, then publish externally only after approval.
```

More first-run starters and expected output shapes:
**[docs/FIRST_RUN_STARTERS.md](docs/FIRST_RUN_STARTERS.md)**.

---

## Connecting your workflow's services

Connecting the MCP to your client takes no auth (it's a read-only advisor). But
the workflows it plans need *your* credentials for Gmail, Slack, Stripe, your
CRM, and so on. For how to provision those safely — least-privilege scopes,
secret managers, and managed-auth brokers — see
**[docs/CONNECTION_SETUP.md](docs/CONNECTION_SETUP.md)**. OrchestrateMCP never
holds a credential.

---

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run server directly with tsx (no build step) |
| `pnpm build` | Compile to `dist/` with tsup |
| `pnpm benchmark` | Reproduce the seven-prompt deterministic registry benchmark |
| `pnpm benchmark:check` | Fail when committed benchmark evidence no longer matches the registry |
| `pnpm typecheck` | TypeScript type-check only (no emit) |
| `pnpm test` | Run unit tests with vitest |
| `pnpm export:safe` | Create a source-only review zip at `exports/orchestratekit-mcp-source.zip` |
| `pnpm verify` | Generate bundles, typecheck, lint registry, run tests, and check release trust |

For source review packages, never zip the working folder directly. Use
`pnpm export:safe`; see **[docs/SAFE_EXPORT.md](docs/SAFE_EXPORT.md)** for the
forbidden paths and archive inspection command.

---

## Project structure

```
orchestratekit-mcp/
  src/
    server.ts               Entry point — wires MCP server to stdio transport
    config.ts               Server name and version constants
    tools/
      index.ts              Tool registration (18 tools: health_check + 17 graph/advisor tools)
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
    components/             component YAML files (64 active)
    edges/                  edge/relation YAML files (151 active)
    stacks/                 stack YAML files
    routes/                 route YAML files (13)
    playbooks/              golden-path playbook YAML files (14)

  docs-index/               Supplementary context documents
  examples/
    cursor-mcp.json         Example Cursor MCP config
    claude-desktop-config.json  Example Claude Desktop config
  tests/
    health-check.test.ts
```

---

## Non-goals (by design)

- No first-party credential storage — it recommends secret managers / managed-auth brokers, never holds a secret
- No auth / OAuth / accounts — the hosted endpoint is read-only and stateless, nothing to log into
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
MAR-38  ✅  Seed workflow graph baseline
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

Run the public, deterministic registry benchmark locally:

```bash
pnpm benchmark
```

It runs seven fixed prompts with no LLM or network calls, checks required
components and known false positives, fingerprints the inputs and registry, and
prints every candidate status, untested edge, and compose-noise flag. See the
current [machine-readable and human-readable results](benchmarks/public/README.md).

This proves deterministic graph conformance, not model-quality uplift. The
manual A/B/C protocol for comparing vanilla and MCP-assisted client responses
remains available in **[benchmarks/PROTOCOL.md](benchmarks/PROTOCOL.md)**; its
archived scores retain their original isolation caveats and are not a current
public headline.

Maintainers can intentionally refresh the committed result after reviewing a
registry change:

```bash
pnpm benchmark:write
pnpm benchmark:check
```

---

## License

OrchestrateMCP is available under the **[MIT License](LICENSE)**.
