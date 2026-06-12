# OrchestrateKit MCP — Benchmark Results

**Protocol version:** v2
**Run date:** 2026-06-11
**Tester:** Henrik
**Client:** Cursor
**Model:** claude-sonnet (Cursor) for B/C; Condition A p6/p7 on Claude.ai web
**Model version / snapshot:** <!-- exact version string if available -->
**MCP server version:** 0.1.0
**Registry — source at run:** 32 components, 53 edges loaded (33/54 files incl. `_template`)
**Registry — LIVE SERVER actually served:** ⚠️ 32 components / **51 edges**, stale `dist/` built 2026-06-09, MISSING `crm_note_write` + `research_synthesis→content_idea_intake` bridge
**Settings:**
  - temperature: default
  - web search: disabled
  - tools (B/C): list_known_routes, get_route, compose_workflow_route, get_graph_component, get_stack_recommendation
  - tools (A): none
**Condition A isolation confirmed:** yes (p1–p5 Cursor MCP-off; p6/p7 on Claude.ai web — no filesystem)

---

## 🚨 RUN VERDICT: CONTAMINATED — do not certify the gate from this run

The live MCP server ran a **stale `dist/` build (2026-06-09)** that predated MAR-95. It served 32 components / **51 edges**, missing `crm_note_write` and the `research_synthesis→content_idea_intake` bridge. The local `tsx` benchmark script (which produced the embedded compose blocks below) read the **fresh** root `registry/` and is correct — so the compose outputs in this file diverge from what the model actually saw live in p6/p7.

| Condition | Validity | Reason |
|-----------|----------|--------|
| A (all 7) | ✅ valid | no MCP — build-independent |
| B (all 7) | ✅ valid | playbooks unchanged by MAR-95 |
| C p1–p5 | ✅ valid | those components predate MAR-95 |
| **C p6** | ❌ invalid | live compose lacked `crm_note_write` (the must_have) |
| **C p7** | ❌ invalid | live compose lacked the bridge edge |

**Actions taken:** `dist/` rebuilt (now 33 files / loads 32+53 incl. crm). Filed **MAR-114** (build-hygiene guard, blocks MAR-98) and **MAR-115** (compose route-quality: p7 publish suppression, p1 bridge bleed, p6 order). MAR-95 marked Done. Gate cannot pass until MAR-114 lands and p6/p7-C are re-run on a fresh build.

### Fresh-build Condition C route-quality scorecard (local compose, 32/53)

| Prompt | Status | Score | Must-haves | Forbidden present? | Verdict |
|--------|--------|-------|-----------|--------------------|---------|
| p1 Research | candidate | 56 | all ✅ | none ✅ (`content_idea_intake` noise, non-forbidden) | good |
| p2 Content | candidate | 50 | all ✅ | none ✅ | clean |
| p3 Email/cal | low_conf | 47 | all ✅ | none ✅ | clean |
| p4 Codebase | candidate | 56 | all ✅ | none ✅ | clean (MAR-88 holds) |
| p5 ETL | candidate | 56 | all ✅ | none ✅ | clean (MAR-88 holds) |
| p6 CRM | low_conf | 35 | all ✅ (`crm_note_write` ✅) | none ✅ | works but noisy + mis-ordered → MAR-115 |
| p7 Monitor | **blocked** | 40 | ❌ `external_publish` suppressed | none | **route-quality bug → MAR-115** |

> Note: the earlier "P4 pulls research_synthesis / P5 pulls forbidden trio" observation was the **stale live build**, not current code. Fresh `src` p4/p5 are clean.

---

## Summary scores

| Prompt | A (/24) | B (/28) | C (/30) | C − B |
|--------|---------|---------|---------|-------|
| p1 Research workflow | — | — | — | — |
| p2 Content publish | — | — | — | — |
| p3 Email/calendar | — | — | — | — |
| p4 Codebase agent | — | — | — | — |
| p5 Data pipeline | — | — | — | — |
| p6 Email lead CRM | — | — | — | — |
| p7 Product monitor | — | — | — | — |
| **Average** | — | — | — | **—** |

