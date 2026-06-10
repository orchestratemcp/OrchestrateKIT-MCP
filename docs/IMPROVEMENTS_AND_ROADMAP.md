# OrchestrateKit — Improvements, State & Roadmap

**Updated:** 2026-06-10  
**Context:** M2 MCP complete · Manual benchmark passed (avg C−B **+4.7**) · OrchestrateLab **GO**

This document consolidates benchmark takeaways, near-term MCP work, OrchestrateLab expectations, and a proposal for the **component brain schema** — how each puzzle piece is documented, connected, and kept current.

---

## 1. Project state (right now)

### What we have

| Layer | Status |
|-------|--------|
| **OrchestrateKit MCP** | Local stdio server · 12 tools · `pnpm verify` green |
| **Registry** | 31 components · 50 edges · 14 tested · 5 routes · 5 playbooks · 1 stack |
| **Graph tools** | `compose_workflow_route`, `get_route`, `get_playbook`, `review_workflow_design`, etc. |
| **Safety** | Deterministic augmenter (approval gates, audit_log) · do-not-build rules |
| **Benchmark** | 7 prompts · gate passed · results in `benchmarks/results-2026-06-09.md` |
| **Docs** | Local setup, Cursor/Claude usage, benchmarking guide, M2 retro |

### What the benchmark proved

- **Condition C (full graph) beats B (playbooks only) by +4.7 on average** — the graph adds real planning value, not just vocabulary.
- **Highest-value C outputs:** untested-edge checklists, candidate-vs-validated disclaimers, compose noise rejection, registry gap detection.
- **Vanilla models are already strong** on safety basics (approval before send/publish). The graph wins on **specificity and honesty about what is unproven**.
- **Compose is a draft generator, not a blueprint.** Topological sort order misleads; matcher injects cross-domain noise; safety augmenter misses some playbook invariants (`schema_validation`).

### What is still weak

- Keyword matcher false positives (`pr_summary`, research cluster on content goals, `external_publish` on ETL).
- Low **tested edge** coverage drags route confidence scores.
- Missing components for real workflows: `crm_note_write`, synthesis→brief bridge, dedicated `content_ideas` extractor.
- MCP context is **thin at the component level** — templates exist (`failure_modes`, `evals`, `permissions`) but many YAML files omit them.
- Route schema drops some fields silently (e.g. `sources` on routes) — documented in M2 retro.

---

## 2. Possible improvements (prioritized)

Grouped by impact and effort. Full per-prompt detail lives in `benchmarks/takeaways-2026-06-09.md`.

### P0 — Fix before / during first OrchestrateLab sessions

| # | Improvement | Why |
|---|-------------|-----|
| 1 | **Matcher domain guards** | Block `pr_summary`, research cluster, `design_brief_generation`, `external_publish` on wrong goal domains |
| 2 | **Safety augmenter: inject `schema_validation`** | Playbook requires it before `external_publish`; compose drops it (p2) |
| 3 | **Compose: execution order ≠ step list** | Warn when topological sort puts `external_publish` at step 2 (p2, p6) |
| 4 | **Compose: playbook recommendation** | When overlap ≥80%, say “use playbook X” instead of raw compose list |
| 5 | **`get_route` / compose: `tested: true/false` per edge** | Stops B from overstating validated edges (p4) |

### P1 — Registry growth (OrchestrateLab-driven)

| # | Improvement | Why |
|---|-------------|-----|
| 6 | **`crm_note_write` component + edges** | Blocking gap for email-lead workflows (p6) |
| 7 | **`research_synthesis → content_idea_intake` edge** | Inferred bridge with zero registry support (p7) |
| 8 | **Mark edges `tested: true` after integration tests** | Biggest confidence drag; benchmark showed honest untested counts are valuable — now prove them |
| 9 | **`page_monitor` edge suite** | Component exists; all monitor edges untested E2E (p7) |
| 10 | **Route schema: `sources` field** | Surface route-level docs via `get_relevant_docs` (M2 retro) |

### P2 — MCP context & tooling quality

| # | Improvement | Why |
|---|-------------|-----|
| 11 | **Enrich component YAML** | Fill `permissions`, `side_effects`, `failure_modes`, `evals` on all published components |
| 12 | **Nudge `get_stack_recommendation` in Condition C** | `stack_explanation` consistently 1/2 in benchmark |
| 13 | **`compose_workflow_route`: fail loud on critical `avoid_when` conflicts** | e.g. scraper→publish on ETL goals (p5) |
| 14 | **Expand docs-index** | 3 entries is too thin for `get_relevant_docs` |
| 15 | **Deferred tools revisit** | `generate_eval_plan`, `generate_implementation_pack` — after Lab session data |

### P3 — Later / optional

- Embedding-based capability matcher (only after keyword fixes + Lab data).
- Calibrate route_score thresholds against real sessions.
- HTTP adapter for MCP (Lab app may want remote access).
- More playbooks covering monitor, CRM, multi-channel content.

