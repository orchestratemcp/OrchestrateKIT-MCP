# First-Run Starter Goals

These are the copy-paste goals for a 90-second first run:

1. Connect the hosted MCP URL: `https://mcp.orchestratemcp.dev/mcp`
2. Paste one starter goal into ChatGPT, Claude, or Cursor.
3. Let `plan_workflow` return the default brief output.
4. Click the recommended next action, usually `export_build_brief`.

The default response should feel like a product card: title, short step list,
connections, build target, host/monitor recommendation, safety note, and one
obvious next click.

## Try This First

### Competitor Price Monitor

```text
Build an agent that checks 5 competitor pages every morning, detects price changes, and sends me a Slack summary. I want to approve before anything external is changed.
```

- Product title: Competitor Price Monitor with Threshold Alerts
- Steps: schedule the check, monitor pages, dedupe changes, validate price data, threshold-route, notify in Slack, keep audit records
- Connections: monitored pages, Slack, state/audit storage, human approval checkpoint
- Build target: Codex or Cursor/Claude Code via build brief
- Host/monitor: cron or scheduled job, monitored in DASH from the exported manifest
- Safety note: keep the approval gate when the Slack summary is treated as external or high-impact
- Recommended next click: Export Build brief for Codex

### Gmail Lead to CRM

```text
Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.
```

- Product title: Email Lead to CRM with Follow-up
- Steps: read Gmail, classify lead, validate, draft reply, require approval, write CRM note, notify Slack, audit the outcome
- Connections: Gmail, CRM such as HubSpot, Slack, approval checkpoint
- Build target: Codex or Cursor/Claude Code via build brief
- Host/monitor: local or small always-on service, monitored in DASH
- Safety note: never write CRM notes or send/post externally before approval
- Recommended next click: Export Build brief for Codex

### Read-Only PR Reviewer

```text
When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.
```

- Product title: Read-Only PR Review with Hard No-Write Guarantee
- Steps: receive GitHub event, validate payload, scan diff, summarize findings, notify reviewers, audit the pass
- Connections: GitHub read/comment permission, reviewer notification channel
- Build target: Codex or Cursor/Claude Code via build brief
- Host/monitor: webhook endpoint or GitHub Action, monitored in DASH
- Safety note: grant read-only repo scopes plus comment permission; no edit, commit, approve, or merge scope
- Recommended next click: Export Build brief for Codex

### Invoice Intake / PO Match

```text
When a PDF invoice arrives in the shared AP Gmail inbox, extract totals and line items, match against purchase orders, notify AP in Slack for discrepancies, and hold every invoice for human approval before accounting.
```

- Product title: Invoice Intake with PO Match and Mandatory Human Gate
- Steps: read invoice email, extract PDF fields, normalize, validate against PO, route discrepancies, notify AP, require approval, audit
- Connections: shared Gmail inbox, PO/ERP read access, Slack or reviewer notification, approval checkpoint
- Build target: Codex or Cursor/Claude Code via build brief
- Host/monitor: local/hosted worker depending on inbox trigger, monitored in DASH
- Safety note: the agent should not hold ledger-write credentials; approval hands the record to the operator-wired accounting integration
- Recommended next click: Export Build brief for Codex

### Content Repurposing With Approval

```text
Use a content brief to generate social copy variants and a design brief, send it to a reviewer for approval, then publish externally only after approval.
```

- Product title: Content Approval Pipeline / Content Repurposing with Approval
- Steps: ingest brief, generate copy, generate design brief, create variants, route to reviewer, require approval, publish, audit
- Connections: content source, reviewer channel, publishing platform, approval checkpoint
- Build target: Codex or Cursor/Claude Code via build brief
- Host/monitor: local or hosted app, monitored in DASH
- Safety note: never publish automatically; show the full artifact at approval, not only a summary
- Recommended next click: Export Build brief for Codex

## Shape Checks

For these goals the default `plan_workflow` output is locked by UX evals to:

- stay under the Layer-1 brevity ceiling
- avoid raw JSON or duplicate report payloads
- avoid opening with component IDs
- include steps, connections, build target, host/monitor, safety, and one recommended next action
- keep technical sections behind `output_depth: "technical"`
