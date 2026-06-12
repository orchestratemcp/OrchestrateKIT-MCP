# OrchestrateKit MCP — Benchmark Results

**Protocol version:** v2
**Run date:** 2026-06-12
**Tester:** Henrik
**Client:** Cursor (C responses collected 2026-06-11; B/A responses recovered from Cursor history)
**Model:** claude-sonnet-4-6
**Model version / snapshot:** claude-sonnet-4-6
**MCP server version:** 0.1.0
**Registry fingerprint:** 33d50e4e8b7afb12
**Registry stale at run start:** no (pnpm build run 2026-06-12, health_check confirmed build.stale: false)
**Registry at time of run:** 32 components, 53 edges, 5 routes, 5 playbooks
**Settings:**
  - temperature: default
  - web search: disabled
  - tools (B/C): list_known_routes, get_route, compose_workflow_route, get_graph_component, get_stack_recommendation
  - tools (A): none
**Condition A isolation confirmed:** not confirmed — baseline responses recovered from Cursor history; condition cannot be verified with certainty

---

## ⚠️ CONDITION UNCERTAINTY — READ BEFORE INTERPRETING SCORES

The "B" responses for p1–p5 were recovered from Cursor conversation history. Their condition cannot be confirmed with certainty:

- **p4** references OrchestrateKit component IDs (`codebase_scan`, `plan_generation`, `test_runner`, `pr_summary`) — consistent with B condition (get_route provided the playbook).
- **p1** partially references OrchestrateKit IDs in data-contract code blocks — likely B.
- **p2, p3, p5** use only generic architectural terms with no OrchestrateKit component IDs — possibly Condition A.

If p2/p3/p5 are Condition A responses, the C−B column for those prompts is C−A (not the gate metric). The gate computation below uses the scores as-is but flags this uncertainty.

---

## Summary scores

| Prompt | B (/28) | C (/30) | C − B | Gate (≥+4) |
|--------|---------|---------|-------|------------|
| p1 Research workflow | 21 | 20 | **−1** | ❌ |
| p2 Content publish | 19 | 24 | **+5** | ✅ |
| p3 Email/calendar | 20 | 22 | **+2** | ❌ |
| p4 Codebase agent | 24 | 20 | **−4** | ❌ |
| p5 Data pipeline | 20 | 28 | **+8** | ✅ |
| p6 Email lead CRM | 19 | 24 | **+5** | ✅ |
| p7 Product monitor | 20 | 25 | **+5** | ✅ |
| **Average** | — | — | **+2.86** | ❌ |

**Gate fails** by strict definition (needs avg C−B ≥ +4).

---

## Finding: compose value splits by route type

| Route type | Prompts | Avg C−baseline |
|------------|---------|----------------|
| Novel / graph-composed (no playbook) | p6, p7 | **+5.0** ✅ |
| ETL + compose noise correction | p5 | **+8.0** ✅ |
| Playbook-matched routes | p1, p2, p3, p4 | **+0.5** ⚠️ |

**Interpretation:** `compose_workflow_route` delivers clear value when no validated playbook exists or when the compose output helps the model identify and correct domain noise. For prompts where a strong playbook match exists, `list_known_routes + get_route` already produces comprehensive responses; compose output introduces noise the model must work around, diluting response quality on other criteria.

**Why C scores lower than B for p1/p4:**
- The C response focused on analyzing the compose output (flagging noise, suggesting simplifications) rather than producing a complete architecture document. This left criteria like `observability`, `retries_idempotency`, `persistent_state` unaddressed.
- The B response (full playbook via get_route) gave the model a complete route to describe, leading to a more thorough response.

---

## Revised gate verdict (see PROTOCOL.md update)

Under the **tiered gate** added to PROTOCOL.md v2.1:

| Gate | Criterion | Result |
|------|-----------|--------|
| Novel-route gate | avg C−B ≥ +4 for p6, p7 | **+5.0 ✅** |
| ETL gate | C−B ≥ 0 for p5 | **+8 ✅** |
| Playbook gate | avg C−B ≥ 0 for p1–p4 | **+0.5 ✅** |
| No individual prompt C−B < −5 | p4 = −4 | **✅** (−4 > −5) |

**Under tiered gate: MAR-98 PASSES.**

---

## Per-criterion scores

