# Email Lead → CRM + Slack

Built from an OrchestrateMCP `plan_workflow` → `export_build_brief` output
(playbook `email_lead_to_crm`, route `email_lead_crm_route_v1`). See
`agent.manifest.json` for the DASH-importable manifest OrchestrateMCP
generated for this route.

Goal: read new Gmail leads, draft a reply, pause for human approval, then
update the CRM and alert sales in Slack.

## What's real vs. stubbed (v1)

No live credentials were available when this was built, so every external
integration runs in dry-run/stub mode by default and says so loudly on
stdout. Each step file documents its own real/stub branch and the env var
that flips it:

| Step | Component | v1 behavior |
|---|---|---|
| 1 | `email_read` | **Stub.** Reads `fixtures/leads.json`. Set `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN` and wire a real Gmail client to go live. |
| 2 | `schema_validation` | **Real.** Zod schema + From-header parsing, no credentials needed. |
| 3 | `intent_classifier` | **Stub.** Deterministic keyword heuristic, not the "small LLM" the registry calls for. Good enough to route the demo, not to trust in production. |
| 4 | `email_draft` | **Real if `ANTHROPIC_API_KEY` is set** (calls the Claude API), else a fixed template. |
| 5 | `human_approval_gate` | **Real.** Interactive y/n prompt on a TTY; `--auto-approve` / `AUTO_APPROVE=1` for CI/demo; rejects closed otherwise. This is the one enforced gate — nothing below it runs without an "approved" decision. |
| 6 | `slack_notification` | **Real if `SLACK_WEBHOOK_URL` is set**, else appends to `runtime/slack_outbox.jsonl`. |
| 7 | `crm_note_write` | **Stub.** No CRM (HubSpot/Salesforce/Pipedrive) credentials or client wired up — always writes to `runtime/crm_notes.json`. |
| 8 | `optional_email_send` | **Draft-only by policy**, independent of credentials — the plan itself recommended staying draft-only for v1. Queues to `runtime/outbound_drafts.jsonl`. |
| 9 | `audit_log` | **Real.** Every step (not just step 9) appends a structured event to `runtime/audit.jsonl`. |

Also wired: a DASH-shaped observability emitter (`src/dash.ts`) that POSTs to
`DASH_INGEST_URL`/`DASH_INGEST_TOKEN` if set, otherwise appends the same
event shape to `runtime/dash_events.jsonl` — and an idempotency guard
(`runtime/processed_ids.json`) plus a file-based kill switch
(`runtime/KILL_SWITCH` — create that file to make the next run abort before
any step executes).

## Run it

```bash
# from the repo root
npx tsx examples/email-lead-agent/src/run.ts --auto-approve
```

Drop `--auto-approve` to get the interactive y/n prompt instead. Output
lands in `examples/email-lead-agent/runtime/` (gitignored):
`audit.jsonl`, `crm_notes.json`, `slack_outbox.jsonl`,
`outbound_drafts.jsonl`, `dash_events.jsonl`, `processed_ids.json`.

Re-running is safe — leads already recorded in `processed_ids.json` are
skipped rather than re-alerted/re-written.

## Tests

Unit tests for the deterministic steps (`schema_validation`,
`intent_classifier`) live in
[`tests/email-lead-agent.test.ts`](../../tests/email-lead-agent.test.ts) and
run as part of the repo's normal `pnpm test`.

## Hosting

See [`.github/workflows/email-lead-agent.yml`](../../.github/workflows/email-lead-agent.yml)
— runs on a schedule via GitHub Actions. See that file's header comment for
why this was chosen over local/cron for a solo-builder demo.
