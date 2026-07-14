# OrchestrateMCP - Claude Desktop Usage Guide

How to use OrchestrateMCP from Claude Desktop for workflow planning and safety
review.

---

## Connecting The MCP

See `docs/LOCAL_SETUP.md` for installation and connection instructions.

Once connected, the plug icon in the bottom-left of a Claude Desktop
conversation shows the active MCP servers. Click it to verify
**orchestratekit** is listed.

---

## First-Run Path

For a new workflow, start with `plan_workflow`. It returns the product-card
summary, route, connections, safety posture, coverage gaps, build controls, and
next action in one concise response.

```text
Use the orchestratekit MCP tools.

Goal: Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, and alerts sales in Slack after approval.

Call plan_workflow with this goal first. Show the concise product-card response
and the recommended next action.
```

More first-run starters: `docs/FIRST_RUN_STARTERS.md`.

---

## Recommended Prompts

### Plan a workflow

```text
Use orchestratekit MCP.

Goal: [describe the workflow in one or two sentences]

Call plan_workflow with this goal. Show the product-card response first, then
explain any unfamiliar component names in plain language.
```

### Explain a component

```text
Call explain_component for "human_approval_gate" and explain what can go wrong
if I skip it.
```

### Safety review of an existing design

```text
I'm planning this AI workflow:
[describe your design]

Call review_workflow_design with this design. Tell me:
- the status
- the risk score
- the most critical findings with recommended fixes
```

---

## Playbook Resources

Claude Desktop can read published playbooks as MCP Resources in addition to
calling tools. Resource URIs use:

```text
orchestratekit://playbooks/<playbook_id>
```

For example:

```text
Read the MCP resource orchestratekit://playbooks/email_lead_to_crm and use it
as context for this workflow design.
```

The resource body is the same JSON payload returned by `get_playbook` with
default options for that `playbook_id`. Call `get_playbook` instead when you
want workflow-type matching, beta playbooks, or `include_graph=true`.

---

## Typical Flow

```text
User: Use orchestratekit MCP. Goal: [workflow goal]. Call plan_workflow.
Claude: [calls plan_workflow and shows the product card]

User: Explain the risky or unfamiliar steps.
Claude: [calls explain_component for those steps]

User: We will build this. Run a safety review on my implementation design.
Claude: [calls review_workflow_design]
```

---

## Differences From Cursor

| | Cursor | Claude Desktop |
|---|---|---|
| Tool invocation | Often automatic in agent mode | Better when prompted explicitly |
| Code generation | After planning | After planning |
| Best for | Active development | Architecture review and design sessions |

---

## Known Limitations

- Claude Desktop does not have file system access by default. The MCP tools
  return context as text; they do not write files.
- If the tool icon shows but tools fail, check that the Node.js binary is on the
  system `PATH`, not just your shell profile. See troubleshooting in
  `docs/LOCAL_SETUP.md`.
- Candidate routes are graph compositions not yet backed by a validated
  playbook. Treat them as informed proposals.
