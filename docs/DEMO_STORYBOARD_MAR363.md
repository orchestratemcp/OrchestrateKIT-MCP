# MAR-363 Recording Control Sheet

Final demo case: **Email & Calendar Assistant**.

Record one continuous raw take that proves the full path:

```text
Goal -> validated plan -> Plan Passport/build brief -> build -> connect Google + OpenRouter
-> deploy to Vercel -> send a real meeting request -> review two available slots
-> approve -> Google Calendar event + Gmail draft -> structured audit proof
```

This is an action script for Henrik's screen recording. It is not a spoken
presentation script. Capture the real flow, speed up waits in the edit, and add
captions or narration afterward.

## Current Recording Baseline

Use a fresh connector/session before the take. The recording is allowed to use
new work that landed after the failed attempt:

| Area | Recording implication |
|---|---|
| MAR-375 provider fix | `export_build_brief` must ask for an LLM provider when model-backed steps are present. Select `openrouter`; no Anthropic default is acceptable. |
| MAR-375 route fix | The route for the exact Email & Calendar goal must be `email_read -> calendar_lookup -> schema_validation -> intent_classifier -> email_draft -> state_store -> human_approval_gate -> auth_failure_handler -> calendar_write -> audit_log`. |
| MAR-103 MCP resources | If useful, briefly show playbooks as MCP resources instead of browsing local files. Do not let this slow the take. |
| MAR-342 Plan Passport | Show the Plan Passport/build contract as the deterministic handoff from plan to build. |
| MAR-343 replay verifier | If the client exposes it, use replay verification as audit support after the run. Do not configure it live if it is not ready. |
| MAR-138 Claude Skill | Claude is now a valid distribution path, but use whichever client is cleanest for the take. |
| MAR-251 matcher fix | Monitor/approve/handoff language should no longer bleed into unrelated route components; if it does, stop and reconnect. |

Fresh hosted-worker evidence after MAR-375:

```text
build_sha: 41ea718f8c49232a
built_at: 2026-07-14T21:39:30.987Z
safe_to_demo: true
```

The final recording should be made against that build or a newer build on
master. The latest known master merge commit before this prep was:

```text
17b1ceae7b9c68359d78e629e3878ad017747e55
```

## Failed-Take Lessons To Actively Guard

The previous recording attempt was useful but not acceptable. These are hard
stop conditions:

- **Anthropic appears without being chosen:** stop. The brief must ask for a
  provider, and the recording path must choose OpenRouter explicitly.
- **Google OAuth URL is corrupted on Windows:** stop. Re-run the connector, open
  the generated URL through the browser exactly as emitted, and verify the
  redirect URI is an intact `http://127.0.0.1:<port>/oauth/callback` loopback.
- **Web OAuth client is selected:** stop. Use a Google **Desktop app** OAuth
  client for the loopback connector.
- **Connector looks stale:** stop. Restart/reconnect the OrchestrateMCP server
  and confirm the route/provider behavior again.
- **Old email-lead/Slack/HubSpot storyboard appears:** stop. The take is only
  the Email & Calendar Assistant.
- **Credentials, access codes, tokens or secrets become visible:** stop, revoke
  the exposed value, discard the raw take, and restart.
- **LAB is broken:** keep going if the deployed product and Vercel audit logs
  are healthy. LAB telemetry is optional and non-blocking for MAR-363.

## Exact Goal To Paste

```text
Build an email and calendar assistant that reads unread Gmail meeting requests,
checks my real Google Calendar, drafts a reply with two available 30-minute
slots, and only after I approve creates one Calendar event and one Gmail draft.
Never send the email. I will be present for approval and I want visible run logs.
```

When asked for deployment/provider constraints, paste:

```text
Use a Vercel hosted endpoint, OpenRouter, real Gmail + Google Calendar OAuth,
draft-only email, explicit human approval, and structured Vercel audit logs.
LAB telemetry is optional and must not block the product.
```

When exporting/building, include this constraint:

```text
Include safe connection and deploy steps. Read local credential values without
printing them, send Vercel environment values through stdin or masked prompts,
create APP_ACCESS_TOKEN and APPROVAL_SECRET in memory, mark secrets sensitive,
and print names/statuses only. Add a focused dry-run or test for this path.
```

## Go/No-Go Preflight

Complete this before opening OBS:

- [ ] Original dirty checkout is untouched.
- [ ] Recording workspace is fresh, with no `.env`, no `.vercel`, and no old app
      artifacts unless clearly labelled as rehearsal evidence.
- [ ] OrchestrateMCP connector was restarted after the latest build.
- [ ] `health_check` or equivalent shows a build on or after
      `2026-07-14T21:39:30.987Z`.
- [ ] `plan_workflow` on the exact goal selects `email_calendar_assistant`.
- [ ] Route includes the ordered gate before `calendar_write`.
- [ ] Route does **not** include `fan_out_collector`, `reviewer_notification`,
      Slack, HubSpot, CRM, or `optional_email_send` as a sent-email step.
