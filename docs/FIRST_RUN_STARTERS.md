# First-Run Starter Goals

These are the copy-paste goals for a 90-second first run.

1. Connect the hosted MCP URL: `https://mcp.orchestratemcp.dev/mcp`
2. Paste one starter goal into ChatGPT, Claude, or Cursor.
3. Ask the client to call `plan_workflow`.
4. Use the recommended next action, usually `Export Build brief for Codex`.

The default response should feel like a product card: title, short route,
plain-language steps, connections, safety note, build controls, and four
user-facing continuation choices.

## Try This First

### Competitor Price Monitor

```text
Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.
```

- Product title: Competitor Price Monitor -> Slack
- Route: schedule -> monitor pages -> dedupe -> validate -> threshold-route -> notify -> store state/audit
- Connections: competitor price sources, Slack summary channel, web monitor/scraper, optional reviewer channel
- Build target: Codex, Cursor, or Claude Code via build brief
- Host/monitor: cron or scheduled job with logs/run history
- Safety note: keep approval before external Slack alerts if they are high-impact
- Recommended next click: Export Build brief for Codex

### Gmail Lead to CRM

```text
Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.
```

- Product title: Email Lead -> CRM + Slack
- Route: read Gmail -> validate/classify lead -> draft reply -> require approval -> update CRM -> alert Slack -> audit
- Connections: Gmail inbox, CRM such as HubSpot/Salesforce/Pipedrive, Slack sales channel, optional email sender
- Build target: Codex, Cursor, or Claude Code via build brief
- Host/monitor: local or small always-on service with logs/run history
- Safety note: never write CRM notes, post to Slack, or send email before approval
- Recommended next click: Export Build brief for Codex

### Read-Only PR Reviewer

```text
When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.
```

- Product title: Read-Only PR Review
- Route: receive GitHub PR event -> validate payload -> scan diff -> summarize findings -> notify reviewers -> audit
- Connections: GitHub pull request/diff source, reviewer notification channel
- Build target: Codex, Cursor, or Claude Code via build brief
- Host/monitor: hosted endpoint or GitHub Action with logs/run history
- Safety note: grant read/comment scopes only; no edit, commit, approve, or merge scope
- Recommended next click: Export Build brief for Codex

### Invoice Intake / PO Match

```text
When a PDF invoice arrives in the shared AP Gmail inbox, extract totals and line items, match against purchase orders, notify AP in Slack for discrepancies, and hold every invoice for human approval before accounting.
```

- Product title: Invoice Intake -> PO Match
- Route: read invoice email -> extract PDF fields -> validate/normalize -> compare to PO -> notify AP -> require approval -> audit
- Connections: shared Gmail inbox, PO/ERP read source, Slack/AP alert channel, approval checkpoint
- Build target: Codex, Cursor, or Claude Code via build brief
- Host/monitor: local or hosted worker with logs/run history
- Safety note: do not give the agent ledger-write credentials in v1; hand approved records to the operator-wired accounting step
- Recommended next click: Export Build brief for Codex

### Content Repurposing With Approval

```text
Use a content brief to generate social copy variants and a design brief, send it to a reviewer for approval, then publish externally only after approval.
```

- Product title: Content Approval Pipeline
- Route: ingest brief -> generate copy -> generate design brief -> create variants -> send to reviewer -> require approval -> publish -> audit
- Connections: content brief source, reviewer channel, publishing platform
- Build target: Codex, Cursor, or Claude Code via build brief
- Host/monitor: local or hosted app with logs/run history
- Safety note: never publish automatically; show the full artifact at approval, not only a summary
- Recommended next click: Export Build brief for Codex

## Shape Checks

For these goals the default `plan_workflow` output is locked by UX evals to:

- stay under the Layer-1 brevity ceiling
- avoid raw JSON or duplicate report payloads
- avoid opening with component IDs
- include product title, route, steps, connections, safeguard, build controls, and continuation choices
- keep technical sections behind `output_depth: "technical"`
- keep the markdown menu user-facing with exactly four choices while preserving structured `next_action_menu`