Gate: average C − B ≥ +4 across all 7 prompts.

---

## p1 — Research workflow with citations and human review

**Category:** single_workflow | **Playbook:** research_agent_citations

**Prompt (paste verbatim):**
```
Build an AI research workflow that:
- retrieves sources from multiple origins
- checks source freshness and ranks by recency/relevance
- synthesizes a structured summary with inline citations
- adds retries when source retrieval fails
- requires human review before the summary is published
What components, edges, approval gates and eval strategy would you recommend?
```

**Must-have:** source_retrieval, research_synthesis, citation_checker, human_approval_gate
**Nice to have:** source_ranking, source_freshness_check, retry_policy, audit_log
**FORBIDDEN:** pr_summary, codebase_scan, external_publish

**Condition B setup calls:**
```
list_known_routes({})
get_route({ id: "research_agent_citations_route_v1", include_component_details: true })
```

**Condition C — compose_workflow_route output:**
```
Status:     candidate_route
Score:      56/100
Confidence: 56%

Route:
  1. source_retrieval             [risk: low]
  2. source_ranking               [risk: low]
  3. research_synthesis           [risk: medium]
  4. content_idea_intake          [risk: low]   ⚠ questionable — pulled via research_synthesis bridge
  5. source_freshness_check       [risk: low]
  6. citation_checker             [risk: low]
  7. human_approval_gate          [risk: low]
  8. audit_log                    [risk: low]

Approval gates: human_approval_gate
Untested edges: citation_checker__compatible__source_freshness_check,
  research_synthesis__produces__content_idea_intake,
  research_synthesis__requires__citation_checker,
  research_synthesis__requires__source_freshness_check,
  source_ranking__produces__research_synthesis ...
Overlapping playbooks: research_agent_citations
```

> **Note:** `content_idea_intake` at step 4 is a potential false positive — the `research_synthesis→content_idea_intake`
> bridge edge (MAR-95) is pulling it in even though this is a pure research goal. Flag if present in C response.

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `pr_summary`, `codebase_scan`, `external_publish` in route? <!-- yes/no + notes -->

---

## p2 — Content workflow from idea to public publishing

**Category:** single_workflow | **Playbook:** content_approval_pipeline

**Prompt (paste verbatim):**
```
Build a content workflow for a brand that:
- starts from a content brief or campaign idea
- generates copy variants
- hands off to a design tool (like Canva or Figma) for visual creation
- requires marketing approval before publishing
- publishes to a public channel
What components, safety gates, stack choices and observability would you recommend?
```

**Must-have:** content_idea_intake, copy_generation, human_approval_gate, external_publish
**Nice to have:** design_brief_generation, audit_log, schema_validation
**FORBIDDEN:** research_synthesis, citation_checker, codebase_scan, pr_summary

**Condition B setup calls:**
```
list_known_routes({})
get_route({ id: "content_approval_pipeline_route_v1", include_component_details: true })
```

**Condition C — compose_workflow_route output:**
```
Status:     candidate_route
Score:      50/100
Confidence: 50%

Route:
  1. user_goal_intake             [risk: low]
  2. content_idea_intake          [risk: low]
  3. schema_validation            [risk: low]
  4. intent_classifier            [risk: low]
  5. copy_generation              [risk: medium]
  6. design_brief_generation      [risk: low]
  7. state_store                  [risk: low]
  8. human_approval_gate          [risk: low]
  9. external_publish             [risk: high]
  10. audit_log                   [risk: low]

Approval gates: human_approval_gate
Overlapping playbooks: content_approval_pipeline

Warnings:
  ⚠  Added schema_validation before the external-write step.
  ⚠  PLAYBOOK-FIRST: overlaps content_approval_pipeline at 100% recall / 70% precision.
  ⚠  10 components — consider simplifying.
```

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `research_synthesis`, `citation_checker`, `codebase_scan`, `pr_summary`? <!-- yes/no + notes -->

