# OrchestrateKit MCP — Cursor Usage Guide

How to use OrchestrateKit MCP effectively from Cursor to get graph-aware
architecture recommendations, playbook guidance, and workflow safety reviews.

---

## Connecting the MCP

See `docs/LOCAL_SETUP.md` for installation and connection instructions.  
Once connected, the tools appear in Cursor's MCP panel and are callable from any
chat in the workspace.

---

## Which tools to call first for architecture planning

Call these tools **before writing any code** when designing a new AI workflow:

1. **`list_known_routes`** — get an overview of tested workflow patterns in the
   registry. Use this to orient yourself before asking for a composition.

2. **`recommend_architecture`** — the primary planning tool. Provide your goal as
   a short description. The tool composes a route, classifies steps (LLM-driven vs.
   deterministic), checks for anti-patterns, and returns a structured recommendation.

3. **`get_playbook`** — if a golden-path playbook exists for your workflow type, this
   returns full implementation guidance including known failure modes, guardrails, and
   ordered steps.

4. **`review_workflow_design`** — once you have a rough design, run this to get a
   safety check: missing approval gates, state management gaps, tool safety findings.

5. **`get_relevant_docs`** — fetches documentation sources for the frameworks and
   components involved in your workflow.

---

## Forcing Cursor to use the MCP

Cursor will sometimes skip MCP tools and answer from its training data.
To force it to use the tools, be explicit in your prompt:

```
Use the orchestratekit MCP tools to recommend an architecture for this workflow.
Start with recommend_architecture before writing any code.
```

Or more specifically:

```
Call recommend_architecture with goal="<your goal>" and return the full output
before suggesting any implementation.
```

---

## Recommended prompt patterns

### Pattern 1 — Full planning session from scratch

```
I want to build an AI workflow that [describe goal].

1. Call list_known_routes to show me what tested routes exist.
2. Call recommend_architecture with my goal.
3. If a playbook exists, call get_playbook to show me the golden-path steps.
4. Call review_workflow_design on the proposed design.

Do not start writing code until we have reviewed the workflow design.
```

### Pattern 2 — Quick architecture check

```
Before implementing, call recommend_architecture with:
  goal: "read inbound emails, classify intent, and draft a reply"
  
Show me the step classification and any do-not-build warnings.
```

### Pattern 3 — Safety review of an existing design

```
I have this workflow design:
[paste your design]

Call review_workflow_design with this design and highlight any:
- missing approval gates
- state management gaps
- tool safety issues

Return status, risk score, and top 3 recommendations.
```

### Pattern 4 — Component deep-dive

```
Call get_graph_component for "human_approval_gate" and explain when it
should be included in a workflow based on the edges in the registry.
```

### Pattern 5 — Stack recommendation

```
Call get_stack_recommendation for the default orchestratekit stack and
suggest which parts I should swap out for [my constraints].
```

---

## How to avoid Cursor skipping planning and jumping to code

These patterns keep Cursor in planning mode:

1. **Start every session with a planning prompt.** Ask for `recommend_architecture`
   output before any implementation discussion.

2. **Add a rule to your `.cursorrules` or Cursor system prompt:**
   ```
   For any AI workflow or agent feature, always call the orchestratekit MCP
   recommend_architecture tool before writing implementation code.
   ```

3. **Use `review_workflow_design` as a gate.** Tell Cursor:
   ```
   Do not proceed to implementation until review_workflow_design returns
   status="pass" or we have explicitly accepted all warnings.
   ```

4. **Ask for the full tool output, not a summary.** If Cursor paraphrases,
   it is not using the registry data. Ask:
   ```
   Show me the raw recommend_architecture output, not a summary.
   ```

---

## Tips for effective prompts

- **Be specific about your goal.** The capability matcher scores against your goal
  text. "send emails" matches differently from "draft and review outbound emails".

- **Mention constraints.** Use `must_avoid` for components you don't want:
  ```
  Call recommend_architecture with goal="..." and must_avoid=["vector_store"].
  ```

- **Ask about untested edges.** If the route includes untested edges, ask:
  ```
  Which edges in this route are untested? What's the risk?
  ```

- **Ask about candidate vs. validated routes.** Candidate routes are graph
  compositions without validated playbook coverage — treat them as proposals.

---

## Tool reference summary

| Tool | When to use |
|------|-------------|
| `health_check` | Verify server is connected and registry is loaded |
| `list_graph_components` | Browse all available workflow building blocks |
| `get_graph_component` | Deep-dive on one component: capabilities, edges, risk |
| `list_graph_edges` | See all tested/untested relationships between components |
| `list_known_routes` | Overview of validated and candidate workflow patterns |
| `get_route` | Full details of a specific route |
| `get_stack_recommendation` | Technology stack guidance for your context |
| `compose_workflow_route` | Compose a custom route for an arbitrary goal |
| `recommend_architecture` | **Primary planning tool** — wraps compose + classify + anti-patterns |
| `get_playbook` | Golden-path implementation guidance for a workflow type |
| `get_relevant_docs` | Docs sources for components, frameworks, and topics |
| `review_workflow_design` | Safety checker — approval gates, state, tool safety |
