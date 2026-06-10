# OrchestrateKit MCP — M2 Retro

**Milestone:** M2 — OrchestrateKit MCP local MVP  
**Date:** June 2026  
**Status:** Complete — OrchestrateLab can start.

---

## What works?

- **Workflow graph registry** — components, edges, routes, playbooks, stacks all load and validate via Zod. Unknown fields are silently discarded rather than crashing.
- **Route composition** (`compose_workflow_route`) — the capability matcher + safety augmenter + route scorer produces useful candidate routes for goals that have no exact playbook. Coverage, confidence, and untested-edge visibility all work.
- **Playbook retrieval** (`get_playbook`) — finds playbooks by ID or by workflow-type fuzzy match. Graph context (route, components, edges, stack, approval gates) is returned on request.
- **Docs index** (`get_relevant_docs`) — the lightweight YAML docs-index with tag-based matching works well enough for v0.1. Three seed entries (OpenAI Agents, Anthropic MCP, Cursor MCP) are loaded.
- **Architecture recommendation** (`recommend_architecture`) — wraps compose, step classification, anti-pattern rules, and playbook overlap. The do-not-build rules catch the most common mistakes (missing approval gate, unnecessary vector DB, multi-agent over-engineering).
- **Safety review** (`review_workflow_design`) — deterministic rule engine covers approval gates, state management, tool safety, architecture anti-patterns, and graph integrity. Risk scoring and pass/warnings/fail status work correctly.
- **Smoke tests** — all 12 registered M2 tools are covered by `tests/smoke/mcpToolsSmoke.test.ts`. `pnpm verify` passes.
- **Local stdio setup** — no auth, no remote hosting. Works in Cursor and Claude Desktop via a single JSON config.

---

## What is noisy?

- **Zod silently drops unknown registry fields.** Fields like `notes`, `failure_modes`, and `evals` on routes are parsed in playbooks but not in the route schema. This is fine for v0.1 but the registry data silently loses those fields on routes.
- **Score thresholds are arbitrary.** The `route_score` (0–100) and `confidence` values were not calibrated against real user sessions. They should be validated in OrchestrateLab before being used to block or gate anything.
- **Capability matching is keyword-based.** The matcher scores component capabilities by substring overlap against the goal text. This works surprisingly well but will break on unusual phrasing. A richer embedding-based approach is a future option — but not before we have benchmark data.
- **Step classification heuristics need tuning.** LLM vs. deterministic classification relies on keyword token lists. Edge cases exist (e.g. a "retry" step mis-classified as deterministic when it wraps an LLM call).
- **`get_relevant_docs` is thin.** Three docs-index entries are not enough to be genuinely useful. The docs-index format is good; the content needs to grow.

---

## Which graph outputs are useful?

Most useful in practice:

1. **Untested edge visibility** — surfacing edges not yet validated in production is the single highest-value output. Users consistently don't know which parts of their design are experimental.
2. **Approval gate inference** — the rule that fires when `external_publish` / email / calendar-write is present without `human_approval_gate` prevents a whole class of dangerous automations.
3. **Do-not-build rules** — "you don't need a vector DB for this" has already changed architectural decisions during development.
4. **Route step classification** — knowing which steps are LLM-driven vs. deterministic changes how users think about error handling and cost.

Less useful so far:

- **Route confidence score** — users find the score opaque. A breakdown (coverage, tested edges, stack fit) is more useful than the aggregate number.
- **Playbook `avoid_when` warnings** — these only fire when a matching playbook is found, which limits their reach.

---

## Which route/composition assumptions were wrong?

- **Assumption: exact playbook match would be rare.** Reality: the two existing playbooks (`data_extraction_enrichment`, `codebase_agent_workflow`) match a surprisingly large portion of the test goals. We need more playbooks to cover the full range of common workflow types.
- **Assumption: routes would always need safety augmentation.** Reality: many user goals already include safety components in the natural capability match. The augmenter fires less often than expected.
- **Assumption: the `research_route_v1` route schema `sources` field could be ignored.** Reality: it means route-level source documentation is not surfaced in `get_relevant_docs`. This should be fixed in M3 by extending the route schema.

---

## Which old M2 issues were deferred and why?

| Issue | Decision | Reason |
|-------|----------|--------|
| MAR-45 `generate_eval_plan` | Deferred | Eval plan generation requires LLM calls or a much richer registry. Not useful without OrchestrateLab usage data to drive the templates. |
| MAR-46 `generate_implementation_pack` | Deferred | An implementation pack that just wraps playbook + route data adds little over `get_playbook` with `include_graph=true`. Revisit when OrchestrateLab has run real sessions and identified what "a good pack" looks like. |

---

## Is OrchestrateLab ready to start?

**Yes.**

All four M2 tools are implemented, tested, and verified. The local stdio server
connects correctly in both Cursor and Claude Desktop. The registry is small but
coherent. The safety rules are deterministic and explainable.

The benchmark (`docs/BENCHMARKING.md`) should be run during the first OrchestrateLab
session to confirm the graph tools produce measurably better advice than vanilla
Claude/Cursor on the same planning prompts.

---

## Next recommended Linear issue

**Start OrchestrateLab as a sibling repo: `../orchestratelab`**

Suggested first issues for OrchestrateLab:

1. **OL-01** — Scaffold the OrchestrateLab Research App (Next.js or similar) that
   calls the OrchestrateKit MCP via stdio or eventually an HTTP adapter.

2. **OL-02** — Run the first five architecture sessions using the MCP, capture the
   prompts and tool outputs, and validate which outputs were actually useful.

3. **OL-03** — Use session data to add 3–5 new playbooks to the registry that cover
   the most common workflow types encountered.

4. **Back in MCP repo: MAR-XX** — Add `sources` field to the route schema so
   route-level documentation is surfaced by `get_relevant_docs`.

Do not add OrchestrateLab code to this repo. It belongs at `../orchestratelab` and
can export approved registry files into `../orchestratekit-mcp/registry` when needed.
