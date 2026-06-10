# Benchmark Takeaways & Improvement Ideas — 2026-06-09

Living log updated after each prompt is scored.  
**Does not train models** — feeds registry/tool/doc improvements and OrchestrateLab priorities.

---

## Cross-cutting patterns (so far)

| Pattern | Seen in | Improvement idea |
|---------|---------|------------------|
| `stack_explanation` often 1 in C | p1 | Prompt users to call `get_stack_recommendation` in Condition C setup |
| `avoids_complexity` often 1 when response adds 10+ components | p1 A/B | Add do-not-build rule or compose warning when step count > 8 without playbook match |
| `permission_risks` often 1 | p1 A/B | Enrich component YAML with `permissions` / `side_effects` fields for review rules |
| C wins on `untested_edges` + `candidate_not_validated` | p1, p2 | Keep as C-only rubric criteria |
| Compose drops `schema_validation` when publish in route | p2 | Safety augmenter must inject it |
| Compose step order misleads (external_publish early in list) | p2 | Document or fix ordering in tool output |
| Compose injects external_publish on ETL goals | p5 | Matcher + avoid_when conflict warning in compose output |
| `design_brief_generation` noise on email/calendar goals | p3 | Domain-guard design components unless content/design context |
| Condition A may leak registry if MCP still connected | p2 A, p3 A | Disable orchestratekit server for true vanilla A |
| Vanilla baseline very strong on high-risk flows | p3 A | Graph value is specificity + untested edges, not basic safety |

---

## p1 — Research workflow ✅

**Scores:** A 20/22 · B 22/24 · C 27/28 · **C−B = +5** (pass)

### What worked
- Condition C surfaced all 3 untested edges with concrete test actions
- Mandatory `human_approval_gate` + `external_publish` + `audit_log` chain well explained
- Domain guard fixed `pr_summary` false positive (was breaking research goals)

### Gaps / noise
- Compose route still omits `retry_policy` unless model/user adds it — user requirement in prompt not always reflected in compose output
- 14 tested edges helped score/confidence vs first run (0 tested)

### Improvement backlog
1. **Matcher:** When goal mentions "retry", auto-include `retry_policy` in compose (keyword already exists — verify augmenter)
2. **Route schema:** Add `sources` to routes so `get_relevant_docs` can surface route-level docs
3. **Tool output:** `recommend_architecture` should nudge `get_stack_recommendation` when stack_explanation is thin
4. **Playbook:** `research_agent_citations` overlap message in compose — make promotion steps explicit in tool markdown

---

## p2 — Content publish workflow ✅

**Scores:** A 21/22 · B 23/24 · C 28/28 · **C−B = +5** (pass)

### What worked
- All three conditions nailed approval-before-publish and audit_log
- B correctly used `content_approval_route_v1` and exact edge IDs
- C scored **28/28** — best possible; playbook-vs-compose diff was the standout value
- C explained compose step-order artifact (`external_publish` at step 2 ≠ runtime order)

### Gaps / noise
- **Condition A leaked registry context** — response cited golden path despite "vanilla" label; use MCP-off chat or disable orchestratekit server for clean A baseline
- Compose adds research cluster (`research_synthesis`, `citation_checker`, `plan_generation`) to content goals — same matcher noise as p1
- Compose **drops `schema_validation`** even though playbook requires it before `external_publish`
- B weak on `retries_idempotency` (1/2) — idempotency mentioned but no publish retry/backoff design

### Improvement backlog
1. **Safety augmenter:** When `external_publish` is in route, always inject `schema_validation` if missing (playbook requires it)
2. **Compose output:** Add `execution_order` separate from topological sort, or warn when step numbers ≠ edge-derived order
3. **Matcher:** Domain-guard or penalty for `research_synthesis` / `citation_checker` when goal is content/copy/publish without research keywords
4. **Tool markdown:** `compose_workflow_route` summary should say "prefer overlapping playbook X when confidence < 60%"
5. **Benchmark doc:** Fixed route ID to `content_approval_route_v1` (was wrong in prompts.yaml reference)

---

## p3 — Email/calendar assistant ✅

**Scores:** A 22/22 · B 24/24 · C 28/28 · **C−B = +4** (pass at threshold)

### What worked
- All three nailed separate approval for send vs calendar write
- B scored **24/24** — first perfect playbook condition
- C identified `design_brief_generation` as keyword noise and said to drop it
- A unusually strong (22/22) even without explicit graph drill-down — high-risk domain prompts well-covered by model training

### Gaps / noise
- Compose injects `design_brief_generation` on email/calendar goals (same cross-domain noise as p2 research cluster)
- Only 1 tested edge in compose path (`email_read__produces__intent_classifier`) — drives low confidence
- Condition A still mentions playbook at end — disable MCP for cleaner A baseline

### Improvement backlog
1. **Matcher:** Domain-guard `design_brief_generation` unless goal contains design/brief/visual keywords in content context (not just "draft")
2. **Compose:** When overlap with exact playbook ≥80%, tool should default recommendation to playbook route not composed list
3. **Registry:** Mark remaining 6 email/calendar edges as tested after integration test suite exists
4. **review_workflow_design:** Should flag `design_brief_generation` in email_calendar compose as graph noise

