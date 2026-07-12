# Golden-flow case study — goal to hosted agent, 2026-07-12

> **Status:** Completed, verified end to end. Not a vanilla-vs-composed rubric
> run (see `results-*.md` / `PROTOCOL.md` for that format) — this is a
> stopwatch case study of the full pipeline: `plan_workflow` →
> `export_build_brief` → real implementation → real hosted run. Feeds the
> MAR-355 Wave 0 90-second golden-flow GIF and the MAR-118 "try it yourself"
> benchmark proof.

**Date:** 2026-07-12
**Tester:** Henrik (via Claude Code)
**MCP server:** hosted endpoint, `orchestratekit-mcp` v0.1.0, registry fingerprint `885bacdd6a086b45` (64 components / 151 edges / 12 routes / 12 playbooks, `safe_to_demo: true`)
**Goal used (verbatim, no clarifying questions):** "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval."

## Timing

| Stage | Timestamp (UTC) | Elapsed |
|---|---|---|
| Goal submitted (`plan_workflow`) | 08:59:18.921 | — |
| **Product card rendered** | 08:59:24.288 | **5.4s** (budget: <90s) |
| Build brief exported (`export_build_brief`) | 08:59:38.703 → 08:59:52.146 | 13.4s |
| Scaffolding started | ~09:00:37 | — |
| **First successful local run** | 09:05:18.941 (125ms runtime) | ~4m42s implementation |
| Pushed to `master`, `workflow_dispatch` triggered | 09:10:41.202 | — |
| **Hosted run green on GitHub Actions** | 09:11:09 | 21s job time |
| **Total: goal → hosted** | | **~11m50s** |

Route matched a validated playbook (`email_lead_to_crm` / `email_lead_crm_route_v1`) on the first call — `coverage: full`, `clarifying_questions: []`, `route_status: validated`. Confirms the MAR-344 90-second golden-flow claim holds under a fresh, unscripted goal phrasing.

## What shipped

Full implementation, tests, and hosting at [`examples/email-lead-agent/`](../examples/email-lead-agent/) (commit `e55e0bf`), all 9 route components wired with the approval gate enforced before any irreversible step:

`email_read → schema_validation → intent_classifier → email_draft → human_approval_gate → slack_notification → crm_note_write → optional_email_send → audit_log`

Hosted via GitHub Actions (`.github/workflows/email-lead-agent.yml`, manual-dispatch), verified live: [run 29187041289](https://github.com/orchestratemcp/OrchestrateKIT-MCP/actions/runs/29187041289) — identical output to the local run (2 leads approved, 1 correctly filtered as noise).

Real vs. stubbed (no live credentials existed in the build environment):

| Component | Status |
|---|---|
| `schema_validation`, `human_approval_gate`, `audit_log` | Real, no credentials needed |
| `email_read` | Stub — reads `fixtures/leads.json` (Gmail MCP connector's `search_threads` errored when I tried to source a real sample; `list_labels` worked) |
| `intent_classifier` | Stub — keyword heuristic, not the registry's "small LLM" tier |
| `email_draft` | Real if `ANTHROPIC_API_KEY` set (calls Claude), else template fallback (used) |
| `slack_notification` | Real if `SLACK_WEBHOOK_URL` set, else local outbox (used) |
| `crm_note_write` | Stub — local JSON file, no CRM client wired (matches `output_location` passed to `export_build_brief`) |
| `optional_email_send` | Draft-only by policy regardless of credentials, per the plan's own v1 recommendation |

Also verified: idempotency (re-run skips processed leads), a file-based kill switch, and DASH-shaped event emission (falls back to a local file — no DASH instance exists yet).

## Dogfood feedback (MAR-340/344-class)

1. `export_build_brief({ handoff_targets: ['prompt'] })` returned **271K characters** for a 9-step route — exceeded the tool's own result limit and forced a file-dump + jq/node workaround. Root cause: the Linear-issue-template compiler repeats ~100 lines of near-identical boilerplate per step (Edge cases / Failure modes / Security / Test cases barely vary). Scales linearly and badly with route length.
2. The compiled prompt hardcodes "ask at least 3 clarifying questions before locking scope" even when `plan_workflow` already returned `clarifying_questions: []` and `coverage: full` — contradicts the plan's own confidence signal.
3. `export_build_brief`'s params require hand-reconstructing most of the `plan_workflow` response (route, safety_review, automation_clearance, etc.) — correct for statelessness, but error-prone to copy by hand; a "pass the whole result" convenience path would help.
4. `output_location` passthrough worked exactly as documented — landed verbatim in `agent.manifest.json.monitoring.output_location`.
5. Every issue template's "Files likely affected" is `UNKNOWN` (reasonable, tool is repo-agnostic) — 100% of the actual code layout was builder judgment, not brief-derived. Worth setting expectations that the brief buys scope/safety scaffolding, not architecture.

## Prior corpus signal

MAR-353's 2026-07-11 digest already flagged a prior low-rated session, *"Agent run: email-lead-to-crm (run-smoke-test-1)"* (2/5). This case study is a from-scratch rebuild of the same scenario — worth a follow-up look at whether this run's output would rate higher against that same rubric.
