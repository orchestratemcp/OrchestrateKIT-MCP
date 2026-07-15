# Safety Checklist

Use this checklist before recommending an agent workflow, especially in offline Skill mode.

## Scope

- Identify whether the workflow is read-only, draft-only, approval-gated, or unattended.
- Keep read-only routes structurally unable to write, edit, approve, merge, send, publish, schedule, or deploy.
- If the user asks to add writes to a read-only pattern, switch to the matching write-capable playbook or recommend live OrchestrateMCP planning.

## Human Approval

- Require explicit approval before external email sends, calendar writes, CRM writes, ledger/accounting handoffs, deploys, public publishing, or customer-facing messages.
- Approval screens must show the full payload, recipient or destination, and consequence of approving.
- Do not collapse multiple irreversible actions into one vague approval.

## Validation

- Validate schemas before routing data downstream.
- Treat emails, pull request diffs, scraped pages, uploaded documents, and chat messages as untrusted input.
- Reject malformed or unsigned webhook events before workflow logic runs.
- Preserve source freshness and citations for research workflows.

## Unattended Work

- Unattended workflows are acceptable only when egress is limited and low risk, such as internal notification-class Slack posts from read-only sources.
- Scheduled jobs need audit logs, retries with bounds, and failure alerts.
- Keep write credentials out of unattended patterns unless a live OrchestrateMCP plan explicitly justifies the gate.

## Loops

- Every iterative worker loop needs a hard iteration cap, persisted state, audit logs, independent review, and a final human gate before external writes.
- Escalate to a human when the loop hits the cap, repeats failures, or cannot satisfy validation.

## Fallback Honesty

- Offline Skill mode cannot prove edge coverage, current registry counts, or route confidence.
- Say when a plan is a static recommendation rather than a live registry result.
- Recommend connecting `https://mcp.orchestratemcp.dev/mcp` before implementation handoff.