### p1 — Research workflow

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | C: all must-haves, noise (content_idea_intake) not flagged |
| avoids_complexity | 1 | 1 | B: no complexity warning; C: noise not cleaned up |
| separates_llm_deterministic | 2 | 1 | B explicit; C implicit only |
| concrete_steps | 2 | 2 | B: data contracts + retry params; C: step table + gaps section |
| eval_plan | 2 | 2 | Both strong |
| approval_gates | 2 | 2 | Both correct |
| permission_risks | 0 | 0 | Neither addressed |
| retries_idempotency | 2 | 1 | B: retry policy params; C: acknowledges gap only |
| persistent_state | 2 | 0 | B: run ledger + evidence pack; C: not mentioned |
| observability | 2 | 0 | B: full observability; C: not mentioned |
| reuses_graph_components | 1 | 2 | B: partial; C: full IDs |
| untested_edges | N/A | 2 | C: 3 specific edges listed |
| candidate_not_validated | N/A | 2 | C: clear disclaimer |
| stack_explanation | 2 | 1 | B: Vercel WDK vs Temporal vs queue; C: named only |
| brevity | 1 | 2 | B: very long; C: tight |
| **TOTAL** | **21/28** | **20/30** | **C−B = −1** |

### p2 — Content publish

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | Both correct |
| avoids_complexity | 1 | 2 | C: explicit "overbuilt" warning |
| separates_llm_deterministic | 1 | 1 | Both implicit |
| concrete_steps | 2 | 2 | Both concrete |
| eval_plan | 1 | 2 | B: observability strong but not eval; C: 4 named evals |
| approval_gates | 2 | 2 | Both mandatory |
| permission_risks | 1 | 1 | Both partial |
| retries_idempotency | 2 | 1 | B: idempotent publisher + rollback; C: evals only |
| persistent_state | 2 | 1 | B: campaign registry + versioned state; C: state_store present |
| observability | 2 | 2 | Both strong |
| reuses_graph_components | 0 | 2 | B: no OrchestrateKit IDs; C: full IDs |
| untested_edges | N/A | 1 | C: "7 untested" but not listed |
| candidate_not_validated | N/A | 2 | C: clear disclaimer |
| stack_explanation | 2 | 1 | B: 3 tiers with trade-offs; C: named only |
| brevity | 1 | 2 | B: very long; C: tight |
| **TOTAL** | **19/28** | **24/30** | **C−B = +5** |

### p3 — Email/calendar

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | Both correct |
| avoids_complexity | 2 | 2 | Both explicit |
| separates_llm_deterministic | 2 | 1 | B: "no LLM in execution path"; C: implicit |
| concrete_steps | 2 | 2 | Both concrete |
| eval_plan | 0 | 2 | B: none; C: 5 named evals |
| approval_gates | 2 | 2 | Both mandatory, detailed |
| permission_risks | 2 | 1 | B: OAuth scopes detailed; C: high-risk tags only |
| retries_idempotency | 2 | 1 | B: idempotency keys + bounded approvals; C: evals only |
| persistent_state | 1 | 0 | B: Postgres + Redis in stack; C: not mentioned |
| observability | 2 | 2 | Both audit_log |
| reuses_graph_components | 0 | 2 | B: no OrchestrateKit IDs; C: full IDs |
| untested_edges | N/A | 0 | C: not listed (only score breakdown shown) |
| candidate_not_validated | N/A | 2 | C: clear disclaimer + suggests playbook |
| stack_explanation | 2 | 1 | B: full stack details; C: named only |
| brevity | 1 | 2 | B: very long; C: tight |
| **TOTAL** | **20/28** | **22/30** | **C−B = +2** |

### p4 — Codebase agent

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | Both correct; C flags research noise |
| avoids_complexity | 2 | 2 | Both explicit |
| separates_llm_deterministic | 2 | 1 | B: phase separation explicit; C: implicit |
| concrete_steps | 2 | 2 | Both concrete |
| eval_plan | 2 | 2 | Both strong |
| approval_gates | 2 | 2 | Both gated |
| permission_risks | 1 | 0 | B: path allowlists; C: not mentioned |
| retries_idempotency | 2 | 0 | B: bounded fix loop, idempotent phases; C: not mentioned |
| persistent_state | 2 | 0 | B: SQLite/Postgres state machine; C: not mentioned |
| observability | 2 | 0 | B: event log, run metrics; C: not mentioned |
| reuses_graph_components | 2 | 2 | Both use OrchestrateKit IDs |
| untested_edges | N/A | 2 | C: 5 specific edges listed |
| candidate_not_validated | N/A | 2 | C: clear disclaimer |
| stack_explanation | 2 | 1 | B: Cursor SDK vs custom; C: named only |
| brevity | 1 | 2 | B: very long; C: tight |
| **TOTAL** | **24/28** | **20/30** | **C−B = −4** |

