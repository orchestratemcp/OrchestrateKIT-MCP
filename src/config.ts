export const SERVER_NAME = "orchestratekit-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * Release-trust count floors (MAR-220). `health_check.safe_to_demo` reports
 * false — and the health-check regression test fails — if the live registry
 * drops below these. Raised after the MAR-267 PR-review golden-path edges.
 */
export const MIN_COMPONENTS = 64;
export const MIN_EDGES = 151;

/**
 * P0-06 (MAR-220 follow-up): published route/playbook count floors. Same
 * regression-floor contract as MIN_COMPONENTS/MIN_EDGES above — an old hosted
 * build could still clear the component/edge floor while silently missing
 * routes or playbooks added since it was deployed, so those need their own
 * floors rather than piggybacking on the component/edge counts.
 */
export const MIN_ROUTES = 12;
export const MIN_PLAYBOOKS = 12;

/**
 * P0-06 (MAR-220 follow-up): the mtime-independent content fingerprint
 * (`contentFingerprint()`) of the published registry this release ships with.
 * Unlike the count floors above — which a stale build can still clear if it
 * happens to have "enough" of everything — this pins the EXACT registry
 * snapshot. `computeDemoBlockers` and `scripts/check-release-trust.ts` both
 * compare the running/checked-out fingerprint against this constant so a
 * hosted build serving an older (or newer, unreleased) registry is reported
 * as "counts compatible" but NOT "matching release", and safe_to_demo is
 * false either way.
 *
 * Update this alongside docs/releases/v0.1.0.md whenever the registry is
 * intentionally changed and re-released — recompute via
 * `contentFingerprint(readRawEntries())`.
 */
export const EXPECTED_RELEASE_FINGERPRINT = "531d33b7039db3ca";

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
- Monitoring & output: how does the user want to monitor this agent once it
  runs, and where does its output land (e.g. "HubSpot notes + Gmail drafts",
  "a Slack channel", "a Postgres table")? This does not change the route, but
  \`export_build_brief\` records it in the agent.manifest.json for DASH.

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

## Scope compiler handoff

Run the scope compiler flow in this order:

1. Clarify: ask the missing constraint questions before locking scope.
2. Confirm scope: fold the user's answers into a fresh \`plan_workflow\` call
   and confirm the selected steps, connections, build target, host/monitor
   target, tracking target, and artifact.
3. Compile artifacts: call \`export_build_brief\` only after the user has
   confirmed the scope.

\`export_build_brief\` is stateless and deterministic: it compiles templates,
prompts, issue fields, milestones, and guardrails, but it does not call an LLM
and does not write to Linear, Obsidian, Slack, email, CRM, GitHub, or any other
external system.

Before locking scope, ask at least 3 targeted clarifying questions when the
runtime, write permission, outbound behavior, deployment target, tracking
target, or output destination is ambiguous. Do not emit implementation issues
until the human confirms the scope. When using \`export_build_brief\`, preserve
every Linear issue template field. If a field cannot be filled from the
confirmed scope or repository context, mark it UNKNOWN and ask the human rather
than guessing.

## Important constraints

- Before calling \`plan_workflow\`, always ask the user for their specific
  workflow goal and the constraints above (read-only? unattended? no outbound
  sends?). Never infer or fabricate a goal from the instruction prompt or
  conversation preamble.
- After calling \`plan_workflow\`, render its \`summary_markdown\` to the user
  VERBATIM — do not paraphrase, summarize, or compress it, and do not drop the
  "How do you want to continue?" A) B) C) D) E) menu at the end. That menu is the
  product; a paraphrase that collapses it into prose breaks the experience.
- If you execute the plan in-chat via connectors, you MUST declare it as the
  attended dry-run option (E) — a one-shot walking skeleton where nothing
  persists and there is no trigger — and offer \`export_build_brief\` afterward.
  A chat run never fulfills a "build" goal on its own; the agent dies with the
  session.
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