---

## 3. What to do next (sequenced)

```
Week 1–2   OrchestrateLab scaffold + first 5 architecture sessions (real goals, capture outputs)
           Parallel: P0 matcher + augmenter fixes in orchestratekit-mcp

Week 2–4   Integration tests for 10–15 edges → mark tested in registry
           Add crm_note_write + p7 bridge edges from Lab findings

Week 4+    Promote 2–3 candidate routes → validated playbooks
           Expand component brain fields (see §5) on every touched component
           Re-run benchmark subset to confirm C−B holds after fixes
```

**Do not:** add components broadly before matcher quality improves. **Do:** playbook-first when overlap ≥80%; compose only for net-new flows.

---

## 4. OrchestrateLab — what we need from it

OrchestrateLab is the **research app** that stress-tests the graph in real planning sessions and feeds evidence back into the registry. It lives in a **sibling repo** (`../orchestratelab`), not inside this MCP repo.

### Purpose

| Without Lab | With Lab |
|-------------|----------|
| Registry grows by guesswork | Registry grows from **observed session failures** |
| `tested: true` is aspirational | `tested: true` means **integration test passed** |
| Playbooks cover 5 workflow types | Playbooks cover **what users actually build** |
| Compose scores uncalibrated | Scores tuned against **session outcomes** |

### Minimum viable Lab outputs

1. **Session corpus** — prompt, tool calls, model response, user rating (“useful / noise / wrong”).
2. **Edge validation log** — for each untested edge: fixture, pass/fail, date, test_ref URL.
3. **Component gap list** — workflows that needed a component that does not exist (e.g. `crm_note_write`).
4. **Playbook promotion queue** — candidate routes that passed evals → YAML playbook PR to MCP repo.
5. **Matcher regression set** — labelled goals where compose picked wrong components; feeds domain guards.

### What Lab should *not* do (yet)

- Train or fine-tune models on registry data.
- Auto-merge registry changes without human review.
- Replace the benchmark — re-run benchmark after major matcher/registry changes.

### Success criteria for Lab v1

- 10+ architecture sessions captured.
- 3+ new or updated playbooks exported to `orchestratekit-mcp/registry`.
- 15+ edges marked `tested: true` with linked test_refs.
- Documented “component brain” completion % per component (see §5).

---

## 5. Component brain schema

Each registry component should be a **small knowledge object** the MCP can slice into context without dumping the whole graph. Think: *what it is, how it behaves, who it talks to, how we know it works.*

### 5.1 Layer model

```
┌─────────────────────────────────────────────────────────┐
│  L4  Lifecycle     status, tested_in_*, last_validated  │
├─────────────────────────────────────────────────────────┤
│  L3  Operations    failure_modes, evals, retry hints    │
├─────────────────────────────────────────────────────────┤
│  L2  Connections   requires, recommended_with, edges    │
├─────────────────────────────────────────────────────────┤
│  L1  Identity      id, category, capabilities, I/O      │
├─────────────────────────────────────────────────────────┤
│  L0  Safety        risk_level, side_effects, permissions│
└─────────────────────────────────────────────────────────┘
```

**MCP context rule:** tools return **L0–L2 by default**; L3–L4 on `include_edges: true` or `output_depth: deep`.

### 5.2 Required fields by status

| Field | draft | published | validated |
|-------|-------|-----------|-----------|
| id, name, summary, category | ✓ | ✓ | ✓ |
| capabilities (≥3 keywords) | ✓ | ✓ | ✓ |
| inputs / outputs (structured) | ○ | ✓ | ✓ |
| risk_level, side_effects | ○ | ✓ | ✓ |
| permissions (read/write/approval) | ○ | ✓ | ✓ |
| requires / recommended_with | ○ | ✓ | ✓ |
| failure_modes (≥2) | ○ | ○ | ✓ |
| evals (≥1 with metric target) | ○ | ○ | ✓ |
| tested_in_playbooks or tested_in_routes | — | ○ | ✓ |
| sources (≥1 with last_checked) | ○ | ○ | ✓ |

○ = recommended · ✓ = required

### 5.3 Edge contract (how pieces connect)

Every edge YAML should answer four questions:

1. **Relation type** — `requires`, `produces_input_for`, `avoid_when`, `safer_with`, `must_run_before`, …
2. **Severity** — low / medium / high / critical (drives compose warnings).
3. **Condition** — when does this apply? (optional but reduces false warnings)
4. **Evidence** — `tested: true` + `test_refs[]` OR explicit `status: draft` + planned eval

**Best practice relations:**

| Pattern | Example | Meaning |
|---------|---------|---------|
| External write chain | `external_publish` **requires** `human_approval_gate` | Non-negotiable safety |
| Schema gate | `schema_validation` **must_run_before** `external_publish` | Deterministic pre-check |
| LLM grounding | `research_synthesis` **requires** `citation_checker` | No unverified claims downstream |
| Category block | `research_synthesis` **avoid_when** `external_publish` | Never publish raw synthesis |
| Soft nudge | `copy_generation` **safer_with** `human_approval_gate` | Recommended, not enforced by augmenter |

