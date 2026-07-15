# Setup

The fastest path is the hosted OrchestrateMCP endpoint:

```text
https://mcp.orchestratemcp.dev/mcp
```

Authentication is not required. The endpoint is read-only and stateless.

## Claude Web / Claude Cowork

1. Open a Claude project that supports connected tools.
2. Add an MCP server using the hosted endpoint.
3. Verify that OrchestrateMCP tools appear.
4. Start with a concrete goal and ask Claude to call `plan_workflow`.

## Claude Desktop

Use the local setup guide in this repository when you need a local stdio server:

```text
docs/LOCAL_SETUP.md
docs/CLAUDE_DESKTOP_USAGE.md
```

## Offline Skill Mode

This Skill can still guide a conversation without the MCP connection, but it is limited to static references. Connect the hosted endpoint when you need:

- current registry matching
- component explanations
- tested route and playbook details
- route confidence and untested edge warnings
- Plan Passport export
- Plan Passport replay verification
