# OrchestrateMCP - Cursor Usage Guide

How to use OrchestrateMCP from Cursor for graph-aware workflow planning before
you write implementation code.

---

## Connecting The MCP

See `docs/LOCAL_SETUP.md` for installation and connection instructions.
Once connected, the tools appear in Cursor's MCP panel and are callable from any
chat in the workspace.

---

## First-Run Path

For a new workflow, start with `plan_workflow`. It returns the product-card
summary, route, connections, safety posture, coverage gaps, build controls, and
next action in one concise response.

```text
Use the orchestratekit MCP tools.

Goal: When a pull request opens on GitHub, review the diff for bugs and risky changes, notify reviewers with a summary, and never edit or commit code.

Call plan_workflow with this goal first. Show the concise product-card response
and the recommended next action before writing code.
```

More first-run starters: `docs/FIRST_RUN_STARTERS.md`.

---

## Which Tool To Call First

Call **`plan_workflow`** before writing code. It is the one-call planner for the
first screen.

Use deeper graph tools only after the product card is visible:

1. **`explain_component`** for any step the user does not recognise.
2. **`list_known_routes`** to browse validated patterns.
3. **`get_playbook`** when `plan_workflow` selects a playbook and you want full guidance.
4. **`review_workflow_design`** when checking an implementation design against the registry.
5. **`get_relevant_docs`** for framework or component documentation sources.

---

## Forcing Cursor To Use The MCP

Cursor can skip tools and answer from training data. Be explicit:

```text
Use the orchestratekit MCP tools to plan this workflow.
Start with plan_workflow before writing any code.
```

Or more specifically:

```text
Call plan_workflow with goal="<your goal>" and show the concise product-card
response before suggesting any implementation.
```

---

## Recommended Prompt Patterns

### Full planning session from scratch

```text
I want to build an AI workflow that [describe goal].

1. Call plan_workflow with my goal.
2. Show the concise product-card response and recommended next action.
3. Explain any unfamiliar components only after the first card is visible.
4. Do not write code until I accept or adjust the plan.
```

### Quick architecture check

```text
Before implementing, call plan_workflow with:
  goal: "read inbound emails, classify intent, and draft a reply"

Show me the product-card response and any safety or coverage warnings.
```

### Safety review of an existing design

```text
I have this workflow design:
[paste your design]

Call review_workflow_design with this design and highlight any:
- missing approval gates
- state management gaps
- tool safety issues

Return status, risk score, and top 3 recommendations.
```

### Component deep-dive

```text
Call explain_component for "human_approval_gate" and explain when it should be
included in a workflow.
```

---

## Tips

- Be specific about your goal. "send emails" matches differently from "draft and review outbound emails".
- Mention constraints in the goal, such as "never send automatically" or "read-only".
- Ask Cursor to show the `plan_workflow` product card before implementation.
- Treat candidate routes as proposals. Validated playbooks have stronger evidence.

---

## Tool Reference Summary

| Tool | When to use |
|------|-------------|
| `health_check` | Verify server is connected and registry is loaded |
| `plan_workflow` | Primary first-run planner: product card, route, safety, coverage, next action |
| `explain_component` | Explain one component in plain language |
| `list_known_routes` | Browse validated and candidate workflow patterns |
| `get_playbook` | Full guidance for a selected playbook |
| `review_workflow_design` | Safety checker for an implementation design |
| `get_relevant_docs` | Docs sources for components, frameworks, and topics |
