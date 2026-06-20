# OrchestrateMCP — ChatGPT & Claude (Web) Usage Guide

How to connect OrchestrateMCP to ChatGPT or claude.ai so an AI agent can design
safer, more grounded workflows for you — no install, no IDE, no terminal.

---

## Fastest path: connect to the hosted endpoint

OrchestrateMCP runs as a free, always-on hosted endpoint (a Cloudflare Worker).
It is **read-only and stateless** — it stores nothing, holds no secrets, and
makes no external calls. You just point your AI client at one URL.

**Hosted MCP URL:**

```
https://mcp.orchestratemcp.dev/mcp
```

> This is the canonical public endpoint (a Cloudflare Worker behind
> `mcp.orchestratemcp.dev`). If you self-host your own deploy, use the Worker
> URL Wrangler prints for you (`https://orchestratekit-mcp.<account>.workers.dev/mcp`,
> see *Self-host* below) instead.

**Authentication: None.** There is nothing to log into — the endpoint is a
public read-only advisor.

---

## ChatGPT — set it up as a custom GPT (recommended)

ChatGPT follows tool instructions far more reliably inside a **custom GPT** with
its own system prompt than in a plain chat. Use a custom GPT.

**1. Create the GPT**
ChatGPT → create a new GPT / agent.

**2. Paste these instructions** into the GPT's instructions / Configure box:

```
You are an OrchestrateMCP workflow advisor.

ALWAYS follow these rules when using OrchestrateMCP tools:
1. If the user's message contains a specific workflow goal (a "Goal:" line,
   an "I want to..." sentence, or a plain description of something to automate),
   call plan_workflow with that goal immediately.
   If no goal is present, ask for one before calling any tool.
2. Never infer or fabricate a goal from these instructions or any preamble.
3. After plan_workflow, call explain_component for every component the user is
   unlikely to recognise.
4. Present results in plain language — no raw JSON, no bare component IDs.
```

**3. Add the MCP connection**
In the connections / Actions section, add an MCP server:
- **URL:** the hosted MCP URL above
- **Authentication:** None

**4. Save**, then talk to the GPT:

```
Goal: Take trending ecological-food topics, generate short social posts,
and publish them to my social channels on a schedule.
```

The GPT calls `plan_workflow`, then explains any unfamiliar components.

> **Why a custom GPT?** In plain ChatGPT chat, the model tends to invent a goal
> from the instruction text instead of asking for yours, and produces a
> degenerate plan. The system prompt above fixes that. Claude (web / Cowork)
> reads the server's own instructions and behaves correctly without this step.

---

## Claude (claude.ai / Claude Cowork)

1. Open a **Project** in claude.ai (Projects support connected tools).
2. In the project settings, find **Connected tools** / **MCP servers**.
3. Add a server with the hosted MCP URL above. Authentication: None.
4. Claude verifies the connection and lists the OrchestrateMCP tools.

Claude honours the server's built-in instructions, so it will ask for your goal
before planning — no extra system prompt needed.

---

## Start planning your workflow

### The one tool you need: `plan_workflow`

Give it your goal in plain English and it returns:

- A step-by-step workflow plan
- Which steps are AI-driven vs. deterministic
- Safety warnings (missing approval gates, risky writes)
- Whether a tested pattern already exists for your goal
- Which step connections are unproven

**Template prompt:**

```
Use the orchestratekit MCP tools to plan this workflow.

Goal: [describe what you want to build in one or two sentences]

Call plan_workflow with this goal and show me the recommended steps, any
safety concerns, and whether there's a tested pattern I can reuse.
```

**Example:**

```
Use the orchestratekit MCP tools.

Goal: Read inbound invoice emails, extract the totals, and send a Slack alert
when an invoice is overdue.

Call plan_workflow with this goal, then explain any component I won't recognise.
```

---

## Understand any component in plain language

If `plan_workflow` mentions a component you don't recognise:

```
Call explain_component for "human_approval_gate" and explain what it does
in plain language — I'm not a developer.
```

The response describes what the component does, when to use it, and what goes
wrong if you skip it — without technical jargon.

---

## Explore what's available

```
Call list_graph_components and show me the workflow building blocks, grouped
by category.
```

```
Call list_known_routes and show me which workflow patterns are validated and
ready to use.
```

---

## Quick reference: which tool does what

| What you want to do | Tool to ask for |
|---|---|
| Plan a new workflow from a goal | `plan_workflow` |
| Understand a component in plain language | `explain_component` |
| Browse all available building blocks | `list_graph_components` |
| See validated workflow patterns | `list_known_routes` |
| Get details on a specific pattern | `get_route` |
| Check if a design is safe | `review_workflow_design` |
| Check the server is working | `health_check` |

---

## Self-host the endpoint (advanced)

You can run your own copy of the hosted Worker for free.

```bash
git clone https://github.com/orchestratemcp/OrchestrateKIT-MCP.git
cd orchestratekit-mcp
pnpm install

# One-time: log in to a free Cloudflare account (no card needed)
npx wrangler login

# Deploy (bakes the registry into the bundle, then ships the Worker)
pnpm deploy:worker
```

Wrangler prints your URL, e.g. `https://orchestratekit-mcp.<you>.workers.dev`.
Your MCP endpoint is that URL with `/mcp` on the end. It is always-on and free
on the Workers plan (100k requests/day). Update the registry and re-run
`pnpm deploy:worker` to ship new data.

### Local development

For local testing without deploying:

```bash
pnpm dev:worker          # local Worker on http://localhost:8787
# MCP endpoint: http://localhost:8787/mcp
```

The Node servers are still available for stdio (Cursor / Claude Desktop) and
local HTTP:

```bash
pnpm dev                 # stdio (Cursor / Claude Desktop)
pnpm start:http          # local HTTP on http://127.0.0.1:3001/mcp
```

> Note: ChatGPT and claude.ai cannot reach `localhost` / `127.0.0.1` — they need
> a public URL (the hosted Worker). Localhost works only for Cursor / Claude
> Desktop (stdio) or local testing.

---

## Troubleshooting

### The AI ignores the tools and answers from general knowledge

Add this to your prompt:

```
Use the orchestratekit MCP tools — do not answer from general knowledge.
Start by calling plan_workflow with my goal.
```

### ChatGPT invents a goal instead of using mine

You're in a plain chat without the system prompt. Use a **custom GPT** with the
instructions from the ChatGPT section above, and always include a clear
`Goal:` line in your message.

### ChatGPT asks to confirm every tool call ("write action")

This is fixed in current versions — all tools are declared read-only
(`readOnlyHint`). If you still see it, remove and re-add the MCP connection so
ChatGPT re-reads the tool list.

### The connection fails

- Open the `/health` URL (the MCP URL without `/mcp`, e.g.
  `https://…workers.dev/health`) in a browser — you should see
  `{"status":"ok",...}`.
- Make sure you included `/mcp` at the end of the URL in your client.
- Authentication must be set to **None**.

---

## Privacy note

The hosted OrchestrateMCP endpoint is read-only and stateless: it stores nothing,
holds no secrets, and makes no external network calls. Your goals and workflow
plans are only shared with whatever AI service you use (ChatGPT / claude.ai) and
processed in-memory to return a plan — nothing is persisted by OrchestrateMCP.