- [ ] `export_build_brief` without `llm_provider` returns structured
      `needs_input` with kind `llm_provider`.
- [ ] Provider options include `openrouter`.
- [ ] OpenRouter export contains `OPENROUTER_API_KEY` and no Anthropic env vars
      or setup text.
- [ ] Local generated handler fails closed when secrets are absent.
- [ ] Existing `examples/email-calendar-agent` syntax checks pass if used as
      reference evidence.
- [ ] Google, Gmail, Calendar, OpenRouter, GitHub and Vercel are already signed
      in before recording.
- [ ] Browser notifications, email previews and password-manager popups are off.
- [ ] OBS has a full-screen scene and a credential shield scene/hotkey tested.
- [ ] A second mailbox or phone is ready to send the fresh meeting request.
- [ ] Old rehearsal emails are read or archived; old Calendar events/drafts are
      deleted or outside the recording window.

## Credential Safety

Creating keys live is part of the story. Showing values is not.

1. Create or verify an OBS scene named `CREDENTIAL SHIELD`.
2. Turn the shield on before any secret, access code, client secret, refresh
   token or API key can appear.
3. Paste secrets only into masked prompts. Do not open `.env`, print environment
   variables, paste credentials into chat, or show Vercel secret values.
4. Keep the raw recording private until secret frames are reviewed and blurred.
5. Use disposable recording credentials.
6. After the take, revoke the recording OpenRouter key, retire the recording
   Google OAuth client, revoke the refresh token, and rotate demo access tokens.

Passwords, account recovery, billing and 2FA are not part of the demo. Sign in
before recording.

## Recording Format

- Raw take target: 10-20 minutes.
- Edited target: 3-4 minutes.
- Keep cursor movement deliberate.
- Pause two seconds on each proof screen.
- Do not splice artifacts from another run unless the edit labels them as
  earlier evidence.
- If a build or deploy waits, keep the raw wait and accelerate it in the edit.
- If OpenRouter is unavailable and deterministic fallback handles the step,
  label that honestly in the audit/proof shot.

## Scene Script

### 0. Fresh Session Proof

Show a new client session with OrchestrateMCP connected. Confirm the worker build
is fresh enough for MAR-375 behavior. This can be a short opening shot.

Proof to hold:

- build date or health output;
- no stale connector warning;
- clean recording folder.

### 1. Goal -> Validated Plan

Paste the exact goal and submit once. Let the client call `plan_workflow` without
steering it with component IDs.

Proof to hold:

- playbook `email_calendar_assistant`;
- full coverage / validated route;
- approval enforced;
- route includes `human_approval_gate` before `calendar_write`;
- no Slack/HubSpot/CRM/email-lead route.

Caption:

```text
One goal. A validated, approval-gated route.
```

### 2. Provider Choice -> Build Brief

When the tool asks for a provider, choose OpenRouter. Export the build brief for
the chosen coding client.

Proof to hold:

- `needs_input.kind = llm_provider` appeared before selection, if visible;
- OpenRouter selected explicitly;
- Plan Passport/build contract present;
- Google/Gmail/Calendar scopes listed;
- Vercel host choice listed;
- approval and audit requirements listed.

Caption:

```text
The build brief includes provider, connection, deployment and safety gates.
```

### 3. Build In A Fresh Folder

Give the exported build prompt to the coding client. Keep recording while it
writes files and tests. Speed up this scene later.

Proof to hold:

- app/API/UI files;
- `agent.manifest.json`;
- connection script or equivalent setup helper;
- focused tests;
- green verification summary.

Stop the take if tests are red. A fixed-on-camera build is not the final take.

### 4. Create Google Credentials Live

Run the generated connector from the generated app folder. Use a Google Desktop
OAuth client only.

Proof to hold:

- Gmail API and Calendar API scopes:
  `gmail.readonly`, `gmail.compose`, `calendar.readonly`, `calendar.events`;
- intact loopback redirect URL;
- green Gmail and Calendar probes;
- Calendar write scope proven, not just Calendar read.

Keep `CREDENTIAL SHIELD` on for client secret and OAuth code frames.

### 5. Create OpenRouter Key Live

Create a disposable OpenRouter key named for the recording date. Paste it into
the masked connector prompt.

Proof to hold:

- OpenRouter live probe passes;
- no Anthropic credential prompt or env var is shown;
- complete connector check is green.

### 6. Link And Deploy To Vercel

Link a fresh Vercel project from the generated app folder, sync environment
values safely, and deploy production.

Proof to hold:

- env sync prints variable names/statuses only;
- production deployment URL;
- health strip shows Google, OpenRouter and approval configured;
- LAB optional state does not block readiness.

Keep `CREDENTIAL SHIELD` on when entering the app access code.

### 7. Send A Fresh Meeting Request

From the second mailbox or phone, send this message to the connected Gmail
account:

```text
Subject: 30 minute meeting next week?

Hi! Could we schedule a 30 minute meeting next week? Please suggest two times
that work in your calendar.
```

