# OrchestrateMCP — Claude Desktop Usage Guide

How to use OrchestrateMCP from Claude Desktop for workflow graph-assisted
architecture planning and safety review.

---

## Connecting the MCP

See `docs/LOCAL_SETUP.md` for installation and connection instructions.

Once connected, the 🔌 icon in the bottom-left of a Claude Desktop conversation
shows the active MCP servers. Click it to verify **orchestratekit** is listed.

---

## Starting a planning session

Claude Desktop handles tool use differently from Cursor — it is more conversational
and will reason step-by-step through tool calls when asked.

A good session opener:

```
I want to design an AI workflow for [goal]. 

Please start by calling the orchestratekit MCP tools:
1. recommend_architecture with my goal
2. If you find a matching playbook, call get_playbook
3. Call review_workflow_design once we have a rough design

Do not suggest implementation code until we have completed the safety review.
```

---

## Recommended prompts

### Architecture planning

```
Using orchestratekit MCP, call recommend_architecture with:
  goal: "process inbound support emails and draft replies using thread context"

Show me:
- the recommended steps with their classification (LLM vs deterministic)
- any do-not-build warnings
- whether a golden-path playbook exists for this workflow type
```

### Playbook lookup

```
Call get_playbook with workflow_type="data extraction and enrichment" and
include_graph=true so I can see the components, edges, and approval gates.
```

### Safety review

```
I'm planning this AI workflow:
[describe your design]

Call review_workflow_design with this design. Tell me:
- the status (pass / warnings / fail)
- the risk score
- the most critical findings with recommended fixes
```

### Docs and references

```
Call get_relevant_docs with frameworks=["openai-agents", "cursor"] and show me
the documentation sources I should read before implementing this workflow.
```

### Component exploration

```
Call list_graph_components filtered to category="safety" and explain when each
safety component should be added to a workflow.
```

---

## Tool call flow for architecture design

A typical design session looks like this:

```
User:  → recommend_architecture
Claude: [calls tool, returns route + classification + warnings]

User:  → get_playbook (if playbook found)
Claude: [calls tool, returns golden-path steps + sources + evals]

User:  We'll use this design. Run a safety review.
Claude: [calls review_workflow_design, returns findings]

User:  Show me the docs for the frameworks involved.
Claude: [calls get_relevant_docs]
```

---

## Differences from Cursor

| | Cursor | Claude Desktop |
|---|---|---|
| Tool invocation | Semi-automatic in agent mode | Requires explicit prompting |
| Tool chaining | Automatic multi-step | Step-by-step with confirmation |
| Code generation | After planning | After planning |
| Best for | Active development | Architecture review, design sessions |

Claude Desktop is especially good for **long-form architectural discussions** where
you want to reason about each tool output before proceeding to the next step.

---

## Known limitations

- Claude Desktop does not have file system access by default. The MCP tools return
  all context as text — no files are written to disk.

- If the tool icon shows but tools fail, check that the Node.js binary is on
  the system `PATH`, not just your shell profile. See troubleshooting in
  `docs/LOCAL_SETUP.md`.

- Candidate routes (status: `candidate_route`) are graph compositions not yet
  backed by a validated playbook. Treat these as informed proposals.
  Always run `review_workflow_design` before implementing a candidate route.
