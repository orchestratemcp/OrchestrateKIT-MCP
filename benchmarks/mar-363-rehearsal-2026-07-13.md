# MAR-363 Off-Camera Rehearsal — 2026-07-13

Full Plan → Build → Connect → Deploy → Monitor rehearsal ahead of the recorded
demo. Everything below ran for real on this machine unless marked otherwise.

## Timings (measured)

| Phase | What ran | Result |
|---|---|---:|
| Plan | `plan_workflow` on the hosted worker (validated playbook, full coverage, 5-option hosting menu) | < 1 s server-side (speedrun: 0.26 s) |
| Brief | `export_build_brief` on the hosted worker — now includes `connect` + §11 | ~2 s round trip (speedrun: 0.48 s server-side) |
| Connect (pre-flight) | `node scripts/connect.mjs --check` — 8 creds, live Google token exchange + Gmail profile probe | ~4 s |
| Connect (paste flow) | real refresh token piped through paste → probe → written to `.env` | ~3 s + paste time |
| Run (live Gmail) | agent read **10 real unread inbox messages** via Gmail REST, classified all correctly | 2.4 s in-agent / 4.7 s wall |
| Run (full lead path) | fixtures: 2 leads → approval → Slack/CRM/draft (local stubs) | 99 ms in-agent / 1.6 s wall |
| Run (with LAB monitoring) | fixtures + `DASH_INGEST_URL` → **36/36 events accepted** by LAB `/api/events` | 7.1 s in-agent wall |
| Secrets | `gh secret set` + `delete` (dummy value) | ~2 s per secret |
| Hosted MCP deploy | `pnpm deploy:worker` (Cloudflare) | ~21 s |
| Hosted Actions run | not re-dispatched today (Henrik-only); 2026-07-12 speedrun timed it | see prior benchmark |

## What the rehearsal proved

- **Connect** (MAR-364, shipped today): credential manifest + `scripts/connect.mjs`
  emitted by `export_build_brief`, live-probed with Henrik's real Google OAuth
  creds — probe returned `000henrik@gmail.com`. Invalid keys are rejected by a
  real API 401 and never written. `--check` gives an exit-code demo pre-flight.
- **Hosting choice**: `plan_workflow` now offers local / cron / GitHub Action /
  hosted endpoint / Cowork in `host_monitor_choices` — the speedrun's
  "no hosting choice" gap is closed.
- **Monitoring**: `email-lead-crm-slack-agent` manifest imported into LAB
  (real ingest token minted); a full agent run POSTed 36 events, all accepted,
  correct `gate_requested`/`gate_resolved` pairs before each irreversible step.
- **Deploy prep**: workflow now passes all credential secrets through env
  (unset ⇒ fixture/dry-run fallback), so going live is `connect.mjs --secrets`
  + a dispatch — no on-camera file edit.

## Bugs found and fixed during rehearsal (would have burned the take)

1. `dash.ts` emitted the wrong event shape (`event` instead of `type`, missing
   `event_version`/`agent`) — LAB rejected **every** event 400, silently.
   `/agents` would have stayed empty on camera. Fixed to telemetry contract v1
   + loud warn on non-2xx.
2. `connect.mjs` exited 0 when piped stdin ran out mid-flow — failure now
   fails closed (exit 1).
3. `--secrets` skipped non-secret vars (`GMAIL_CLIENT_ID`), which the Actions
   workflow needs — now pushes all connected values.
4. Hosted worker was serving yesterday's build (deploys are manual
   `pnpm deploy:worker`, not git-push) — redeployed; `built_at` now 2026-07-13,
   `connect` field confirmed live.
