# Smoke test — "is everything working?"

Four commands. Run them from the repo root after `pnpm install`. The first three
are the CI gates (deterministic, no network, no LLM); the fourth is a readable
demo so you can *see* the planner working.

```bash
pnpm verify   # typecheck + registry lint + full test suite  (965 tests)
pnpm probe    # single-capability matcher/composer assertions (69 probes, 1 xfail)
pnpm build    # compile to dist/ (the stdio + HTTP servers)
pnpm demo     # human-readable end-to-end demo (see below)
```

Green on all four = the MCP is healthy.

## What `pnpm demo` shows

It boots the **real** MCP server in-memory, connects a **real** MCP client over a
linked transport, and prints a few calls — the same code path a connected
ChatGPT / Claude / Cursor uses. You should see:

| Section | Proves | Issue |
|---|---|---|
| Tool discovery | 17 tools registered; 6 declare an output schema | MAR-163 |
| `health_check` | 47 components · 78 edges · 6 playbooks · 4 workers; **78/78 (100%) edges validated** | MAR-164 |
| `plan_workflow` (real plan) | a composed route + the status-header block + `structuredContent` returned | MAR-101 / MAR-163 |
| `plan_workflow` (guard) | echoed preamble → `status: needs_goal` instead of a fabricated plan | MAR-162 |
| `plan_workflow` (negation) | "drafts only, … no email" → **no email steps leak** into the route | MAR-161 |
| `explain_component` | plain-language, non-technical explanation | MAR-136 |

## If something is red

- A **snapshot** mismatch in `tests/tools/outputSchemas.test.ts` after a
  deliberate change is expected — review the diff, then `pnpm vitest run
  tests/tools/outputSchemas.test.ts -u` to accept it.
- A **probe** failure prints the goal + the offending route; fix the matcher or
  xfail the probe with a linked issue (never go green by ignoring it).
- A **stale build** in a connected client (old output after a code change) is the
  MAR-141 trap — `pnpm build` then reconnect the client. For the hosted Worker,
  `pnpm deploy:worker`.