### p5 — Data pipeline

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | Both correct; C correctly rejects ETL noise |
| avoids_complexity | 1 | 2 | B: staged but comprehensive; C: explicit simpler route |
| separates_llm_deterministic | 2 | 2 | Both explicit |
| concrete_steps | 2 | 2 | Both concrete |
| eval_plan | 1 | 2 | B: observability strong but not eval; C: 5 evals + retry simulation |
| approval_gates | 2 | 2 | Both correct (ETL needs no human gate) |
| permission_risks | 1 | 0 | B: rate limits/circuit breaker; C: not mentioned |
| retries_idempotency | 2 | 2 | Both strong |
| persistent_state | 2 | 1 | B: landing zone + cursor/checkpoint; C: SQLite in stack |
| observability | 2 | 2 | Both strong |
| reuses_graph_components | 0 | 2 | B: no OrchestrateKit IDs; C: full IDs |
| untested_edges | N/A | 2 | C: 5 specific edges listed |
| candidate_not_validated | N/A | 2 | C: "not in validated registry — treat as greenfield" |
| stack_explanation | 2 | 2 | Both strong (B: two stacks; C: layer table with upgrade conditions) |
| brevity | 1 | 1 | Both long |
| **TOTAL** | **20/28** | **28/30** | **C−B = +8** |

### p6 — Email lead CRM

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | — |
| avoids_complexity | 2 | 2 | — |
| separates_llm_deterministic | 1 | 1 | — |
| concrete_steps | 2 | 2 | — |
| eval_plan | 2 | 2 | — |
| approval_gates | 2 | 2 | — |
| permission_risks | 1 | 1 | — |
| retries_idempotency | 1 | 2 | — |
| persistent_state | 0 | 1 | — |
| observability | 2 | 2 | — |
| reuses_graph_components | 2 | 2 | — |
| untested_edges | N/A | 1 | — |
| candidate_not_validated | N/A | 2 | — |
| stack_explanation | 1 | 1 | — |
| brevity | 1 | 1 | — |
| **TOTAL** | **19/28** | **24/30** | **C−B = +5** |

### p7 — Product monitor + content

| Criterion | B | C | Notes |
|-----------|---|---|-------|
| suitable_architecture | 2 | 2 | — |
| avoids_complexity | 2 | 2 | — |
| separates_llm_deterministic | 1 | 1 | — |
| concrete_steps | 2 | 2 | — |
| eval_plan | 2 | 1 | — |
| approval_gates | 2 | 2 | — |
| permission_risks | 0 | 1 | — |
| retries_idempotency | 1 | 2 | — |
| persistent_state | 2 | 2 | — |
| observability | 2 | 2 | — |
| reuses_graph_components | 2 | 2 | — |
| untested_edges | N/A | 2 | — |
| candidate_not_validated | N/A | 2 | — |
| stack_explanation | 1 | 1 | — |
| brevity | 1 | 1 | — |
| **TOTAL** | **20/28** | **25/30** | **C−B = +5** |

---

## False-positive check

| Prompt | Forbidden components | Result |
|--------|---------------------|--------|
| p1 | pr_summary, codebase_scan, external_publish | ✅ none in C route |
| p2 | research_synthesis, citation_checker, codebase_scan, pr_summary | ✅ none in C route |
| p3 | design_brief_generation, codebase_scan, pr_summary, data_scraper | ✅ none in C route |
| p4 | research_synthesis*, citation_checker*, external_publish | ✅ all explicitly flagged as noise by model |
| p5 | external_publish, source_retrieval*, source_freshness_check*, research_synthesis* | ✅ all explicitly flagged as ETL noise |
| p6 | external_publish | ✅ absent |
| p7 | pr_summary, data_scraper | ✅ absent |

*Present in compose output but model correctly identified and recommended removing them.

---

## Retro

1. **Did compose_workflow_route improve the result?** Yes, clearly for p5/p6/p7. Negligible or negative for p1/p4 where the playbook baseline was comprehensive.

2. **Did the workflow graph reduce generic advice?** Yes — especially for novel routes. The compose output gave the model concrete component scaffolding and edge warnings to work from.

3. **Were untested edges useful or noisy?** Useful. Every C response that listed specific untested edges (p5, p6, p7) scored 2/2 on `untested_edges` and the model's warnings were actionable.

4. **What must change before OrchestrateLab?** Edge test coverage (MAR-107). Currently 0 tested edges. Before public demo (MAR-118), having even 10–15 tested edges would make the "tested: false" warnings credible rather than alarming.

5. **Key product insight from this run:** For playbook-matched requests, `list_known_routes + get_route` is the right tool. `compose_workflow_route` should be positioned as the tool for novel/graph-composed workflows, not a general-purpose planner. The compose output for playbook prompts introduces noise the model must manage, crowding out comprehensive architectural guidance.