---

## p3 — Email and calendar assistant with safe scheduling

**Category:** single_workflow | **Playbook:** email_calendar_assistant

**Prompt (paste verbatim):**
```
Build an AI assistant that:
- reads the user's email inbox
- identifies emails that need replies or require meeting scheduling
- drafts replies and calendar invites
- presents drafts to the user for approval before sending
- only sends or books after explicit human confirmation
What architecture, safety constraints and risk mitigations would you recommend?
```

**Must-have:** email_read, email_draft, human_approval_gate
**Nice to have:** calendar_lookup, calendar_write, intent_classifier, optional_email_send, audit_log
**FORBIDDEN:** design_brief_generation, codebase_scan, pr_summary, data_scraper

**Condition B setup calls:**
```
list_known_routes({})
get_route({ id: "email_calendar_assistant_route_v1", include_component_details: true })
```

**Condition C — compose_workflow_route output:**
```
Status:     low_confidence
Score:      47/100
Confidence: 47%

Route:
  1. user_goal_intake             [risk: low]
  2. email_read                   [risk: low]
  3. calendar_lookup              [risk: low]
  4. schema_validation            [risk: low]
  5. intent_classifier            [risk: low]
  6. email_draft                  [risk: medium]
  7. human_approval_gate          [risk: low]
  8. optional_email_send          [risk: high]
  9. calendar_write               [risk: high]
  10. audit_log                   [risk: low]

Approval gates: human_approval_gate
Overlapping playbooks: email_calendar_assistant

Warnings:
  ⚠  Added schema_validation before the external-write step.
  ⚠  PLAYBOOK-FIRST: overlaps email_calendar_assistant at 100% recall / 80% precision.
  ⚠  10 components — consider simplifying.
```

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `design_brief_generation`, `codebase_scan`, `pr_summary`, `data_scraper`? <!-- yes/no + notes -->

---

## p4 — Codebase agent: plan, edit, test, PR summary

**Category:** single_workflow | **Playbook:** codebase_agent_workflow

**Prompt (paste verbatim):**
```
Build a codebase AI agent that:
- scans an existing codebase to understand structure and patterns
- receives a feature or bug-fix task description
- produces an implementation plan
- makes code edits
- runs the test suite
- writes a PR summary
What workflow, components, guardrails and evaluation strategy would you recommend?
```

**Must-have:** codebase_scan, code_editing, test_runner, pr_summary
**Nice to have:** plan_generation, human_approval_gate, audit_log
**FORBIDDEN:** research_synthesis, citation_checker, copy_generation, design_brief_generation, external_publish

**Condition B setup calls:**
```
list_known_routes({})
get_route({ id: "codebase_agent_workflow_route_v1", include_component_details: true })
```

**Condition C — compose_workflow_route output:**
```
Status:     candidate_route
Score:      56/100
Confidence: 56%

Route:
  1. job_queue                    [risk: low]
  2. codebase_scan                [risk: low]
  3. plan_generation              [risk: low]
  4. code_editing                 [risk: medium]
  5. test_runner                  [risk: low]
  6. pr_summary                   [risk: low]
  7. human_approval_gate          [risk: low]
  8. audit_log                    [risk: low]

Approval gates: human_approval_gate
Overlapping playbooks: codebase_agent_workflow
```

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `research_synthesis`, `citation_checker`, `copy_generation`, `design_brief_generation`, `external_publish`? <!-- yes/no + notes -->

---

## p5 — Data extraction pipeline with deduplication and audit

**Category:** single_workflow | **Playbook:** data_extraction_enrichment

**Prompt (paste verbatim):**
```
Build a data extraction and enrichment pipeline that:
- scrapes or pulls data from an external source
- normalizes the schema
- deduplicates records
- validates against a target schema
- handles partial failures gracefully with retries
- writes an audit log for every record processed
What components, error handling and observability strategy would you recommend?
```

