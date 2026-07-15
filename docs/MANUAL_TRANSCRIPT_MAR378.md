# MAR-378 manual three-prompt transcript

Recorded from `plan_workflow` on `codex/mar-378-agent-placement` with
`output_depth: "guided"`. The runtime blocks and next-action menus below are
copied from the final guided output; route details are summarized only where
they do not affect the runtime-fit inspection.

## Prompt A — Email and Calendar

> I want an assistant that looks at my Gmail for meeting requests, checks my calendar, suggests two times, and after I approve it creates the calendar invite and leaves a reply in my Gmail drafts. I do not want it to send anything without me.

Observed route: Email Read → Calendar Lookup → Email Draft → Human Approval Gate
→ Calendar Write → Email Send (disabled for this goal) → Audit Log.

### Actual guided runtime block

**Recommended runtime setup**

- **Runtime (execution):** Managed background worker / durable workflow _(requires setup)_ — Gmail events or polling plus persistent deduplication and durable approval must outlive a client session.
- **Offline behavior:** Keeps watching and can wait for approval while the user is offline.
- **Control surface:** Provider-neutral approval inbox / generated UI _(requires setup)_ — Persist approvals while the user is offline without making DASH a dependency.
- **Interaction surface:** Approval inbox / generated UI _(requires setup)_ — Review suggested times and approve the calendar write from a durable, provider-neutral surface.
- **Trigger:** Gmail event — A Gmail event watch should start it; if unavailable, configure and disclose a fixed polling interval.
- **Install availability:** no one-click action. This product has no runtime installer or Orchestrate Runner; the MCP worker is stateless and must not run customer agents.
- **Next achievable step:** Connect Gmail, Google Calendar, and a model provider, choose a supported durable runtime, and prepare a provider-neutral approval inbox. Keep sending disabled.

### Actual guided next menu

A) Prepare runtime and connections — Next achievable step  
B) Review or change Runtime, Control surface, Interaction surface, or Trigger  
C) Show the technical plan and deployment alternatives  
D) Save this plan to Linear / Obsidian / Notion

Inspection: managed durable execution is the best-fit class, but no provider or
fake installer is claimed. Approval is provider-neutral, sending remains
disabled, DASH is not a dependency, and the MCP worker is explicitly excluded
from customer-agent execution.

## Prompt B — Scheduled price monitor

> Watch five competitor product pages every morning and tell our team in Slack when a price changes. I want it to keep working when my computer is off.

Observed route: Scheduled Trigger → Page Monitor → Deduplication → State Store
→ Slack Notification → Audit Log.

### Actual guided runtime block

**Recommended runtime setup**

- **Runtime (execution):** Managed scheduled job _(requires setup)_ — A short morning check needs a durable timer, not an always-on worker.
- **Offline behavior:** Keeps running on schedule while the user's computer and client are closed.
- **Control surface:** Provider-neutral approval inbox / generated UI _(requires setup)_ — Persist approvals while the user is offline without making DASH a dependency.
- **Interaction surface:** Slack price-change notifications _(requires setup)_ — Deliver team output where people already work; Slack is an interaction surface, not hosting.
- **Trigger:** Configured morning schedule — A durable scheduler starts one short run each morning at the configured time and timezone.
- **Install availability:** no one-click action. This product has no runtime installer or Orchestrate Runner; the MCP worker is stateless and must not run customer agents.
- **Next achievable step:** Choose Slack delivery mode (approve every post or automate low-risk price-change alerts), connect the page monitor and Slack, then prepare a managed scheduled job with persistent change-detection state.

### Actual guided next menu

A) Prepare runtime and connections — Next achievable step  
B) Review or change Runtime, Control surface, Interaction surface, or Trigger  
C) Show the technical plan and deployment alternatives  
D) Save this plan to Linear / Obsidian / Notion

Inspection: this is a short scheduled job, not an always-on worker. Slack is
only the interaction/output surface. The approval-versus-automation choice,
state requirement, offline behavior, missing install path, and exact next step
are all explicit.

## Prompt C — Interactive document summarizer

> When I ask in chat, summarize the documents I select. Never run in the background and never change the documents.

Observed route: User Goal Intake → Source Retrieval → Research Synthesis →
Citation Checker. The route is read-only and starts only from a user request.

### Actual guided runtime block

**Recommended runtime setup**

- **Runtime (execution):** Client/chat runtime _(available now)_ — Best for attended, on-demand work that starts only when the user asks in chat.
- **Offline behavior:** Stops when the client/session closes; that is correct for explicitly attended work.
- **Control surface:** Current client/chat _(available now)_ — Configure and control attended, on-demand work in the current conversation.
- **Interaction surface:** Current client/chat _(available now)_ — Ask for a summary and receive it in the same attended conversation.
- **Trigger:** A request in chat — Nothing runs until the user asks in the current client and selects documents.
- **Install availability:** available now; no runtime install action is needed. Document-source selection still needs setup; the MCP worker is stateless and does not run customer agents.
- **Next achievable step:** Connect the selected document source and model provider, then test an attended read-only run in the current client.

### Actual guided next menu

A) Prepare attended client run — Next achievable step  
B) Review or change Runtime, Control surface, Interaction surface, or Trigger  
C) Show the technical plan and deployment alternatives  
D) Save this plan to Linear / Obsidian / Notion

Inspection: the runtime differs from both background prompts. There is no
scheduler, endpoint, or hosted worker recommendation; control and interaction
stay in the client, and closing the client intentionally stops the workflow.
