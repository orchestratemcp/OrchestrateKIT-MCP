export const SERVER_NAME = "orchestratekit-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * MAR-99: server-level instructions sent to AI clients on connect.
 *
 * Guides the client on which tool to call first and how to use the suite.
 * Rendered by Claude.ai, Cursor, and other MCP clients that support server
 * instructions — appears as a system note alongside the tool list.
 */
export const SERVER_INSTRUCTIONS = `\
OrchestrateMCP is a workflow-design advisor. It helps you plan safer AI agent
workflows by grounding decisions in a registry of tested components, edges, and
patterns.

## Before you plan: gather the user's constraints

Before the first \`plan_workflow\` call, briefly ask the user about the
constraints that change which steps are safe. A goal sentence alone rarely
states them, and they materially affect the plan:

- Read-only vs. write: may the workflow edit, commit, or change anything, or
  only read and report? (e.g. "review the PR but never edit code")
- Attended vs. unattended: will a human be in the loop to approve actions, or
  must it run fully automatically with no approval step?
- Outbound sends: is the agent allowed to send email, post to Slack, or
  publish externally — or must it stay internal / draft-only?

Fold the user's answers into the plain-English goal you pass to
\`plan_workflow\`, in the user's own words.

IMPORTANT: never coach the user to use specific "magic" trigger words to
steer the matcher. Ask about real constraints in plain language and describe
the goal as the user actually phrases it. The planner is designed to read
natural phrasing; gaming its vocabulary produces worse, less honest plans.

## Getting started

1. Call \`plan_workflow\` with your goal in plain English — it returns a
   complete workflow plan, safety review, model-tier guidance, and a flag when
   a validated pattern already exists.

2. If \`plan_workflow\` mentions a component you don't recognise, call
   \`explain_component\` with that component's id — it explains what the
   component does and what can go wrong, without technical jargon.

3. Browse validated workflow patterns with \`list_known_routes\` and retrieve
   details with \`get_route\`.

## Important constraints

- Before calling \`plan_workflow\`, always ask the user for their specific
  workflow goal and the constraints above (read-only? unattended? no outbound
  sends?). Never infer or fabricate a goal from the instruction prompt or
  conversation preamble.
- OrchestrateMCP is a design-time advisor. It does NOT execute workflows,
  make API calls, or modify any external system.
- Always prefer \`plan_workflow\` as the primary entry point. Only call
  lower-level tools (\`compose_workflow_route\`, \`list_graph_components\`,
  etc.) when you need fine-grained control.
- Treat composed candidate routes as drafts — review untested edges and
  safety warnings before building.

Call \`health_check\` to verify the server is connected and to see registry
counts.
`;

