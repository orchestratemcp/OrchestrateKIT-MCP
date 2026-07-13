# MAR-363 — Full-flow demo storyboard + rough cut

One take, no fixing-things-on-camera: **Goal → Plan (+hosting choice) → Build →
Connect → Deploy → real service activity → run visible in LAB /agents.**

> **HOLD:** do NOT record the final take until **MAR-340** and the **Wave 0 PR
> stack** (incl. orchestratelab PR #20 cockpit) are merged. Everything below is
> rehearsed and timed (off-camera rehearsal 2026-07-13,
> `benchmarks/mar-363-rehearsal-2026-07-13.md`).
>
> **CREDENTIAL RULE: no secret is ever visible on camera.** connect.mjs masks
> pasted input with `*`; the Gmail token is minted by the OAuth loopback (never
> typed); never `cat .env`, never open repo → Settings → Secrets values. The
> only credential-shaped thing on screen is `✅ … — 000henrik@gmail.com`.

## Screen layout

Left ⅔: terminal (Claude Code session + a plain shell tab). Right ⅓ stacked:
browser (Slack channel + HubSpot contact + LAB `/agents`). Phone in hand for
scene 6 (sending the lead email is more credible off-screen-keyboard).

## Pre-roll (off camera, morning of)

- [ ] Keys minted: `ANTHROPIC_API_KEY`, Slack webhook, HubSpot private-app token (Gmail creds already proven)
- [ ] `node examples/email-lead-agent/scripts/connect.mjs --check` → all green (exit 0)
- [ ] LAB running; `email-lead-crm-slack-agent` manifest imported (already done — token minted 2026-07-13)
- [ ] `DASH_INGEST_URL` + `DASH_INGEST_TOKEN` in the agent `.env`
- [ ] Fresh runtime dir (`EMAIL_LEAD_AGENT_RUNTIME_DIR` unset, `runtime/` cleared)
- [ ] Lead email pre-written in the second account's drafts (subject with *pricing*, *demo*, *seats*)
- [ ] `gh auth status` OK; hosted worker current (`pnpm deploy:worker` if MCP changed)
- [ ] Kill notifications/quiet the desktop; hide bookmarks bar

---

## Scene 1 — Goal (~15 s)

Say the goal, type it once:

> *"Build an agent that reads new leads from Gmail, drafts a reply, updates the
> CRM, and alerts sales in Slack after approval."*

Claude Code calls `plan_workflow` on the hosted MCP. **Beat:** goal in one
sentence, no config, no YAML.

## Scene 2 — Plan + hosting choice (~40 s)

Product card renders in **<1 s** (wire-measured 58 ms server-side). Point at:
- ✅ Validated playbook `email_lead_to_crm`, full coverage, risk 27/100
- the A–D menu, and **`host_monitor_choices`: local / cron / GitHub Action /
  hosted endpoint / Cowork** — say why GitHub Action (hosted, shareable logs,
  secrets in one place)
- pick **C** → `export_build_brief` (~2 s round trip). **Beat:** the brief
  ships §11 Connect + `scripts/connect.mjs` + `agent.manifest.json` — "the plan
  knows what it needs connected and how it will be monitored."

## Scene 3 — Build (jump-cut, ~30 s on screen)

The brief's build prompt goes to Claude Code; **time-lapse/jump-cut** to the
built repo (the speedrun measured ~12 min goal→hosted; don't watch paint dry).
Land on the file tree: `src/steps/*` mirroring the 9 route components,
`scripts/connect.mjs`, `agent.manifest.json`, tests green.

## Scene 4 — Connect (~2–3 min, the MAR-364 act)

```
node examples/email-lead-agent/scripts/connect.mjs
```

Rough-cut transcript (real rehearsal output, values masked by the script itself):

```
connect — email-lead-crm-slack-agent
guided connect: 8 credential(s) in manifest

› GMAIL_CLIENT_ID (Google OAuth client ID)
  ✅ existing value valid — not probed (validated with GMAIL_REFRESH_TOKEN)
› GMAIL_REFRESH_TOKEN (Gmail OAuth refresh token)
  opening Google consent screen (loopback on port 51023, 3 min timeout)…
  ✅ connected — 000henrik@gmail.com (written to .env)
› ANTHROPIC_API_KEY (Anthropic API key)
  mint: https://console.anthropic.com/settings/keys
  paste ANTHROPIC_API_KEY (starts with sk-ant-): ************
  ✅ connected — HTTP 200 (written to .env)
› SLACK_WEBHOOK_URL (Slack incoming webhook URL)
  ✅ connected — HTTP 400 (webhook live, empty payload rejected — no message posted)
...
──────────────────────────────
5/5 required credential(s) connected (+3 optional)
```

**Beats:** browser tabs open themselves at the exact key page; every paste is
live-probed (a wrong key gets a real 401 on camera-safe display); the Gmail
token has **zero copy-paste** — Google consent → "you can close this tab".
Finish with the pre-flight: `--check` → green summary, exit 0.

## Scene 5 — Deploy (~1 min)

```
node examples/email-lead-agent/scripts/connect.mjs --check --secrets --yes
gh workflow run "email-lead-agent (demo)" && gh run watch
```

**Beats:** secrets pushed via `gh secret set` (names scroll by, never values);
the Actions run goes green on GitHub's infra; artifacts uploaded. Workflow
passes all creds through env since MAR-364 — no file edit on camera.

## Scene 6 — Real service activity (~90 s)

1. Send the prepared lead email from the phone (on camera).
2. `npx tsx examples/email-lead-agent/src/run.ts` — live Gmail read
   (rehearsed: 10 real messages in 2.4 s), classifier routes the lead, Claude
   drafts the reply, **the approval gate pauses — type `y` on camera** (the
   one human moment, by design — say so: "L3 clearance, the plan enforced this
   gate").
3. Right panel, in order: **Slack message pops** in the sales channel →
   **HubSpot contact + note appear** → outbound draft queued (draft-only by
   policy — say it: "v1 never sends mail on its own").

## Scene 7 — Run lands in LAB /agents (~30 s)

Switch to LAB `/agents` → the run is there with plan-vs-actual and green
`gate_requested → gate_resolved` pairs before each irreversible step
(rehearsed: 36/36 events accepted). **Closing beat:** "planned, built,
connected, deployed, monitored — one goal sentence to a governed, observable
agent."

---

## Measured timings (rehearsal 2026-07-13)

| Beat | Time |
|---|---:|
| plan_workflow (hosted, wire) | 58 ms |
| export_build_brief (hosted, wire) | 243 ms |
| connect `--check` (8 creds, live probes) | ~4 s |
| Live Gmail read + classify (10 real messages) | 2.4 s |
| Full lead path (approval → Slack/CRM/draft) | 99 ms in-agent |
| Run incl. LAB event ingest (36 events) | 7.1 s |
| `gh secret set` | ~2 s/secret |
| Actions hosted run | ~2–3 min (2026-07-12 speedrun) |

Estimated final cut: **~6–7 min** raw single take → **60–90 s** edited GIF/cut
for MAR-355 Wave 0.

## Known risks for the take

- Real inbox may contain surprise unread mail — scene 6 shows them classified
  as `not_a_lead`; that's a feature, narrate it, don't fear it.
- Google consent screen occasionally asks for re-login — stay signed in that
  morning.
- LAB dev server must be started fresh (HMR keeps stale closures — restart
  before the take).
- If Actions queue is slow, scene 5 cuts to the completed run page recorded
  minutes earlier (label it honestly in the edit).