Return immediately to the deployed app.

### 8. Scan And Review Before Any Write

Click `Scan Gmail` once. Do not reload or click repeatedly.

Proof to hold:

- correct sender and subject;
- original email visible;
- exactly two conflict-free slots;
- event title and timezone;
- full Gmail draft recipient, subject and body;
- clear state that nothing has been written yet.

Caption:

```text
The agent pauses before both external writes.
```

### 9. Human Approval -> Real Artifacts

Select one slot and click approve exactly once. Wait for success.

Proof to hold:

- Calendar event with selected start/end, attendee and approval/source note;
- Gmail draft with matching recipient, subject and body;
- Gmail draft remains unsent.

Caption:

```text
One Calendar event. One Gmail draft. No email sent.
```

### 10. Structured Audit Proof

Open Vercel runtime logs for the run ID.

Required audit sequence:

```text
gate_requested
gate_resolved
calendar_write completed
optional_email_send completed (draft-only)
run_completed
```

If LAB is already configured, optionally show the same run in `/agents`. Do not
configure or debug LAB during the take.

Closing frame:

```text
Planned. Built. Connected. Deployed. Approved. Audited.
```

## Timing Sheet

Fill this during rehearsal and final edit:

| Segment | Target/evidence | Final timestamp |
|---|---|---|
| Goal submitted | exact Email & Calendar goal | |
| Plan validated | `email_calendar_assistant` route | |
| Provider selected | OpenRouter, no Anthropic default | |
| Plan Passport/build brief | deterministic contract visible | |
| Build finished | green local verification | |
| Google connected | Gmail + Calendar probes green | |
| OpenRouter connected | live probe green | |
| Vercel deployed | production URL ready | |
| Fresh email sent | subject visible | |
| Scan completed | two slots before write | |
| Approval clicked | one human approval | |
| Calendar written | event ID/link visible | |
| Gmail draft written | draft ID/state visible | |
| Audit shown | ordered write events visible | |

Accepted hosted rehearsal evidence from 2026-07-14:

| Item | Evidence |
|---|---|
| Production URL | `https://orchestratekit-email-calendar-assis.vercel.app` |
| Run ID | `1a137629-cf7a-4205-9228-424497a13aaa` |
| Approval ID | `ce0e0f97-1165-4f77-8d24-b51a506e49eb` |
| Calendar event | `okitc85be9bf3dbc38500eca1cc06bcf8d9d` |
| Gmail draft | `r-7868842765165270678` |
| Write phase | about 1.5 seconds after approval |
| CI then | 55 test files / 1628 tests passed |

Measured rehearsal timings:

| Action | Expected raw time |
|---|---:|
| Email read | about 0.5 seconds |
| Intent classification | about 11.5 seconds, or deterministic fallback if OpenRouter is unavailable |
| Calendar lookup | about 0.3 seconds |
| Draft generation | about 0.1 seconds with fallback, up to OpenRouter timeout otherwise |
| Human approval wait | operator-dependent; rehearsal was about 36.8 seconds |
| Calendar write | about 0.9 seconds |
| Gmail draft creation | about 0.7 seconds |
| Approval-to-complete write phase | about 1.5 seconds |

## Failure Policy During The Take

- Login/2FA appears: stop, pre-authenticate, restart.
- Secret becomes visible: stop, revoke it, delete the raw take, restart.
- Wrong provider appears: stop and rerun export with OpenRouter selected.
- Wrong Google scope/client type appears: stop and create a Desktop client.
- OAuth URL is malformed: stop and rerun the connector; do not edit the URL by
  hand on camera.
- No meeting request found: confirm the fresh message is unread, then restart
  the scan scene. Do not tune Gmail queries on camera.
- Approval token expires: run a fresh scan. Do not bypass or extend the gate.
- Vercel queue is slow: keep raw wait and speed it up later.
- Calendar succeeds but Gmail draft fails: stop. Do not present partial success.
- LAB fails: continue only if Vercel audit logs prove the structured run.

## Post-Roll Before Publishing

- [ ] Verify every credential frame is covered in the edited export.
- [ ] Revoke the recording OpenRouter key.
- [ ] Retire the recording Google OAuth client.
- [ ] Revoke the recording refresh token.
- [ ] Rotate app access and approval secrets.
- [ ] Restore stable production credentials if the demo remains hosted.
- [ ] Confirm Calendar event and Gmail draft IDs belong to the recorded run.
- [ ] Fill the timing sheet above.
- [ ] Attach the final video, timings and run IDs to MAR-363.

## Definition Of Done For MAR-363 Recording

- Fresh provider credentials were created live but never exposed.
- The app was built and deployed from the recorded project.
- A real meeting-request email triggered the run.
- The review card showed two real free slots before any write.
- A human approved once.
- The recorded run produced one Calendar event and one Gmail draft.
- No email was sent.
- Structured audit evidence shows the gate before both writes.
- The final edit labels accelerated waits and deterministic fallback honestly.
