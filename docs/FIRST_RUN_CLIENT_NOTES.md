# First-Run Client Notes

Use this file to record the 90-second first-run path in each client.

## Current Server-Side Smoke

Endpoint: `https://orchestratekit-mcp.000henrik.workers.dev/mcp`

Verified on July 10, 2026 after worker deploy `84f50669-bdd2-41ad-ae40-8e2f0d793df4`:

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

Status: smoke completed in Claude on July 11, 2026.

Observed:

- Claude called the hosted OrchestrateMCP planner and returned the validated
  Gmail lead playbook.
- The first response was helpful and product-like, but paraphrased the four
  continuation choices into one sentence.
- The exact product-card response showed the expected four A-D choices.
- The card stayed user-facing: title, short "You want", route, flow, connect,
  key safeguard, build controls, and grounding footer.
- No DASH mention.

Result: pass.

Prompt to run:

```text
Use the orchestratekit MCP tools.

Goal: Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.

Call plan_workflow with this goal and render the returned summary_markdown
verbatim, including the A) B) C) D) continuation menu.
```

Expected first screen:

- Title: Email Lead -> CRM + Slack
- Connections include Gmail inbox, CRM, Slack sales channel, and optional email sender.
- Approval remains before CRM updates, Slack alerts, or sending.
- The next menu has four choices.
- No raw JSON and no DASH mention.

## Cursor

Status: smoke completed in Cursor on July 11, 2026.

Observed:

- Cursor discovered `plan_workflow` and produced a readable first screen.
- Cursor initially paraphrased the plan and exposed six follow-up actions instead
  of the four-choice product-card menu.
- Asking Cursor to re-fetch and render `summary_markdown` verbatim preserved the
  planner footer, but Cursor's expanded goal wording routed to a composed
  candidate instead of the validated Gmail lead playbook.
- Local verification on the MAR-344 branch shows the clean starter goal still
  routes to `email_lead_to_crm`; the Cursor-expanded wording is tracked
  separately in MAR-347.

Result: pass with follow-up. Do not broaden MAR-344 into matcher changes.

Prompt to run:

```text
Use the orchestratekit MCP tools.

Goal: Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.

Call plan_workflow with this goal first. Render the returned summary_markdown
verbatim, including the A) B) C) D) continuation menu, before writing code.
```

Expected first screen:

- Title: Email Lead -> CRM + Slack
- Connections include Gmail inbox, CRM, Slack sales channel, and optional email sender.
- Approval remains before CRM updates, Slack alerts, or sending.
- The next menu has four choices.
- Cursor does not start writing code before the plan is accepted.

## Follow-Up Rule

If a client fails to discover tools, skips `plan_workflow`, shows raw JSON, hides
the product card, or cannot use the hosted URL, file a separate client-specific
follow-up issue instead of broadening MAR-344.
