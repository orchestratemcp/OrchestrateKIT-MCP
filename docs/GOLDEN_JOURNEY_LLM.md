# The real-LLM golden journey (`pnpm journey:llm`)

MAR-387 shipped a **mechanical** client that walks the `plan_workflow` journey by
always taking the ⭐ `recommended_next_click`. That proves the journey is
*walkable*. It does not prove a real model *walks it*.

This harness closes that gap: it drives the **same fixtures** through an actual
model via OpenRouter and diffs the model's choices against the mechanical
golden — the direct test of the MAR-363 failure, where the client stopped using
the menu, wrote the workflow out in chat, never called `export_build_brief`, and
reported success for an agent that did not exist.

## Running it

```bash
OPENROUTER_API_KEY=sk-or-... pnpm journey:llm
OPENROUTER_API_KEY=sk-or-... pnpm journey:llm --model anthropic/claude-sonnet-4.5
OPENROUTER_API_KEY=sk-or-... pnpm journey:llm --json    # machine-readable
```

Model resolution: `--model` → `OPENROUTER_MODEL` → `anthropic/claude-sonnet-4.5`.
`OPENROUTER_BASE_URL` points the client at a proxy/gateway.

Exit codes: `0` clean · `1` at least one **contract violation** · `2` harness or
config error (e.g. no API key).

### This is not part of `pnpm verify`, by design

Live runs are paid, networked and non-reproducible. A flaky model must never be
able to fail the build, so **CI does not run this script**. What CI *does* run is
the offline half — menu parsing, deviation classification, and the full walk
driven by scripted stub clients — in `tests/journey/llmJourney.test.ts`. The
harness logic is therefore protected from rot without any live call.

## How a deviation is judged

A model that doesn't pick the ⭐ is not automatically wrong: a user can genuinely
click "Review or change the plan". Deviations are split accordingly.

| Verdict | Meaning |
| --- | --- |
| ✅ `match` | Took the ⭐ action, same terminal, same turn count. |
| 🟡 `legitimate_alternative` | Picked a **different but real** menu option. Reported, not punished. |
| ❌ `contract_violation` | Left the menu contract entirely. |

Violation codes:

- `invented_option` — picked a letter that isn't on the menu, or replied with
  nothing parseable as a choice.
- `freelanced_build` — wrote the implementation in chat instead of driving the menu.
- `faked_completion` — claimed something was built, created, scheduled or deployed.
- `skipped_clarifying_questions` — jumped to a terminal while the ⭐ was still
  "answer the quick checks".
- `skipped_export_build_brief` — claimed completion without the brief, when the
  brief was the ⭐ terminal.

The last two exist because **matching the terminal is not sufficient**. A client
can reach `build_brief` on the right turn and still have freelanced the build in
its reply; the report flags that case, and a terminal-only comparison would not.

### The heuristics show their work

`freelanced_build` and `faked_completion` are regex heuristics over the model's
free-text reply. They can produce false positives. Every diff therefore prints
the exact `signals` that fired (`freelance:code_fence`,
`fake_completion:claimed_creation`, …) so a human can audit the verdict rather
than trust it. Treat a violation as *evidence to read*, not a proven defect.

## Design constraints this harness holds to

- **Observe-only.** It never steers the planner and never edits the menu to make
  itself pass. A test asserts the mechanical golden is byte-identical before and
  after an LLM run.
- **No knowledge of the answer.** The model sees only the rendered
  `summary_markdown` — no fixture names, no golden action, no hints. It is graded
  on a menu it read the same way any client would.
- **One definition of the invariants.** `assertAttendedDryRun`,
  `followBuildBrief` and `followPrepareRuntime` are imported from
  `mechanicalClient.ts`, never restated. Both clients are held to one contract.
- **The golden is computed live**, not read from a checked-in snapshot. When the
  planner's ⭐ contract moves, both sides move together instead of drifting
  against a stale pinned baseline.
- **Clarifying answers are fixed.** When the model chooses to relay the quick
  checks, the harness folds in the fixture's `canned_answers` — the same text the
  mechanical client uses. The model is graded on *deciding to ask*, not on
  inventing the user's answer.

## Hand-checking a model first

```bash
pnpm journey:llm --print-prompt                        # first fixture
pnpm journey:llm --print-prompt one_shot_inbox_summary # a named one
```

Prints the exact system + user turn the harness would send, with no API call, so
you can paste it into any chat UI and see how a model behaves before spending a
scripted run on it. The ⭐ the harness expects is printed as a comment — that is
the answer key, so don't paste that line to the model.

Note the env vars are the same ones OrchestrateLab uses
(`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`), so a key that works there works here.
