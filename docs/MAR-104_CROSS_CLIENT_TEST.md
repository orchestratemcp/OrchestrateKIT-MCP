# MAR-104 — Cross-Client Test Script (turnkey)

**This is the MVP-A launch gate.** It proves the one thing never proven: that the target user (non-technical builder on ChatGPT agents / Claude Cowork) can actually connect OrchestrateKit and get a usable plan. Server side is already verified (`/health` ok, `/mcp` `initialize` handshake returns correct serverInfo + instructions). What's unproven is **tool discovery + usefulness inside the real clients.**

Budget ~30–45 min. Log every run to the Lab.

---

## 0. Prerequisites (do these first — non-negotiable)

```bash
cd orchestratekit-mcp
git checkout master
git pull                      # after PR #11 is merged
pnpm install
pnpm build                    # MUST rebuild — MAR-141 stale-build gotcha
```

> ⚠️ **MAR-141 trap:** a stale in-memory server silently serves pre-fix output and `health_check` won't warn you. Always `pnpm build` *then* start a fresh server. If you reconnect a client to an already-running old process, you're testing stale code.

Start the HTTP server (keep this terminal open):

```bash
pnpm start:http
# → orchestratekit-mcp v0.1.0 HTTP MCP server
#   MCP endpoint: http://127.0.0.1:3001/mcp
```

Sanity check from another terminal:
```bash
curl http://127.0.0.1:3001/health
# → {"status":"ok", ... "transport":"streamable-http" ...}
```

---

## 1. Connect each client

### Track A — ChatGPT (PRIMARY — your real client)
1. ChatGPT → create/open a **GPT** (or use Actions / connectors, wherever MCP lives in your build).
2. Add an MCP / connector endpoint: `http://127.0.0.1:3001/mcp`
   - If ChatGPT requires a public URL (it usually won't accept raw localhost), tunnel first:
     `ngrok http 3001` → use `https://<id>.ngrok-free.app/mcp`
3. Confirm it **lists the OrchestrateKit tools** (you should see `plan_workflow`, `explain_component`, `list_known_routes`, etc.).
   - **🔴 First fail-point to record:** does it discover the tools at all? If the tool list is empty or it errors, that's the headline finding — capture the exact error.

### Track B — Claude Cowork / claude.ai Project
1. Open a **Project** in claude.ai (Projects support connected tools).
2. Settings → **Connected tools / MCP servers** → add `http://127.0.0.1:3001/mcp` (or the tunnel URL).
3. Confirm the tool list appears.

### Track C — Claude Desktop / Cursor (stdio regression)
- Use your existing stdio config (no HTTP). This is the known-good baseline — run the same 3 goals to confirm no regression vs the MAR-109 sessions.

---

## 2. The 3 goals (run identically in each client)

Paste this preamble before each goal so the client is pushed to use the tools:

> Use the orchestratekit MCP tools — do not answer from general knowledge. Start by calling `plan_workflow` with my goal, then show me the recommended steps, any safety concerns, whether there's a tested pattern I can reuse, and explain any component I won't recognise with `explain_component`.

**Goal 1 — content/publishing (your flagship A/B baseline, MAR-120):**
> Goal: Take trending ecological-food topics, generate short social posts, and publish them to my social channels on a schedule.

**Goal 2 — scheduled data report, read-only (exercises the new components + constraints):**
> Goal: Every morning, pull yesterday's Stripe payments and post a summary to a Slack channel. Read-only — never write back to Stripe, and it runs unattended with no human approval step.

**Goal 3 — email triage with a write (exercises the over-match fixes):**
> Goal: Read my inbox, find sales leads, draft a reply to each, and log the lead to my CRM.

---

## 3. What to check per run (the things that decide pass/fail)

For each goal × client, eyeball these — they map to the residual matcher issues and the felt experience:

| Check | Looking for | Ties to |
|---|---|---|
| **Tool discovery** | Client actually lists + calls `plan_workflow` unprompted-ish | MAR-104 core |
| **No over-match** | G3 returns CRM write (`crm_note_write`), NOT `email_calendar_assistant` swallowing it | MAR-130 |
| **Constraint respected** | G2 "read-only / unattended" → no Stripe write; approval gate shown as *advisory* not hard-required | MAR-132/142 |
| **No calendar leak** | G2 "every morning / schedule" does NOT pull `calendar_lookup`/`calendar_write` | MAR-131/140 |
| **New components route** | G2 pulls `stripe_data_read` + `scheduled_trigger` + `slack_notification` | MAR-145 |
| **Plain language** | `explain_component` output is readable by a non-developer (no IDs/jargon) | MAR-136 |
| **Honesty** | Untested edges surfaced with severity; candidate vs validated stated | trust spine |
| **Readable for a novice** | Would a non-technical builder understand the plan and know the next click? | MVP-A bar |

---

## 4. Score each run (5-dim rubric, 1/3/5)

Per `EVIDENCE_RUBRIC.md`. Record a 1, 3, or 5 for each:

- **route_quality** — right steps, right order, nothing critical missing (1 = wrong/missing primary component, 3 = usable skeleton, 5 = clean domain match).
- **safety** — gates/writes handled correctly *and* respects stated constraints (1 = unsafe or contradicts constraint, 5 = correct + constraint-aware).
- **specificity** — concrete components/scopes vs vague (1 = generic, 5 = named components + scopes + next steps).
- **non_hallucination** — no invented components/edges; untested flagged (1 = fabricated, 5 = honest).
- **brevity** — digestible for a non-technical reader (1 = wall of jargon, 5 = clean).

Composite = mean. **A/B delta:** if you have bandwidth, run Goal 1 once with the MCP disabled (vanilla) and once with it, and record the difference — that's the public-evidence number.

---

## 5. Log to the Lab

For each run, create a session (or use `pnpm capture` for the deterministic fields, then rate):
- client (chatgpt / cowork / claude-desktop / cursor), model, goal, route selected, the 5 ratings, what helped, what was noise, any wrong/missing components, and **file a Linear issue** for any leak (the MAR-122 corpus loop).

> Reminder: **enforce `modelOutputRating`** — leaving it blank is what made the first batch half-unmeasured.

---

## 6. Pass / fail for the gate

**PASS (MVP-A unblocked) if:**
- Both ChatGPT and Cowork **discover and call** the tools, AND
- All 3 goals return a usable plan in each (composite ≥ 3), AND
- No safety/constraint violation (no Goal-2 write, no forced gate on the unattended goal), AND
- stdio regression shows no drop vs MAR-109.

**FAIL → triage:**
- Tools not discovered in a client → transport/protocol issue (highest priority; capture exact error, may need an SDK/transport fix).
- Discovered but ignored → tool-description / server-instructions tuning (MAR-99/101 surface).
- Discovered + called but bad output → matcher (MAR-140) or content gap (MAR-145).

Write a retro comment on **MAR-104** with the verdict + per-track findings, then adjust the MVP-A path issues.

---

## Quick reference

| | |
|---|---|
| Endpoint | `http://127.0.0.1:3001/mcp` (or `https://<ngrok>/mcp`) |
| Health | `http://127.0.0.1:3001/health` |
| Start | `pnpm start:http` |
| Always first | `pnpm build` + fresh server (MAR-141) |
| Entry tool | `plan_workflow` |
| Plain-language tool | `explain_component` |
| Strategy context | `docs/STRATEGIC_RETRO_2026-06-16.md` §11 |