**Inferred bridges** (no edge yet) should be listed in playbook `notes` or a `gaps:` section until Lab validates them — do not mark `tested: true` without a test.

### 5.4 Keeping the brain up to date

| Trigger | Action |
|---------|--------|
| New OrchestrateLab session finds wrong component | File matcher regression; optionally add `avoid_with` on component |
| Integration test passes | Set edge `tested: true`, add `test_ref`, bump component `tested_in_*` |
| Playbook promoted | All route components → `status: validated` cascade (optional policy) |
| External API / tool change | Update `permissions`, `failure_modes`, `sources.last_checked` |
| Quarterly | Review components with empty `evals` or `sources`; deprecate unused |

**Single source of truth:** `orchestratekit-mcp/registry/`. Lab proposes changes via PR. No duplicate schemas in Lab repo.

**Automation targets (future):**

- CI fails if `published` component missing `permissions` or `side_effects`.
- CI fails if `tested: true` edge has empty `test_refs`.
- `pnpm registry:lint` reports brain completion % per component.

---

## 6. Packing MCP with good context (without bloating tokens)

The graph is large; models need **progressive disclosure**, not a registry dump.

### Tool response tiers

| Tier | When | Include |
|------|------|---------|
| **Brief** | `output_depth: brief` | Route step IDs, score, top 3 warnings |
| **Standard** | default compose / get_route | Steps, edges_used, untested_edges, approval gates, assumptions |
| **Deep** | user asks for evals / review | L3 failure_modes, evals, permissions, full edge reasons |

### Context packing principles

1. **Playbook-first shortcut** — if overlap ≥80%, return playbook summary + “missing glue steps” instead of 12-component compose list.
2. **Edge vocabulary in prose** — every warning names `from__relation__to` so the model can cite graph law.
3. **Separate execution order** — always return `execution_order[]` distinct from `recommended_route[]` (topological artifact).
4. **Untested edges as checklist** — type + severity + one-line test action (benchmark’s highest-value format).
5. **Component on demand** — `get_graph_component({ id, include_edges: true })` for drill-down; never inline all 31 components in compose.
6. **Stack last** — prompt Condition C setup to call `get_stack_recommendation` after route is settled.
7. **Docs index by tag** — `get_relevant_docs({ tags: ["approval", "publish"] })` not full index.

### Anti-patterns to avoid in tool output

- Presenting `route_score` without `score_breakdown` (users find aggregate opaque).
- Listing components without saying which are compose noise.
- Marking candidate routes as “recommended architecture” without disclaimer.

---

## 7. Open questions (figure out before “truly amazing”)

| Question | Why it matters | Where to answer |
|----------|----------------|-----------------|
| Who owns registry PRs — MCP repo or Lab? | Prevents drift | Lab exports → MCP PR workflow (document in Lab README) |
| When does `draft` → `validated`? | Trust model | Policy: tested edges + eval pass + human review |
| Adapter pattern vs new edges for glue steps | p7 synthesis→brief | Lab session: implement both, compare maintainability |
| Embedding matcher worth it? | Scale beyond keywords | Only after P0 guards + 20+ regression goals |
| How much component YAML in MCP responses? | Token cost vs quality | Measure in Lab: brief vs deep on same prompts |
| Single vs dual approval standard | Email playbook vs user prefs | Document as playbook variant, not global rule |
| CRM component generic vs HubSpot-specific | Reuse | Start generic `crm_note_write` capability; adapter in stack |

---

## 8. Related files

| File | Contents |
|------|----------|
| `benchmarks/results-2026-06-09.md` | Full scores, gate, retro |
| `benchmarks/takeaways-2026-06-09.md` | Per-prompt improvement backlog |
| `benchmarks/rubric.yaml` | Scoring criteria |
| `docs/BENCHMARKING.md` | How to re-run benchmark |
| `docs/M2_RETRO.md` | M2 completion notes |
| `registry/components/_template.component.yaml` | Component brain template |
| `registry/edges/_template.edge.yaml` | Edge contract template |

---

## 9. One-paragraph summary

OrchestrateKit MCP is **working and benchmark-validated**: the workflow graph measurably improves architecture advice (+4.7 C−B). M2 delivered tools and a coherent registry; the benchmark exposed **matcher noise**, **thin component metadata**, and **low tested-edge coverage** as the main gaps. **OrchestrateLab** should run real sessions, prove edges with integration tests, and promote playbooks back into the registry. The **component brain schema** (identity → safety → connections → operations → lifecycle) is the standard for keeping each puzzle piece documented and MCP-friendly. Fix P0 matcher/augmenter issues in parallel with Lab v1; re-benchmark after registry hardening to confirm the gate holds.
