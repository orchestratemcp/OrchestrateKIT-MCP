# Email & Calendar Assistant

A real, approval-gated implementation of the published OrchestrateKit playbook
`email_calendar_assistant` (`email_calendar_route_v1`). It is intentionally a
small Vercel app: a private review UI plus one serverless function, using only
the platform and Node 20 APIs.

## Core product flow

1. Read recent meeting-request candidates from Gmail.
2. Use OpenRouter to select a genuine scheduling request.
3. Read Google Calendar free/busy and compute two weekday slots.
4. Use OpenRouter to draft a reply offering exactly those slots.
5. Show the original email, full reply, recipient, event title, timezone and both slots.
6. Stop at a signed, 15-minute human approval gate.
7. After approval, create one idempotent Calendar event and one Gmail draft. Never send email.
8. Emit structured audit events to Vercel logs. LAB ingest is optional and non-fatal.

The signed approval token prevents browser-side edits to the recipient, draft,
event title, source message or candidate slots. The selected slot must be one
of the two values inside that signed proposal.

## Required environment variables

| Variable | Purpose |
|---|---|
| `GMAIL_CLIENT_ID` | Google Desktop OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Google OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | Refresh token with `gmail.readonly`, `gmail.compose`, `calendar.readonly`, `calendar.events` |
| `OPENROUTER_API_KEY` | LLM access for classification and drafting |
| `APP_ACCESS_TOKEN` | Private access code required by both write endpoints |
| `APPROVAL_SECRET` | Random secret used to sign immutable approval proposals |

Optional: `OPENROUTER_MODEL` (defaults to `openrouter/free`), `DEMO_TIMEZONE`
(defaults to `Europe/Stockholm`), `GMAIL_QUERY`, `PUBLIC_APP_URL`, and the
`DASH_INGEST_URL`/`DASH_INGEST_TOKEN` pair.

Generate the Google/OpenRouter portion through `export_build_brief` with
`llm_provider: "openrouter"`, write its `connect_script` to
`scripts/connect.mjs`, then run it locally. The live probe verifies both Gmail
and Google Calendar. Do not paste credentials into chat, Git, or Linear.

The free OpenRouter router is suitable for this low-volume rehearsal, but its
underlying model is deliberately variable. For a recorded or scored run, set
`OPENROUTER_MODEL` to one pinned model after a successful preflight.

## Vercel preview

Run Vercel from this directory so the example remains an isolated project:

```bash
vercel link
vercel env add GMAIL_CLIENT_ID preview
vercel env add GMAIL_CLIENT_SECRET preview
vercel env add GMAIL_REFRESH_TOKEN preview
vercel env add OPENROUTER_API_KEY preview
vercel env add APP_ACCESS_TOKEN preview
vercel env add APPROVAL_SECRET preview
vercel deploy
```

Validate a preview with one fresh meeting-request email before promoting it.
The app is complete when the Calendar event and Gmail draft exist. LAB is a
separate optional observability proof, never a runtime dependency.
