# OrchestrateKit MCP — ChatGPT & Claude (Web) Usage Guide

How to connect OrchestrateKit to ChatGPT or claude.ai so an AI agent can design
safer, more grounded workflows for you — without needing a local IDE.

---

## How this differs from Cursor / Claude Desktop

Cursor and Claude Desktop connect over **stdio** (direct process). ChatGPT and
claude.ai connect over **HTTP**. You run a small local server, and the AI connects
to it over `localhost`.

This means you need to:
1. Start the HTTP server once (stays running in the background)
2. Point your AI client at its URL
3. Ask the AI to plan your workflow

---

## 1. Start the HTTP server

```bash
# One-time setup
cd orchestratekit-mcp
pnpm install
pnpm build

# Start the HTTP server (keep this terminal open)
pnpm start:http
```

You should see:

```
OrchestrateKit MCP HTTP server listening on http://127.0.0.1:3001
```

The server runs locally. Nothing is sent to the internet. Stop it with `Ctrl+C`.

> **Note:** The HTTP server defaults to port 3001. If you have a conflict, set
> `PORT=3002 pnpm start:http` (or any free port) and use that port in the steps below.

---

## 2. Connect your AI client

### Claude (claude.ai / Claude Cowork)

1. Open a **Project** in claude.ai (Projects support connected tools).
2. In the project settings, find **Connected tools** or **MCP servers**.
3. Add a new server with the URL `http://127.0.0.1:3001/mcp`.
4. Claude will verify the connection and list the available OrchestrateKit tools.

Once connected, start any conversation in that Project and Claude will have
access to the workflow graph tools.

### ChatGPT

ChatGPT supports MCP in its custom agent builder. To connect:

1. Create or open a **GPT** in the ChatGPT interface.
2. In the Actions / Tools section, add a new MCP connection.
3. Set the endpoint URL to `http://127.0.0.1:3001/mcp`.
4. ChatGPT will fetch the available tools and display them.

> **Note:** Make sure the HTTP server is running before ChatGPT tries to connect.
> For remote deployments (if you want a public URL instead of localhost), you can
> tunnel the local server with a tool like `ngrok` or deploy it to a cloud host.

---

## 3. Start planning your workflow

### The one tool you need: `plan_workflow`

`plan_workflow` is the single entry point for non-technical builders. Give it your
goal in plain English and it returns:

- A step-by-step workflow plan
- Which components are AI-driven vs. deterministic
- Safety warnings (missing approval gates, risky writes)
- Whether a tested pattern already exists for your goal
- Which steps have known gaps

**Template prompt:**

```
Use the orchestratekit MCP tools to plan this workflow:

Goal: [describe what you want to build in one or two sentences]

Call plan_workflow with this goal and show me:
- The recommended steps
- Any safety concerns
- Whether there's a tested pattern I can use
```

**Example:**

```
Use the orchestratekit MCP tools to plan this workflow:

Goal: Read inbound invoice emails, extract the totals, and send a Slack alert
when an invoice is overdue.

Call plan_workflow with this goal and show me the recommended steps, any safety
concerns, and whether there's a tested pattern I can reuse.
```

---

## 4. Understand any component in plain language

If `plan_workflow` mentions a component you don't recognise, ask:

```
Call explain_component for "[component_id]" and explain what it does
in plain language — I'm not a developer.
```

**Example:**

```
Call explain_component for "human_approval_gate" and explain what it does
in plain language — I'm not a developer.
```

The response describes what the component does, when to use it, and what goes
wrong if you skip it — without any technical jargon.

---

## 5. Explore what's available

```
Call list_graph_components and show me what workflow building blocks are
available, grouped by category.
```

```
Call list_known_routes and show me which workflow patterns have been
validated and are ready to use.
```

---

## Recommended prompt patterns

### Build something new

```
I want to build a workflow that [goal].

1. Call plan_workflow with my goal.
2. If you find a tested pattern, show me what it recommends.
3. Tell me which steps need a human approval gate and why.
4. Highlight any steps where things could go wrong.
```

### Check if a pattern already exists

```
Does a tested workflow pattern exist for [goal type]?
Call list_known_routes, then call plan_workflow with my goal, and tell me
if I should use an existing route or build something new.
```

### Ask about a specific step

```
My workflow includes a step that sends emails automatically. 
Call explain_component for "optional_email_send" and tell me what safety
guards I should put in place around it.
```

### Review a design you already have

```
I've described my workflow below. Call review_workflow_design with this
description and tell me if I'm missing any approval gates or if there are
any steps that could go wrong:

[paste your workflow description]
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

## Troubleshooting

### The AI says it can't find the OrchestrateKit tools

- Make sure the HTTP server is running (`pnpm start:http`).
- Verify it printed `listening on http://127.0.0.1:3001`.
- Check the connection URL in your AI client settings matches exactly.

### The AI ignores the tools and answers from general knowledge

Add this phrase to your prompt:

```
Use the orchestratekit MCP tools — do not answer from general knowledge.
Start by calling plan_workflow.
```

### Port already in use

Another service may be using port 3001. Try:

```bash
PORT=3002 pnpm start:http
```

Then update the connection URL to `http://127.0.0.1:3002/mcp`.

### I closed the terminal — is the server still running?

No. The HTTP server process stops when the terminal is closed. Start it again
with `pnpm start:http`.

---

## Privacy note

The OrchestrateKit HTTP server runs entirely on your local machine. It does not
make external network calls or send any data to Anthropic, OpenAI, or any third
party. Your goals and workflow plans are only shared with whatever AI service you
are using (ChatGPT / claude.ai) — not with OrchestrateKit.
