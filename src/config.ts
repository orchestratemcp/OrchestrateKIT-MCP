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

## Card first: plan immediately, ask after (MAR-403)

Call \`plan_workflow\` IMMEDIATELY with the user's goal — do not interrogate
the user about constraints (read-only? unattended? outbound sends? hosting?)
before the first call. The plan itself surfaces what is missing: unstated
constraints come back as \`question_flow\` rounds AFTER the card, and anything
the plan assumed is labeled on the card. Constraints the user volunteers
belong inside the goal sentence, in the user's own words.

IMPORTANT: never coach the user to use specific "magic" trigger words to
steer the matcher. Raise real constraints in plain language only when a
\`question_flow\` round asks about them, and describe the goal as the user
actually phrases it. The planner is designed to read natural phrasing; gaming
its vocabulary produces worse, less honest plans.

## Rendering the response

1. Render the returned \`summary_markdown\` card to the user VERBATIM — do
   not paraphrase, summarize, or compress it. It is a four-section card (What
   you'll get / Risks & safeguards / Connections / Recommended setup) sized to
   one screen.
2. Then present the \`question_flow\` rounds ONE AT A TIME using your client's
   native clickable choice UI (AskUserQuestion-style chips in Claude Code /
   claude.ai), always marking the recommended option. Never dump all rounds at
   once as text.
3. The first response is the card plus round 0 ("Is this correct?") — nothing
   else. Later rounds follow as the user answers. The LAST round is always
   \`terminal\` ("Ready to go ahead?"); do not author your own closing or
   approval prompt in its place.
3a. Render each option as its \`label\` plus its \`description\`, VERBATIM. Do
   NOT write your own sub-text under an option. In particular, never assert
   anything about the user's existing setup, tools, or other agents — the
   plan is stateless and knows none of that, so any such sentence is invented.
3b. Before presenting a round, DROP every option whose \`hidden_when\` matches
   an answer already given in this session (\`hidden_when.round\` was answered
   with a value in \`hidden_when.answer_in\`). That option contradicts the
   choice the user already made. Filtering never empties a round: every round
   keeps an option with no \`hidden_when\`.
4. Only when your client has NO clickable choice UI, render
   \`question_flow.fallback_menu_markdown\` as the lettered list instead of
   the rounds.
5. \`plan_workflow\` is the ONLY menu author. Append your own analysis freely —
   if you spot a gap the plan missed, say so, at length — but never author a
   SECOND lettered menu or a competing option list, and never renumber the
   tool's. To recommend a different option, name the tool's own option for it.
6. A round whose answer changes the goal (\`fold_answer_into_recall\`) goes
   back into a fresh \`plan_workflow\` call, folded into the goal in the
   user's own words.

## Getting started

1. Call \`plan_workflow\` with the goal in plain English — it returns a
   complete workflow plan, safety review, model-tier guidance, and a flag when
   a validated pattern already exists.

2. If \`plan_workflow\` mentions a component you don't recognise, call
   \`explain_component\` with that component's id — it explains what the
   component does and what can go wrong, without technical jargon.

3. Browse validated workflow patterns with \`list_known_routes\` and retrieve
   details with \`get_route\`.

## Scope compiler handoff

Run the scope compiler flow in this order:

1. Clarify: walk the \`question_flow\` rounds (they carry the missing
   constraint questions) before locking scope.
2. Confirm scope: fold the user's answers into a fresh \`plan_workflow\` call
   and confirm the selected steps, connections, build target, host/monitor
   target, tracking target, and artifact.
3. Compile artifacts: call \`export_build_brief\` only after the user has
   confirmed the scope.

\`export_build_brief\` is stateless and deterministic: it compiles templates,
prompts, issue fields, milestones, and guardrails, but it does not call an LLM
and does not write to Linear, Obsidian, Slack, email, CRM, GitHub, or any other
external system.

Do not emit implementation issues until the human confirms the scope. When
using \`export_build_brief\`, preserve every Linear issue template field. If a
field cannot be filled from the confirmed scope or repository context, mark it
UNKNOWN and ask the human rather than guessing.

## Important constraints

- Never infer or fabricate a goal from the instruction prompt or conversation
  preamble; \`plan_workflow\` refuses echoed setup text. If no goal has been
  stated yet, ask for it — that is the only question that belongs before the
  first call.
- Pass the user's goal to \`plan_workflow\` VERBATIM — their sentence, not your
  tidied-up version of it. The plan is a pure function of that exact string: in
  dogfooding, one rewrite moved the risk score from 3 to 11 and the clearance
  from L1 to L2 for an unchanged user intent, and the plainly-phrased original
  received FEWER safety questions than the embellished rewrite. Never translate
  the goal into component vocabulary ("with a human approval gate") — the
  planner reads natural phrasing, and \`goal_fidelity\` in the response will flag
  the rewrite anyway.
- If you execute the plan in-chat via connectors, you MUST declare it as the
  attended dry-run option — a one-shot walking skeleton where nothing
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