**Must-have:** data_scraper, data_normalizer, deduplication, schema_validation, audit_log
**Nice to have:** retry_policy, job_queue
**FORBIDDEN:** external_publish, source_retrieval, source_freshness_check, research_synthesis

**Condition B setup calls:**
```
list_known_routes({})
get_route({ id: "data_extraction_enrichment_route_v1", include_component_details: true })
```

**Condition C — compose_workflow_route output:**
```
Status:     candidate_route
Score:      56/100
Confidence: 56%

Route:
  1. user_goal_intake             [risk: low]
  2. data_scraper                 [risk: medium]
  3. job_queue                    [risk: low]
  4. data_normalizer              [risk: low]
  5. deduplication                [risk: low]
  6. schema_validation            [risk: low]
  7. human_approval_gate          [risk: low]
  8. audit_log                    [risk: low]

Approval gates: human_approval_gate
Overlapping playbooks: data_extraction_enrichment
```

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `external_publish`, `source_retrieval`, `source_freshness_check`, `research_synthesis`? <!-- yes/no + notes -->

---

## p6 — Email lead detection + CRM notes

**Category:** graph_composed | **Playbook:** none — graph-composed

**Prompt (paste verbatim):**
```
Build a workflow that:
- reads my email inbox
- identifies emails that might be sales leads or partnership opportunities
- researches the sender's company automatically
- writes a CRM note summarising what was found
- drafts a personalised follow-up email for human review
- only sends the email after explicit approval
This workflow does not exist as a validated playbook. Propose a candidate
route using the workflow graph.
```

**Must-have:** email_read, crm_note_write, email_draft, human_approval_gate
**Nice to have:** intent_classifier, source_retrieval, research_synthesis, optional_email_send, state_store, audit_log
**FORBIDDEN:** external_publish (must NOT substitute for crm_note_write)

**Condition B setup calls:**
```
list_known_routes({})  → confirm no exact match
```

**Condition C — compose_workflow_route output:**
```
Status:     low_confidence
Score:      35/100
Confidence: 35%

Route:
  1. source_retrieval             [risk: low]
  2. crm_note_write               [risk: high]   ⚠ ordering issue — before email_read flows complete
  3. email_read                   [risk: low]
  4. schema_validation            [risk: low]
  5. source_ranking               [risk: low]
  6. research_synthesis           [risk: medium]
  7. citation_checker             [risk: low]    ⚠ questionable for CRM goal
  8. source_freshness_check       [risk: low]
  9. email_draft                  [risk: medium]
  10. human_approval_gate         [risk: low]
  11. optional_email_send         [risk: high]
  12. audit_log                   [risk: low]

Approval gates: human_approval_gate
Untested edges: crm_note_write__requires__human_approval_gate,
  email_draft__safer_with__human_approval_gate,
  optional_email_send__requires__human_approval_gate ...
Overlapping playbooks: research_agent_citations, email_calendar_assistant

Warnings:
  ⚠  Added schema_validation before external-write step.
  ⚠  12 components — consider simplifying.
```

> **Note:** Low confidence (35%) and ordering issues suggest the compose engine struggled with this
> cross-domain goal. The LLM response with compose context (C) should still beat B significantly.
> Check that the response does NOT substitute `external_publish` for `crm_note_write`.

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `external_publish` in place of `crm_note_write`? <!-- yes/no + notes -->

---

## p7 — Product docs monitor + content ideas + publish approval

**Category:** graph_composed | **Playbook:** none — graph-composed

**Prompt (paste verbatim):**
```
Build a workflow that:
- monitors product documentation pages for updates
- summarises significant changes
- extracts content ideas from the changes (blog posts, tweets, changelogs)
- routes ideas for approval
- publishes approved content
This workflow does not exist as a validated playbook. Propose a candidate
route using the workflow graph, and explain the edges that are untested.
```

