# OrchestrateKit MCP — Benchmark Protocol v2

**Version:** 2.0  
**Supersedes:** `docs/BENCHMARKING.md` (v0.1 running notes)  
**Registry files:** `benchmarks/prompts-v2.yaml`, `benchmarks/rubric-v2.yaml`  
**Fixtures:** `benchmarks/fixtures/false-positives-v1.yaml`

---

## Why v2

The v0.1 benchmark (2026-06-09) confirmed the C−B advantage (+4.7 average) but had three methodological flaws that prevent it from being cited as public evidence:

| Flaw | Effect | v2 fix |
|------|--------|--------|
| Condition A MCP not fully disabled — Cursor still had the server connected | A scores were inflated; "vanilla" baseline had registry vocabulary | Explicit per-client MCP disable steps below |
| No per-run metadata recorded | Cannot reproduce or attribute runs to specific model/client/version | Required metadata block in every results file |
| Single client (Cursor) | Unclear if advantage is Cursor-specific or model-general | Separate tracks for ChatGPT, Claude, Cursor |

The core finding (C−B ≥ +4) is not invalidated — inflated A scores don't affect C−B directly, and B/C runs both had MCP active. However Condition A needs a clean re-run before publishing.

---

## Scoring dimensions (v2)

v2 scores five dimensions independently in addition to the per-criterion scores.
See `rubric-v2.yaml` for criterion-to-dimension mapping.

| Dimension | What it measures | Max (A/B/C) |
|-----------|-----------------|-------------|
| route_quality | Architecture correctness and component coverage | 6 / 6 / 6 |
| safety | Approval gates, permission risks, retries/idempotency | 6 / 6 / 6 |
| specificity | Named components, stack choices, persistent state | 6 / 8 / 8 |
| non_hallucination | Avoids false validation claims; honest about gaps | 4 / 6 / 8 |
| brevity | Concise and actionable, no padding | 2 / 2 / 2 |
| **Total** | | **24 / 28 / 30** |

> Note: v2 max scores differ slightly from v0.1 (v0.1 max was 22/24/28). The new `brevity`
> criterion adds 2 points. Do not directly compare totals across protocol versions.

---

## Conditions

### Condition A — Vanilla (MCP fully disabled)

The model must have **zero** OrchestrateKit context. This means:

**Cursor:**
1. Open Settings → MCP Servers.
2. Toggle off every entry whose command includes `orchestratekit` or `node dist/server`.
3. Verify: restart Cursor, open a fresh conversation, type `list_known_routes({})` — it must return "tool not found" or similar error.
4. Do not share any previous conversation context, canvas, or file from an OrchestrateKit session.

**Claude Desktop:**
1. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
2. Remove or comment out the `orchestratekit-mcp` entry under `mcpServers`.
3. Restart Claude Desktop.
4. Verify: open a fresh conversation and confirm no graph tools are offered.

**ChatGPT:**
1. Do not attach any OrchestrateKit files, custom GPTs, or tools.
2. Use a fresh conversation with no system prompt.
3. Web browsing may be on or off — record the setting in run metadata.

**All clients:**
- Open a **fresh conversation** (no prior turns).
- Paste the prompt from `prompts-v2.yaml` **verbatim**. Do not add extra context.
- Record the full response.

### Condition B — Playbook tools only

1. Open a **fresh conversation** with **MCP active**.
2. Before pasting the prompt, call:
   ```
   list_known_routes({})
   ```
   If the prompt has `has_exact_playbook: true`, also call:
   ```
   get_route({ id: "<playbook_route_id>", include_component_details: true })
   ```
   For graph-composed prompts (`has_exact_playbook: false`): call `list_known_routes` only to confirm no match.
3. Paste the benchmark prompt. Do not pre-explain or add context.
4. Record the full response.

### Condition C — Full graph

1. Open a **fresh conversation** with **MCP active**.
2. Before pasting the prompt, call:
   ```
   compose_workflow_route({
     goal: "<compose_workflow_route_goal from prompts-v2.yaml>",
     output_depth: "standard"
   })
   ```
   Use the compose output as context when you paste the prompt.
3. Optionally follow up with:
   ```
   get_graph_component({ id: "<key_component_id>", include_edges: true })
   get_stack_recommendation({})
   ```
4. Paste the benchmark prompt and share the compose output.
5. Record the full response.

---

## Pre-run freshness check (MAR-114 — required before every B/C run)

Before collecting any Condition B or C responses, call `health_check` and verify:

1. `build.stale` is **false** — if true, run `pnpm build` and restart the MCP server before proceeding.
2. Record `build.fingerprint` in the results metadata block.
3. If `build.built_at` is null, the server is running in dev (tsx) mode — this is acceptable and means the registry is always fresh.

A stale registry produces invalid C responses and must not be scored. Mark any run where `build.stale: true` was not caught before collecting responses as **CONTAMINATED** for the affected prompts.

---

## Run metadata (required per results file)

Every `results-YYYY-MM-DD.md` must start with this block:

```markdown
**Protocol version:** v2
**Run date:** YYYY-MM-DD
**Tester:** <name>
**Client:** Cursor | Claude Desktop | ChatGPT (circle one per run)
**Model:** <model identifier, e.g. claude-sonnet-4-5, gpt-4o-2024-11-20>
**Model version / snapshot:** <exact version string if available>
**MCP server version:** <pnpm run health_check → version field>
**Registry fingerprint:** <health_check → build.fingerprint>
**Registry stale at run start:** yes | no  (health_check → build.stale; if yes, STOP and rebuild)
**Registry at time of run:** <X components, Y edges, Z routes, N playbooks>
**Settings:**
  - temperature: <value or "default">
  - web search: enabled | disabled
  - tools (B/C): list_known_routes, get_route, compose_workflow_route, get_graph_component, get_stack_recommendation
  - tools (A): none
**Condition A isolation confirmed:** yes | no (if no, mark A scores as CONTAMINATED)
```