---

## p4 — Codebase agent ✅

**Scores:** A 21/22 · B 23/24 · C 27/28 · **C−B = +4** (pass at threshold)

### What worked
- All three enforced test_runner after code_editing (core playbook invariant)
- C reconciled compose "8 untested edges" → 3 that actually matter for coding subgraph
- A unusually aware of compose limitations despite being "vanilla" label
- B mapped all 8 components + edge severities from route

### Gaps / noise
- B claimed all 8 edges tested — registry has 5 tested, 3 untested (factual overstatement)
- Compose omits user_goal_intake + state_store vs golden path (same pattern as p2 schema_validation drop)
- A still references playbook by name — disable MCP for clean A

### Improvement backlog
1. **Compose:** When overlap with playbook ≥80%, prepend "use playbook route" and list missing golden-path components
2. **get_route output:** Show tested: true/false per edge inline so B cannot overstate
3. **Registry:** Mark 3 remaining untested coding edges after integration tests
4. **Matcher:** Compose should always include user_goal_intake for agent workflows

---

## p5 — Data pipeline ✅

**Scores:** A 20/22 · B 23/24 · C 27/28 · **C−B = +4** (pass at threshold)

### What worked
- C nailed `external_publish` as category error — best compose-critique so far
- B and C both cite `data_scraper__avoid__external_publish` critical edge
- A strong without registry (20/22) — graph adds +7 on C via untested edges + compose critique

### Gaps / noise
- Compose injects external_publish + source_retrieval + source_freshness_check into ETL goals
- stack_explanation consistently 1 in C across prompts

### Improvement backlog
1. **Matcher:** Block `external_publish` when goal tokens are extract/normalize/dedup/store (not publish/post)
2. **Matcher:** Block research/retrieval cluster on pure data-scrape goals
3. **Compose output:** When critical `avoid_when` edge conflicts with composed route, fail loudly in tool markdown
4. **Safety augmenter:** Do not auto-add external_publish to data extraction compositions

---

## p6 — Email lead + CRM (graph-composed) ✅

**Scores:** A 21/22 · B 20/24 · C 27/28 · **C−B = +7** (pass)

### What worked
- All three identified **`crm_note_write`** as the blocking registry gap
- C delivered per-edge validation procedures for all 7 untested edges + candidate route YAML
- C rejected `external_publish` as CRM substitute (correct semantics)
- A unusually strong (21/22) — dual approval + draft-only launch even without formal graph drill-down
- B excellent splice analysis at `intent_classifier` (email_calendar + research routes)

### Gaps / noise
- Compose topological sort puts `optional_email_send` at step 2 — C correctly reordered
- A leaked compose context (45/100) despite "vanilla" label — disable orchestratekit MCP for clean A
- B thin on eval list and stack table (20/24 vs A 21/22)
- `stack_explanation` still 1/2 in C (consistent weak spot across prompts)

### Improvement backlog
1. **Registry:** Add `crm_note_write` + `lead_classifier` edges for OrchestrateLab
2. **Compose:** Separate execution order from topological sort; warn on step-number artifacts
3. **Matcher:** Resolve `intent_classifier` requires `user_goal_intake` when intake is `email_read`
4. **get_route:** Show `tested: true/false` per edge inline

---

## p7 — Docs monitor + publish (graph-composed) ✅

**Scores:** A not run · B 23/24 · C 27/28 · **C−B = +4** (pass)

### What worked
- B: best graph-composed B score (23/24) — data_extraction + content_approval splice; explicit `pr_summary` drop
- C: **three zero-edge bridges** flagged (job_queue→page_monitor, diff→ranking, synthesis→brief intake)
- Both: `schema_validation` before publish (playbook pattern compose omits)
- C: 33% compose score honestly drives candidate disclaimer

### Gaps / noise
- B and C chose different playbook pairs for Phase 1/2 (data_extraction vs research) — both valid
- C adds `source_ranking` + `job_queue` — richer but heavier than minimum route
- A not run — disable MCP for clean vanilla baseline if re-benchmarking
- `content_ideas` still no dedicated component — proxied via `content_idea_intake`

### Improvement backlog
1. **Registry edges:** `research_synthesis → content_idea_intake`; document synthesis→brief adapter
2. **Matcher:** `pr_summary` domain guard (B caught it; compose still injects)
3. **Matcher:** Prefer `page_monitor` over `data_scraper` for monitor/docs keywords
4. **Compose:** Recommend playbook splice when data_extraction + content_approval overlap >80%

---

## Prioritized fixes after all 7 prompts

1. **Matcher domain guards** — block external_publish on ETL; block research/design/pr_summary clusters on wrong domains
2. **Safety augmenter** — inject schema_validation when external_publish present; never drop on compose
3. **Compose output** — show tested:true per edge; separate execution_order from sort; playbook recommendation at ≥80% overlap
4. **New registry work** — `crm_note_write`; synthesis→brief bridge edge; mark edges tested after integration suite
5. **page_monitor** — exists; all page_monitor edges still untested — priority integration tests for p7 route

---
