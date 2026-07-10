# First-Run Client Notes

Use this file to record the 90-second first-run path in each client.

## Current Server-Side Smoke

Endpoint: `https://orchestratekit-mcp.000henrik.workers.dev/mcp`

Verified on July 10, 2026 after worker deploy `4510137c-b96e-4d87-9309-bd0a2aa69e3d`:

- `plan_workflow` returns concise product-card markdown.
- The markdown continuation menu has exactly four user-facing choices.
- Structured `next_action_menu` remains present for clients that render buttons.
- First-run markdown does not mention DASH.
- PR-review and competitor-price weak routes name uncovered work instead of overclaiming coverage.

## ChatGPT

Status: smoke completed in the ChatGPT web UI on July 10, 2026.

Observed:

- ChatGPT discovered available tools.
- ChatGPT called `list_resources`, then `plan_workflow`.
- `plan_workflow` input used `output_depth: "brief"`.
- The tool result contained `summary_markdown` with the full product card and A-D continuation menu.
- The first visible ChatGPT answer paraphrased the card and omitted the A-D menu.
- A stricter follow-up asking ChatGPT to render `summary_markdown` verbatim did show the A-D continuation menu.

Docs note: ChatGPT first-run prompts should explicitly ask to render the returned
`summary_markdown` verbatim, including the A) B) C) D) menu.

Prompt to run:

```text
Use the orchestratekit MCP tools.

Goal: Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.

Call plan_workflow with this goal and render the returned summary_markdown
verbatim, including the A) B) C) D) continuation menu.
```

Expected first screen:

- Title: Email Lead -> CRM + Slack
- Route and steps appear in plain language.
- Connections include Gmail inbox, CRM, Slack sales channel, and optional email sender.
- The next menu has four choices.
- No raw JSON and no DASH mention.

## Claude Web / Cowork

Status: needs manual UI smoke with the hosted MCP URL.

Prompt to run:

```text
Use the orchestratekit MCP tools.

Goal: When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.

Call plan_workflow with this goal and show the concise product-card response.
```

Expected first screen:

- Title: Read-Only PR Review
- Connections include GitHub pull request / diff source and reviewer notification channel.
- The no-write constraint is preserved.
- The next menu has four choices.

## Cursor

Status: local MCP path is documented; manual Cursor UI smoke still needs recording.

Prompt to run:

```text
Use the orchestratekit MCP tools.

Goal: When a PDF invoice arrives in the shared AP Gmail inbox, extract totals and line items, match against purchase orders, notify AP in Slack for discrepancies, and hold every invoice for human approval before accounting.

Call plan_workflow with this goal first. Show the concise product-card response before writing code.
```

Expected first screen:

- Title: Invoice Intake -> PO Match
- Connections include Gmail inbox, PO / ERP read source, and Slack/AP alert channel.
- Approval remains before accounting or irreversible actions.
- Cursor does not start writing code before the plan is accepted.

## Follow-Up Rule

If a client fails to discover tools, skips `plan_workflow`, shows raw JSON, hides
the product card, or cannot use the hosted URL, file a separate client-specific
follow-up issue instead of broadening MAR-344.
