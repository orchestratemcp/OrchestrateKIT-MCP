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
OrchestrateKit is a workflow-design advisor. It helps you plan safer AI agent
workflows by grounding decisions in a registry of tested components, edges, and
patterns.

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
  workflow goal. Never infer or fabricate a goal from the instruction prompt
  or conversation preamble.
- OrchestrateKit is a design-time advisor. It does NOT execute workflows,
  make API calls, or modify any external system.
- Always prefer \`plan_workflow\` as the primary entry point. Only call
  lower-level tools (\`compose_workflow_route\`, \`list_graph_components\`,
  etc.) when you need fine-grained control.
- Treat composed candidate routes as drafts — review untested edges and
  safety warnings before building.

Call \`health_check\` to verify the server is connected and to see registry
counts.
`;