---

## Per-prompt fixture schema (prompts-v2.yaml)

Each prompt in `prompts-v2.yaml` has:

| Field | Type | Meaning |
|-------|------|---------|
| `must_have` | `string[]` | Components that MUST appear in any correct answer. Missing = blocking failure. |
| `nice_to_have` | `string[]` | Components that improve the answer but are not blocking. |
| `forbidden` | `string[]` | Components that MUST NOT appear. Presence = false positive. |
| `missing_but_expected` | `string[]` | Known registry gaps that a good response should call out explicitly. Empty once gaps are fixed. |

Score a response as a **false positive** if any `forbidden` component appears in the proposed route without the response explicitly rejecting it as inappropriate for the goal.

---

## Per-client tracks

Run the full 7-prompt suite once per client. Results files are named:

```
benchmarks/results-YYYY-MM-DD-cursor.md
benchmarks/results-YYYY-MM-DD-claude.md
benchmarks/results-YYYY-MM-DD-chatgpt.md
```

When only one client is run, omit the suffix and note the client in the metadata block.

---

## Scoring

Score each criterion 0, 1 or 2 per `rubric-v2.yaml`. Also compute dimension subtotals.

**Quick guide:**
- `0` = not addressed or actively wrong
- `1` = mentioned but vague, incomplete, or partially wrong
- `2` = clear, correct, actionable and specific

**N/A rules:**
- `reuses_graph_components` → N/A for Condition A
- `untested_edges` → N/A for Conditions A and B
- `candidate_not_validated` → N/A for Conditions A and B

**False-positive check (before scoring):**
- Verify no `forbidden` component appears unjustified in the route. If it does, score `suitable_architecture` ≤ 1 and note it.
- Compare against `benchmarks/fixtures/false-positives-v1.yaml` — if any fixed pattern recurs, that is a regression.

---

## Gate criteria

> **v2.1 update (2026-06-12):** The 2026-06-12 benchmark run revealed that `compose_workflow_route` adds clear value for novel/graph-composed workflows but is not the right tool for playbook-matched requests. The original single-gate definition did not account for this split. The tiered gate below replaces the original primary gate for all runs from v2.1 onward.

### Tiered gate (v2.1 — current)

| Gate | Criterion | Applies to |
|------|-----------|------------|
| **Novel-route gate** | avg C − B ≥ +4 | Prompts with `has_exact_playbook: false` (p6, p7) |
| **ETL / compose-corrects-noise gate** | C − B ≥ 0 | p5 (ETL — compose helps remove domain noise) |
| **Playbook gate** | avg C − B ≥ 0 | Prompts with `has_exact_playbook: true` (p1–p4) |
| **Floor** | No individual C − B < −5 | All prompts |
| **False-positive** | No `forbidden` component unjustified in C | All prompts |

**Rationale:** For playbook-matched requests, `list_known_routes + get_route` already provides comprehensive guidance. Compose output for those prompts introduces noise the model must manage, reducing response quality on completeness criteria (observability, retries, persistent state). The novel-route gate (p6, p7) is where compose delivers its primary value proposition.

### Original gate (v2.0 — reference only)

**Primary gate (M2.5 / MAR-98):** average C − B ≥ +4 across all 7 prompts.

**Secondary checks (v2.0):**
- No individual prompt C − B < 0
- At least 6 of 7 prompts at C − B ≥ +4
- Condition A `non_hallucination` dimension score ≥ 2/4 (vanilla must not hallucinate graph components)
- No `forbidden` component appears unjustified in any Condition C route

If the gate fails: do not advance MAR-98. Diagnose which dimension(s) are dragging C down; fix matcher/registry/tool output before re-running.

---

## v0.1 baseline (reference)

The v0.1 run (2026-06-09, Cursor, claude-sonnet, single client) produced:

| Prompt | A | B | C | C − B |
|--------|---|---|---|-------|
| p1 Research | 20/22 | 22/24 | 27/28 | +5 |
| p2 Content | 21/22 | 23/24 | 28/28 | +5 |
| p3 Email/cal | 22/22 | 24/24 | 28/28 | +4 |
| p4 Codebase | 21/22 | 23/24 | 27/28 | +4 |
| p5 ETL | 20/22 | 23/24 | 27/28 | +4 |
| p6 CRM | 21/22 | 20/24 | 27/28 | +7 |
| p7 Monitor | —/22 | 23/24 | 27/28 | +4 |
| **Average** | — | — | — | **+4.7** |

**Caveats:**
- Condition A contaminated in p2, p3, p4, p6 (MCP context leaked) — A scores likely inflated.
  True A scores are expected to be lower, making C−B advantage larger.
- p7 Condition A not run.
- Single client (Cursor) — generalisation to other clients unconfirmed.

**v2 target:** reproduce or exceed +4.7 with clean Condition A isolation and at least two client tracks.

---

## Running the session template

```bash
# All prompts (v2)
pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --all

# Single prompt
pnpm tsx scripts/benchmark-template.ts --prompts benchmarks/prompts-v2.yaml --prompt p6_email_lead_crm
```

The script prints the compose output for Condition C (local, no LLM calls) and a blank scoring table.

---

## After running

1. Save results to `benchmarks/results-YYYY-MM-DD[-client].md`.
2. Run the false-positive check against `fixtures/false-positives-v1.yaml`.
3. Fill in the retro questions at the bottom of the results file.
4. If C−B ≥ +4.7 confirmed: proceed to MAR-98 gate.
5. If not: file a new backlog issue with the failing dimension + prompt, fix, re-run.
