# OrchestrateKit MCP — Benchmarking Guide

This document explains how to run the manual benchmark that compares
workflow-graph-assisted planning against vanilla Cursor/Claude planning.

Benchmark files live in `benchmarks/`.

---

## Why this benchmark exists

The OrchestrateKit MCP local MVP is only valuable if it produces measurably
better architecture advice than a model without graph context. This benchmark
is the gate before starting OrchestrateLab. If the results are weak, improve
the graph first.

---

## Setup

### 1. Start the MCP server

```bash
cd orchestratekit-mcp
pnpm dev
```

Or point Cursor/Claude Desktop at the compiled server:

```bash
pnpm build
node dist/server.js
```

See `examples/cursor-mcp.json` or `examples/claude-desktop-config.json` for
the MCP configuration.

### 2. Verify the server is healthy

In a Claude/Cursor chat with the MCP active, call:
```
health_check({})
```

Expected response includes `registry.component_count >= 20`, `edge_count >= 40`.

---

## Running a benchmark session

### For each prompt in `benchmarks/prompts.yaml`:

Run **three separate conversations** — do not reuse context between conditions.

---

### Condition A — Vanilla Cursor/Claude (no MCP)

1. Open a fresh conversation with **MCP disabled**.
2. Paste the prompt text from `prompts.yaml` verbatim.
3. Do not add extra context.
4. Copy the full response.
5. Score using `benchmarks/rubric.yaml`.

---

### Condition B — OrchestrateKit MCP, playbooks only

1. Open a fresh conversation with **MCP active**.
2. Before pasting the prompt, call these tools manually:
   ```
   list_known_routes({})
   ```
   If a matching route exists, also call:
   ```
   get_route({ id: "<matching_route_id>", include_component_details: true })
   ```
3. Paste the benchmark prompt.
4. Let the model use the playbook context to answer.
5. Copy the full response.
6. Score using `benchmarks/rubric.yaml` (criteria `reuses_graph_components` applies).

---

### Condition C — OrchestrateKit MCP, full graph

1. Open a fresh conversation with **MCP active**.
2. Before pasting the prompt, call:
   ```
   compose_workflow_route({
     goal: "<use the compose_workflow_route_goal from prompts.yaml>",
     output_depth: "standard"
   })
   ```
3. Optionally follow up with:
   ```
   get_graph_component({ id: "<key_component_id>", include_edges: true })
   get_stack_recommendation({})
   ```
4. Paste the benchmark prompt. Share the compose_workflow_route result as context.
5. Let the model discuss and refine the route.
6. Copy the full response.
7. Score using `benchmarks/rubric.yaml` (all 14 criteria apply).

---

## Scoring

Score each criterion 0, 1 or 2 according to the descriptions in `rubric.yaml`.

Record results in a copy of `benchmarks/results.example.md`.
Name your file: `benchmarks/results-YYYY-MM-DD.md`.

**Quick scoring cheat sheet:**
- `0` = Not addressed or actively wrong.
- `1` = Mentioned but vague, incomplete or partially wrong.
- `2` = Clear, correct, actionable and specific.

**N/A rules:**
- `reuses_graph_components` → N/A for condition A.
- `untested_edges` → N/A for conditions A and B.
- `candidate_not_validated` → N/A for conditions A and B.

---

## Minimum thresholds to pass the benchmark gate

| Condition | Expected minimum |
|-----------|-----------------|
| A         | 8–12 / 22       |
| B         | 16–20 / 24      |
| C         | 22–28 / 28      |

If condition C does not score ≥4 points above condition B on average across
prompts, the graph is not adding enough value. In that case:
- Add more tested edges to the registry.
- Improve `compose_workflow_route` keyword matching for the failing prompt category.
- Add missing components that cover the gap.

---

## Prompts that require compose_workflow_route (no exact playbook)

For prompts `p6_email_lead_crm` and `p7_product_monitor_content`:

- Confirm with `list_known_routes` that no exact playbook exists.
- Run `compose_workflow_route` with the goal from `prompts.yaml`.
- Compare the generated route to the expected output in
  `benchmarks/graph-composed-routes.example.md`.
- Note which steps were correctly composed and which were missing.
- Score condition C using the composed route as the context.

---

## After running the benchmark

Copy your scored results file to `benchmarks/results-YYYY-MM-DD.md` and answer
the retro questions at the bottom of the file:

1. Did `compose_workflow_route` improve the result?
2. Did the workflow graph reduce generic advice?
3. Were untested edges useful or noisy?
4. Should we add more components/edges, simplify the graph or return to playbook-first?
5. What must change before starting OrchestrateLab?

These answers determine the next steps. See the top-level `README.md` for the
milestone gate criteria.

---

## Using the benchmark template script

```bash
pnpm tsx scripts/benchmark-template.ts
```

This prints:
- A formatted session guide for each prompt.
- The `compose_workflow_route` preview for graph-composed prompts.
- A blank scoring table ready to paste into your results file.

No LLM API calls are made. The script only runs local graph logic.