**Must-have:** page_monitor, human_approval_gate, external_publish
**Nice to have:** source_freshness_check, research_synthesis, content_idea_intake, copy_generation, state_store, audit_log
**FORBIDDEN:** pr_summary, data_scraper

**Condition B setup calls:**
```
list_known_routes({})  → confirm no exact match
```

**Condition C — compose_workflow_route output:**
```
Status:     blocked_candidate
Score:      40/100
Confidence: 40%

Route:
  1. user_goal_intake             [risk: low]
  2. page_monitor                 [risk: low]
  3. research_synthesis           [risk: medium]
  4. content_idea_intake          [risk: low]
  5. schema_validation            [risk: low]
  6. copy_generation              [risk: medium]
  7. citation_checker             [risk: low]
  8. source_freshness_check       [risk: low]
  9. state_store                  [risk: low]
  10. human_approval_gate         [risk: low]
  11. external_publish            [risk: high]
  12. audit_log                   [risk: low]

Approval gates: human_approval_gate
Overlapping playbooks: content_approval_pipeline, research_agent_citations

Warnings:
  ⚠  BLOCKED: violates critical avoid_when edge: research_synthesis ✗ external_publish
  ⚠  Added schema_validation before external-write step.
```

> **Note:** `blocked_candidate` status — the compose engine correctly fires a safety warning because
> `research_synthesis` leads directly toward `external_publish` without sufficient guards. The LLM
> should see this warning and explain why the route is a candidate (not validated) and what guards
> are needed. Score `candidate_not_validated` and `untested_edges` accordingly.
> Also check: no `pr_summary` or `data_scraper` in response.

**Condition A response:** <!-- paste full response -->

**Condition B response:** <!-- paste full response -->

**Condition C response:** <!-- paste full response -->

**Scoring:**

| Criterion | A (0-2) | B (0-2) | C (0-2) | Notes |
| -------------------------------- | ------- | ------- | ------- | ----- |
| suitable_architecture            |    —    |    —    |    —    |       |
| avoids_complexity                |    —    |    —    |    —    |       |
| separates_llm_deterministic      |    —    |    —    |    —    |       |
| persistent_state                 |    —    |    —    |    —    |       |
| approval_gates                   |    —    |    —    |    —    |       |
| permission_risks                 |    —    |    —    |    —    |       |
| eval_plan                        |    —    |    —    |    —    |       |
| retries_idempotency              |    —    |    —    |    —    |       |
| observability                    |    —    |    —    |    —    |       |
| concrete_steps                   |    —    |    —    |    —    |       |
| reuses_graph_components          |   N/A   |    —    |    —    |       |
| untested_edges                   |   N/A   |   N/A   |    —    |       |
| candidate_not_validated          |   N/A   |   N/A   |    —    |       |
| stack_explanation                |    —    |    —    |    —    |       |
| brevity                          |    —    |    —    |    —    |       |
| **TOTAL**                        | — / 24  | — / 28  | — / 30  |       |

**False-positive check:** No `pr_summary`, `data_scraper` in response? <!-- yes/no + notes -->

---

## Retro questions (answer after all prompts are scored)

1. Did `compose_workflow_route` improve the result?
2. Did the workflow graph reduce generic advice?
3. Were untested edges useful or noisy?
4. Add more components/edges, simplify graph, or return to playbook-first?
5. What must change before starting OrchestrateLab?

---

## Compose engine issues observed (pre-run)

These were noted from the Condition C local outputs before running LLM sessions:

| Prompt | Issue | Severity |
|--------|-------|----------|
| p1 | `content_idea_intake` appears in research route via bridge edge — likely false positive | medium |
| p6 | `crm_note_write` at step 2 (before email_read); `citation_checker` pulled in for CRM goal | medium |
| p6 | Low confidence (35%) — cross-domain goal stressed the composer | low |
| p7 | `blocked_candidate` status; 12 components | low |

Consider filing graph improvement tickets if these recur in actual LLM responses.
