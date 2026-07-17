# The Agent-Creation UX Spine

- **Status:** reference doc, adopted 2026-07-17
- **Owner:** Henrik
- **Mirrored in:** Linear project doc "Agent Creation UX Spine" (OrchestrateKit & OrchestrateLab)
- **Companion:** [STATE_OF_PROJECT_AND_UX_REVIEW_2026-07-16.md](./STATE_OF_PROJECT_AND_UX_REVIEW_2026-07-16.md) §9–§11 (the detailed golden-flow walkthrough this doc compresses into an ordering principle)

---

## Thesis

The best agent-creation UX is **not a wizard — it is a contract that gets progressively more real**. Simple and advanced users walk the **same spine**; the difference is how many layers they open, not which flow they enter.

```text
Goal → Reflected contract → Dry run on real data → Connect (least privilege) → Activate → Observe
```

The governing metric is **time-to-first-safe-run on the user's real data**. Not time-to-configured, not time-to-deployed — time until the user *sees* the agent produce a real draft from their real inbox with nothing written anywhere. That moment creates trust; everything before it is friction, everything after it is commitment the user is now willing to make.

## Why the dry run is the keystone

The failed MAR-363 takes proved this accidentally. When the client agent freelanced and executed the workflow live in chat, the *result* was the best part of the session — real emails, real calendar, a real proposed draft, approval in conversation. The failure was that the chat run was **unnamed, unstructured, and dead-ended**, silently substituting for the build.

So the spine makes it official: after the contract, before any runtime OAuth or hosting decision, the user gets **"Try it once, right now, nothing persists."** The promote action ("make this durable") arrives when the user has already seen it work — the only moment they genuinely care about triggers, hosting, and approval inboxes. (Zapier's "test this step" and Cursor's plan mode embody the same principle: *show me on my data before asking me to commit*.)

## The simple path (non-developer)

1. **Goal in one sentence.** No component names, no "trigger" vocabulary.
2. **Reflected contract, editable, in their words.** Reads this / decides this / writes this / **never** does this / asks you before X. Each line marked understood / assumed / needs-your-decision. Forbidden lines are **structural** — "Email sending: not possible," not a toggle set to off.
3. **At most 2–3 questions, all material.** Only things that change side effects, money, or safety — the calendar-notification decision (private hold vs. real invite) is the canonical example. Timezone/working-hours defaults get proposed, not asked.
4. **Dry run.** One click, real reads, zero writes, produces the actual approval card production would show. This doubles as the connection test — connecting Gmail happens *here*, framed as "let it look at your inbox once," a much smaller ask than "grant this agent access."
5. **Approval card as the product.** Sender, excerpt, the two slots, the full draft, and an explicit effects list: ✓ one calendar event · ✓ one saved draft · ✗ send — unavailable. Approve / edit / reject. A high edit rate means the contract was wrong — that is the feedback loop.
6. **Promote.** "Run this automatically when meeting requests arrive." Only now do runtime, trigger, and offline story appear, in plain language: what wakes it, what happens when the laptop is closed, where approvals live, how to pause or kill it. One recommended choice; alternatives behind a fold.
7. **Observe.** A human-readable run timeline and honest partial-failure states ("event created, draft failed, nothing sent — retry the draft?").

**Bar:** the user reaches step 5 in under five minutes and never sees a scope URL, component ID, cron string, or JSON.

## The advanced path

Same spine — but **every layer is an artifact you can open, edit, and version**:

- The contract is a file (Plan Passport) — diffable, replayable, what CI validates against.
- The route is inspectable per component: risk, failure modes, model tier, edges, provenance. `must_avoid` exists here; the simple path never shows it.
- Connections expose actual scopes and token ownership (DASH / agent / external manager), with a "why each scope" line.
- The build target is a choice: supported runtime adapter, build brief for Claude Code/Cursor/Codex, or portable prompt. The escape hatch is the *advanced* path, never the only path.
- Evals and acceptance criteria ship with the contract; plan-vs-actual drift is a first-class view.

The advanced user's superpower is not a different UI — it is that the simple path's guarantees become **programmable and auditable**.

**Deliberate non-goal:** a canvas/node-graph editor. It demos well and produces the worst outcomes, because it makes users responsible for architecture they cannot evaluate. Registry-grounded composition is the bet: humans edit the *contract*, the system owns the *graph*.

## Anti-patterns (hard rules)

- **Config before value** — any OAuth, hosting, or naming step before the user has seen output on their data.
- **Interrogation wizards** — screens of questions the user cannot answer yet. Ask after the dry run, when questions are concrete.
- **Toggle-shaped safety** — "send email: off" invites drift; prohibitions must be absent capabilities.
- **Fake completeness** — "full coverage" / "deployed" / "connected" that a curious click can falsify.
- **Dead ends** — every screen has exactly one obvious next action, including the last one.

## Mapping to the roadmap

The hard parts exist: contract (passport + reflected goal), grounded planning, post-Phase-0 safety semantics, build briefs, the LAB evidence loop. The missing middle of the spine, in build order:

| Spine step | Work item | State (2026-07-17) |
|---|---|---|
| Dry run named + structured | attended-dry-run continuation mode in `plan_workflow` | in progress (parallel session) |
| Material questions | calendar-notification clarifying question (review §8.7/§9.2) | queued (handoff prompt issued) |
| Contract honesty | coverage semantics: quantities/ordering/cardinality (review P0.5, MAR-250 keystone) | queued |
| Connect | Connection Center, MAR-383 — target: "a connection is a remote MCP server the user authorized once," broker-backed (see MAR-383 design-note comment 2026-07-17) | backlog |
| Promote | one supported runtime adapter, MAR-379 / MAR-377 epic | backlog |
| Observe | DASH run timeline + plan-vs-actual, MAR-298 / MAR-384 | backlog |

**Ordering principle:** prioritize by the spine, so each shipped piece extends the distance a real user travels along it, rather than deepening one layer.

**Recording bar (MAR-363, deferred):** the golden prompt returns the identical clean plan five runs in a row, and a scripted client session follows the menu through dry run → `export_build_brief` without improvising. When the run is boring, record once.
