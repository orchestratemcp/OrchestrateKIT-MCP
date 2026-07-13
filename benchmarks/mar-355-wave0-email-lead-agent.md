# MAR-355 Wave 0: Email Lead Agent Speed Run

Run date: 2026-07-12
Workspace: `C:\Users\henri\Desktop\projekt\MCP\orchestratekit-mcp`

## Goal

Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.

## Timings

| Stage | Measurement | Result |
|---|---:|---|
| Goal submitted to `plan_workflow` -> product card rendered | MCP tool wall time | 0.260 s |
| Product card -> option C `export_build_brief` returned | MCP tool wall time | 0.483 s |
| First successful local run | PowerShell process wall time | 1.494 s |
| First successful local run | In-agent elapsed time | 97 ms |
| Same-runtime idempotency retry | PowerShell process wall time | 0.979 s |
| Same-runtime idempotency retry | In-agent elapsed time | 6 ms |
| Goal submitted -> hosted config ready | 2026-07-12T20:28:24.269+02:00 to 2026-07-12T20:32:29.511+02:00 | 4 min 5.242 s |

Notes:
- The MAR-355 "90-second golden flow" planner requirement passed: the product card rendered in 0.260 s.
- "Hosted config ready" means the repo contains the GitHub Actions host/monitor workflow and local checks passed. I did not push to GitHub or trigger a remote workflow run from this workspace.
- Local run used `EMAIL_LEAD_AGENT_RUNTIME_DIR=C:\Users\henri\AppData\Local\Temp\email-lead-agent-b55b3d43-d6d0-4c7c-90f6-26fdc501ba86`.

## Local Run Evidence

Command:

```powershell
$env:EMAIL_LEAD_AGENT_RUNTIME_DIR = "C:\Users\henri\AppData\Local\Temp\email-lead-agent-b55b3d43-d6d0-4c7c-90f6-26fdc501ba86"
npx tsx examples/email-lead-agent/src/run.ts --auto-approve
```

Result:

- Messages read: 3
- Sales leads approved in demo mode: 2
- Newsletter/noise messages: 1
- Failed steps: 0
- Audit rows after first run: 22
- DASH-shaped events after first run: 36
- Effect ids after first run: 6, one per approved lead per downstream Slack/CRM/draft effect

## Host/Monitor Choice

Selected `github_action` from the wizard's `host_monitor_choices`.

Why: for a solo-builder demo it provides hosted execution, shareable logs, artifact upload, and repo-managed secrets without keeping a laptop, cron server, or Cowork session alive. DASH remains a monitoring target through `agent.manifest.json` and `DASH_INGEST_URL` / `DASH_INGEST_TOKEN`, not the execution runtime.

## Stubbed vs Real

Real:
- Schema validation.
- Human approval gate, with `--auto-approve` only for demo/CI.
- Audit log.
- DASH-shaped event emission, falling back to local JSONL when no DASH endpoint is configured.
- Per-lead and per-effect idempotency guards.
- GitHub Actions host/monitor workflow.

Stubbed/dry-run:
- Gmail read: fixture file because Gmail OAuth credentials were not provided.
- Intent classifier: deterministic keyword heuristic rather than the registry's small-model tier.
- Email draft: template because `ANTHROPIC_API_KEY` was not provided.
- Slack notification: local JSONL outbox because `SLACK_WEBHOOK_URL` was not provided.
- CRM note write: local JSON file because no HubSpot/Salesforce/Pipedrive credentials were provided.
- Optional email send: intentionally draft-only for v1, even if credentials exist.

## Dogfood Feedback

- The guided `plan_workflow` product card was fast and gave full route coverage with the A-D menu, which is good for the GIF path.
- The first build brief omitted worker contracts because `worker_pipeline` only appears at technical depth. For a build handoff, option C should either include those automatically or tell the caller to re-run technical depth first.
- Several generated issue fields said `UNKNOWN - target repository/framework not provided`, even though the current repo was available to Codex. That is understandable for a stateless hosted advisor, but it adds friction during an in-repo build.
- The route order in the summary says Slack then CRM after approval; the credential advisory and safety text mention CRM and optional email as highest actions, but Slack is also high risk. The build brief did list Slack as high risk, so this is mostly wording consistency.
- The generated Definition of Done says "All in-route edges are tested" as checked, while the safety warnings say no evals or test cases were mentioned. That reads contradictory during implementation.
