# Benchmark Results — Example / Template

> **Status:** Example file with one completed run (p1) and placeholders for the rest.
> Replace `[PLACEHOLDER]` sections with actual scores after running the benchmark.
> See `docs/BENCHMARKING.md` for instructions.

**Date:** _fill in_
**Tester:** _fill in_
**MCP server version:** 0.1.0
**Registry:** 30 components, 47 edges, 5 routes, 5 playbooks (at time of run)

---

## How to read this file

- **Score format:** `X / Y` where Y = applicable maximum for that condition.
- **Condition A** max = 22 (11 criteria × 2)
- **Condition B** max = 24 (12 criteria × 2)
- **Condition C** max = 28 (14 criteria × 2)
- **N/A** = criterion not applicable for this condition.
- Cells marked `—` are not yet run.

---

## Prompt p1 — Research Workflow with Citations

> "Build a research workflow with citations, source freshness checks, retries
> and human review."

### Condition A — Vanilla Cursor/Claude

| Criterion                     | Score | Notes |
|-------------------------------|-------|-------|
| suitable_architecture         | 2     | Recommended a linear pipeline. Correct. |
| avoids_complexity             | 1     | Suggested multi-agent setup unnecessarily. |
| separates_llm_deterministic   | 1     | Mentioned "use code for dedup" but left freshness check in LLM path. |
| persistent_state              | 0     | Did not mention state between retry attempts. |
| approval_gates                | 1     | Mentioned "review before publish" but not an explicit gate component. |
| permission_risks              | 0     | Did not address API key scope or rate limits. |
| eval_plan                     | 1     | Said "test citation accuracy" without a rubric. |
| retries_idempotency           | 1     | Mentioned retries, no idempotency guidance. |
| observability                 | 0     | No logging mentioned. |
| concrete_steps                | 1     | Good component list, vague implementation. |
| stack_explanation             | 1     | Mentioned TypeScript but no rationale. |
| **Total A**                   | **9 / 22** | |

### Condition B — OrchestrateKit MCP (playbooks only)

*MCP calls made before prompt:*
```
list_known_routes → research_agent_citations_route_v1
get_route({ id: "research_agent_citations_route_v1", include_component_details: true })
```

| Criterion                     | Score | Notes |
|-------------------------------|-------|-------|
| suitable_architecture         | 2     | Referenced the validated route directly. |
| avoids_complexity             | 2     | Used the playbook's linear structure, did not gold-plate. |
| separates_llm_deterministic   | 2     | Correctly placed source_freshness_check as a deterministic step. |
| persistent_state              | 1     | Mentioned state_store from playbook context but no retry state. |
| approval_gates                | 2     | human_approval_gate present from playbook. |
| permission_risks              | 1     | Named the source retrieval API risk, missed auth scope discussion. |
| eval_plan                     | 2     | Playbook evals carried through to response. |
| retries_idempotency           | 1     | Mentioned retry_policy component. No idempotency detail. |
| observability                 | 1     | Mentioned audit_log. No structured log format. |
| concrete_steps                | 2     | Cited component IDs and their purpose. |
| reuses_graph_components       | 2     | Used all 6 expected components. |
| stack_explanation             | 1     | Default stack mentioned, no alternatives. |
| **Total B**                   | **19 / 24** | +10 vs A |

### Condition C — OrchestrateKit MCP (full graph)

*MCP calls made before prompt:*
```
compose_workflow_route({
  goal: "research workflow with citations, source freshness, retries and human review",
  output_depth: "standard"
})
get_graph_component({ id: "source_freshness_check", include_edges: true })
get_stack_recommendation({})
```

