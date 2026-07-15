---
name: OrchestrateKit Agent Planner
description: Plan safer AI-agent workflows with OrchestrateMCP. Use when the user wants to design, scope, safety-review, or hand off an AI automation, agent, MCP workflow, or multi-step tool workflow.
---

# OrchestrateKit Agent Planner

Use OrchestrateMCP as the source of truth when its MCP tools are connected. This Skill is a portable on-ramp and fallback, not a replacement for live registry matching.

## First response

If the user has not supplied a concrete workflow goal, ask for the goal before planning. A goal is the thing they want the agent or automation to do.

Before planning, clarify any missing constraints that change safety:
- Is the workflow read-only, or may it write, commit, publish, send, schedule, or deploy?
- Will a human approve risky actions, or must it run unattended?
- Is outbound email, Slack, publishing, customer communication, or production mutation allowed?
- Where should monitoring, audit logs, and final output land?

## When OrchestrateMCP tools are connected

1. Call `plan_workflow` with the user's goal and the clarified constraints in plain English.
2. Render `summary_markdown` verbatim, including the continuation menu.
3. Explain unfamiliar or risky components with `explain_component`.
4. If the user wants a known pattern, call `get_playbook` or read `orchestratekit://playbooks/<playbook_id>` when the ID is known.
5. If the user wants implementation handoff, confirm scope and then call `export_build_brief`.
6. Treat `compose_workflow_route` output as a draft candidate route until reviewed for untested edges and safety warnings.

Do not invent components, edges, registry counts, playbook statuses, or validation claims. Prefer live tool output over this Skill's static references whenever they differ.

## When OrchestrateMCP tools are not connected

Use the references as a static planning aid:
- Read `references/playbooks.md` to match the user's goal to a known pattern.
- Read `references/safety-checklist.md` before recommending any write, send, publish, schedule, deploy, or loop.
- Read `references/setup.md` when the user needs the hosted MCP connection.

Be explicit that offline Skill mode cannot score route confidence, inspect the latest registry graph, or export a deterministic Plan Passport. Recommend connecting the hosted MCP endpoint for those steps.

## Output contract

Keep the first answer concise and action-oriented:
- Name the closest playbook or say no close match.
- State whether the plan is read-only, draft-only, gated, or unattended.
- Surface the highest-risk missing approval or validation step.
- Give the next best action: connect MCP, fetch a playbook, run safety review, or compile a build brief.