| Criterion                     | Score | Notes |
|-------------------------------|-------|-------|
| suitable_architecture         | 2     | Route composition matched the validated playbook. |
| avoids_complexity             | 2     | No unnecessary agents. |
| separates_llm_deterministic   | 2     | Freshness check explicitly labelled as deterministic. |
| persistent_state              | 2     | state_store added via requires edge. |
| approval_gates                | 2     | human_approval_gate in route. |
| permission_risks              | 2     | Permission risks surfaced from component risk_level fields. |
| eval_plan                     | 2     | evals_to_add list from route output used directly. |
| retries_idempotency           | 2     | retry_policy component included in route. |
| observability                 | 2     | audit_log added automatically by safety augmenter. |
| concrete_steps                | 2     | Component IDs + purposes from route steps used in response. |
| reuses_graph_components       | 2     | All expected components present. |
| untested_edges                | 1     | Listed untested edges. Did not explain what tests to write. |
| candidate_not_validated       | 2     | Route was labelled candidate_route by the tool. Response respected that. |
| stack_explanation             | 2     | get_stack_recommendation output used to explain choices. |
| **Total C**                   | **27 / 28** | +8 vs B, +18 vs A |

### p1 summary

| Condition | Score  | Delta |
|-----------|--------|-------|
| A         | 9 / 22 | baseline |
| B         | 19 / 24 | +10 |
| C         | 27 / 28 | +18 vs A |

**Gaps found:**
- Condition A has zero observability and zero permission-risk discussion.
- Condition B improves significantly but lacks idempotency depth.
- Condition C is near-perfect but untested edge explanation is weak — the tool
  lists IDs but does not tell the developer _what_ to test.
- **Improvement needed:** `get_graph_edge` should include a `testing_hint` field.

---

## Prompt p2 — Content Publish Workflow

_[PLACEHOLDER — run after p1]_

| Condition | Score | Notes |
|-----------|-------|-------|
| A         | — / 22 | |
| B         | — / 24 | |
| C         | — / 28 | |

---

## Prompt p3 — Email/Calendar Assistant

_[PLACEHOLDER]_

---

## Prompt p4 — Codebase Agent

_[PLACEHOLDER]_

---

## Prompt p5 — Data Extraction Pipeline

_[PLACEHOLDER]_

---

## Prompt p6 — Email Lead CRM (graph-composed)

_[PLACEHOLDER — requires condition C only, compare compose_workflow_route vs. playbook lookup]_

**Pre-run checklist:**
- [ ] Call `list_known_routes` first to confirm no exact playbook exists for this goal.
- [ ] Call `compose_workflow_route` with the p6 goal.
- [ ] Compare to the expected output in `graph-composed-routes.example.md`.
- [ ] Score condition C using the full 14-criterion rubric.

---

## Prompt p7 — Product Docs Monitor + Publish (graph-composed)

_[PLACEHOLDER]_

---

## Retro Questions

> Answer these after at least 4 prompts are scored.

**Did `compose_workflow_route` improve the result?**
> _[Answer after running]_
> Based on p1: Yes, clearly. Condition C scored 27/28 vs 9/22 for vanilla.
> The main improvement was safety gates, observability and concrete component reuse.

**Did the workflow graph reduce generic advice?**
> _[Answer after running]_
> In p1: Yes. Condition A gave advice like "add logging" with no specifics.
> Condition C named `audit_log` as a specific component with a defined edge.

**Were untested edges useful or noisy?**
> _[Answer after running]_
> The untested edge list in p1 was useful as a flag but lacked actionable guidance.
> The tool should explain _what_ an integration test for that edge would check.

**Should we add more components/edges, simplify the graph or return to playbook-first?**
> _[Answer after running]_
> Tentative: keep the graph but add `testing_hint` to edge definitions.
> The playbook overlap detection is working well — no need to revert to playbook-only.

**What must change before starting OrchestrateLab?**
> _[Answer after running]_
> Minimum changes based on p1 findings:
> 1. Add `testing_hint` field to edge schema.
> 2. Add more tested edges (currently ~40% of edges are untested).
> 3. Improve `score_breakdown.untested_edge_penalty` explanation in tool output.
