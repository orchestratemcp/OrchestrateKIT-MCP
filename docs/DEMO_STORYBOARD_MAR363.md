# MAR-363 — Action storyboard: Goal → running product

Final demo case: **Email & Calendar Assistant**.

The recording should prove the complete path with real connections:

> Goal → validated plan → build → create credentials → connect → deploy → send
> a real meeting request → review two free slots → approve → Calendar event +
> Gmail draft → audit proof.

This is an **action script**, not a spoken presentation. Record the screen and
add narration/captions afterward.

## Recording format

- Capture one continuous raw take. Speed up build, consent propagation and
  deployment in the edit instead of pretending they were instantaneous.
- Target raw duration: **10–20 minutes**, depending on the build.
- Target edited duration: **3–4 minutes**.
- Keep cursor movement deliberate. Pause for two seconds on every proof screen.
- Never cut from one run to artifacts created by another run unless the edit
  explicitly labels it as earlier evidence.

## Credential safety — mandatory

Creating keys live is part of the story. Showing their values is not.

1. Add an OBS scene or overlay named **CREDENTIAL SHIELD** before recording.
   It must cover provider key/client-secret values and the browser access-code
   field while leaving buttons and success states visible.
2. Turn the shield on **before** clicking any button that reveals a secret.
3. Paste secrets only into masked terminal prompts. Never open `.env`, never
   print environment values, and never paste credentials into the AI chat.
4. Keep the raw recording private until all secret areas have been checked and
   blurred frame-by-frame.
5. Use disposable recording credentials. Revoke the OpenRouter key and retire
   the recording OAuth client after the take; then restore the stable demo
   credentials if the hosted demo should remain online.

Passwords, 2FA, account recovery and billing are **not** part of the demo.
Accounts may be signed in before recording. The provider credentials themselves
are still created live.

## Pre-roll — off camera

### Accounts and machine

- [ ] Google Cloud, Gmail, Calendar, OpenRouter, GitHub and Vercel are already signed in.
- [ ] `gh auth status` and `vercel whoami` pass.
- [ ] Desktop notifications, email previews and password-manager popups are disabled.
- [ ] Browser zoom and terminal font are readable at the recording resolution.
- [ ] Bookmarks and unrelated tabs are hidden.
- [ ] OBS has `FULL SCREEN` and `CREDENTIAL SHIELD` scenes/hotkeys tested.

### Google preparation

- [ ] Gmail API and Google Calendar API are enabled in the demo Cloud project.
- [ ] OAuth consent screen and test user are already configured.
- [ ] No recording-specific Desktop OAuth client exists yet; create it on camera.
- [ ] Connected Gmail account has the intended calendar and timezone.
- [ ] Old rehearsal requests are marked read so the new message is unambiguous.
- [ ] Old rehearsal event/draft are removed or clearly outside the recording window.

### Build/deploy preparation

- [ ] Start from a clean demo folder with no `.env` and no `.vercel` link.
- [ ] MCP endpoint is connected and healthy.
- [ ] The selected coding client can write files and run terminal commands.
- [ ] The build output must include `agent.manifest.json`, `scripts/connect.mjs`,
      tests, a Vercel app, and a safe env-sync/deploy command that prints names
      and statuses only—not values.
- [ ] Prepare a second mailbox or phone to send the meeting request during the take.

If any pre-roll item fails, fix it before recording. Do not debug account setup
or credential leakage on camera.

---

## Scene 1 — Enter the goal

**Screen:** Codex, Claude Code or Cursor with OrchestrateKit connected.

**Actions:**

1. Open a new, empty task.
2. Paste this goal exactly:

   ```text
   Build an email and calendar assistant that reads unread Gmail meeting
   requests, checks my real Google Calendar, drafts a reply with two available
   30-minute slots, and only after I approve creates one Calendar event and one
   Gmail draft. Never send the email. I will be present for approval and I want
   visible run logs.
   ```

3. Submit once.
4. Let the client call `plan_workflow`; do not steer it with component names.
5. Hold for two seconds on the result showing:
   - validated playbook `email_calendar_assistant`;
   - full coverage;
   - approval enforced;
   - zero untested edges;
   - route from Gmail read through audit log.

**Edit later:** lower-third: `One goal. A validated, approval-gated route.`

## Scene 2 — Choose the product shape

**Actions:**

1. Choose the user-facing continuation for building/exporting the product.
2. When asked for runtime/provider choices, enter:

   ```text
   Use a Vercel hosted endpoint, OpenRouter, real Gmail + Google Calendar OAuth,
   draft-only email, explicit human approval, and structured Vercel audit logs.
   LAB telemetry is optional and must not block the product.
   ```

3. Export the full build brief for the selected coding client.
4. Add this recording constraint to the build handoff:

   ```text
   Include a safe Vercel env-sync/deploy command. It must read the connected
   local values without printing them, create the app-access and approval
   secrets in memory, pipe values to Vercel through stdin, mark them sensitive,
   and print names/statuses only. Add a dry-run or focused test for this path.
   ```

5. Pause on the brief sections that show:
   - route and safety gate;
   - required connections/scopes;
   - Vercel host choice;
   - `scripts/connect.mjs` and `agent.manifest.json` artifacts.

**Edit later:** lower-third: `The plan includes connection and deployment work.`

## Scene 3 — Build in a fresh folder

**Actions:**

1. Give the exported build prompt to the coding client.
2. Let it create the application in the clean folder.
3. Keep recording while it writes and tests; do not jump to a prebuilt folder.
4. When it finishes, run the generated verification command.
5. Show the file tree briefly:
   - approval-gated API/UI;
   - `scripts/connect.mjs`;
   - safe Vercel env/deploy helper;
   - `agent.manifest.json`;
   - focused tests.
6. Stop if tests are red. A fixed-on-camera build is not the final take.

**Edit later:** speed this scene up 8–20×. Keep the final green test summary at
normal speed for two seconds.

## Scene 4 — Create Google credentials live

**Screen:** terminal left, browser right.

**Actions:**

1. Run from the generated project:

   ```powershell
   node scripts/connect.mjs
   ```

2. At the Google client prompt, open the exact Google Cloud credential page.
3. Click **Create credentials → OAuth client ID → Desktop app**.
4. Name it `OrchestrateKit recording — YYYY-MM-DD`.
5. Turn **CREDENTIAL SHIELD ON**.
6. Click **Create**; copy the client ID and client secret into the corresponding
   masked connector prompts.
7. Close the credential dialog. Turn **CREDENTIAL SHIELD OFF**.
8. Let `connect.mjs` open Google's OAuth consent page.
9. Show and approve only these scopes:
   - `gmail.readonly`;
   - `gmail.compose`;
   - `calendar.readonly`;
   - `calendar.events`.
10. Return to the terminal and pause on the green Gmail + Calendar live probes.

Do not use a Web OAuth client. The generated loopback callback requires a
Desktop client.

## Scene 5 — Create the OpenRouter key live

**Actions:**

1. Let `connect.mjs` open OpenRouter's key page.
2. Click **Create key** and name it `okit-mar363-recording-YYYYMMDD`.
3. Turn **CREDENTIAL SHIELD ON before the value appears**.
4. Copy the key into the masked connector prompt.
5. Close the key modal and turn **CREDENTIAL SHIELD OFF**.
6. Pause on the successful OpenRouter live probe.
7. Run the complete preflight:

   ```powershell
   node scripts/connect.mjs --check
   ```

8. Hold on the all-green summary. It must explicitly prove Calendar write
   scope, not merely Calendar read access.

## Scene 6 — Link and deploy to Vercel

**Actions:**

1. Link/create a fresh isolated Vercel project from the generated app folder:

   ```powershell
   vercel link
   ```

2. Run the generated safe env-sync command. It must:
   - transfer Google/OpenRouter values from local `.env` through stdin;
   - create random `APP_ACCESS_TOKEN` and `APPROVAL_SECRET` values in memory;
   - mark secrets sensitive;
   - print variable names and target environments only.
3. Never use `cat`, `Get-Content` output, shell echo, or a dashboard bulk-paste
   that exposes values on screen.
4. Deploy production:

   ```powershell
   vercel deploy --prod --yes
   ```

5. Open the resulting production URL.
6. Show the health strip: Google ✓, OpenRouter ✓, Approval gate ✓.
7. Turn **CREDENTIAL SHIELD ON**, paste the generated demo access code into the
   password field, then turn the shield off.

**Edit later:** speed up the Vercel build; return to normal speed at `READY` and
the production URL.

## Scene 7 — Send a real meeting request

**Actions:**

1. From the second mailbox/phone, compose a new message to the connected Gmail account.
2. Use this subject:

   ```text
   30 minute meeting next week?
   ```

3. Use this body:

   ```text
   Hi! Could we schedule a 30 minute meeting next week? Please suggest two
   times that work in your calendar.
   ```

4. Send it on camera.
5. Return immediately to the deployed app.

## Scene 8 — Scan and review before any write

**Actions:**

1. Click **Scan Gmail** once.
2. Wait for the review card; do not reload or click repeatedly.
3. Expand the original email briefly.
4. Show:
   - correct sender and subject;
   - exactly two conflict-free slots;
   - event title/timezone;
   - full Gmail draft recipient, subject and body;
   - the statement `Nothing has been written yet`.
5. Select one slot.
6. Pause for two seconds with **Approve selected slot** visible.

**Edit later:** lower-third: `The agent pauses before both external writes.`

## Scene 9 — Human approval and real artifacts

**Actions:**

1. Click **Approve selected slot** exactly once.
2. Wait for the success state. Do not navigate away while it is working.
3. Open the reported Calendar event and show:
   - selected start/end;
   - attendee;
   - source/approval note.
4. Open Gmail **Drafts** and show:
   - matching recipient;
   - matching subject/body;
   - draft state.
5. Do **not** click Send.

**Edit later:** lower-third: `One Calendar event. One Gmail draft. No email sent.`

## Scene 10 — Audit proof and closing frame

**Actions:**

1. Open the Vercel runtime logs for the completed run.
2. Filter to the run ID if needed.
3. Show the ordered events:

   ```text
   gate_requested
   gate_resolved
   calendar_write completed
   optional_email_send completed (draft-only)
   run_completed
   ```

4. If LAB telemetry is already configured, show the same run in `/agents` as
   a short optional closing shot. Do not configure or repair LAB during this take.
5. End on a three-panel proof frame: plan summary, Calendar event, Gmail draft.

**Edit later:** final caption:

```text
Planned. Built. Connected. Deployed. Approved. Audited.
```

---

## Expected timing from the accepted hosted rehearsal

| Action | Expected raw time |
|---|---:|
| Plan + build brief | under 1 minute |
| Coding build | variable; retain raw, accelerate in edit |
| Google client + OAuth | 1–3 minutes |
| OpenRouter key + preflight | 30–90 seconds |
| Vercel link/env/deploy | 1–2 minutes |
| Gmail read | under 1 second |
| Classification | up to 12 seconds before deterministic fallback |
| Calendar lookup | under 1 second |
| Draft generation | up to 12 seconds before deterministic fallback |
| Approved Calendar + Gmail writes | about 1.5 seconds |

The accepted production run on 2026-07-14 completed the approved Calendar and
Gmail writes in about 1.5 seconds after the human click.

## Failure policy for the take

- **Login/2FA appears:** stop the take; pre-authenticate and restart.
- **Secret becomes visible:** stop, revoke it, delete the raw take and restart.
- **Wrong Google scope/client type:** do not continue; create a Desktop client
  and rerun connect.
- **OpenRouter is slow/unavailable:** deterministic fallback is acceptable and
  should be labelled honestly in the audit shot.
- **No meeting request found:** confirm the fresh message is unread, then restart
  the scan scene. Do not edit Gmail queries on camera.
- **Approval token expires:** run a fresh scan. Never bypass or extend the gate.
- **Vercel queue is slow:** keep the raw wait and speed it up later. Do not splice
  in an unrelated deployment without a label.
- **Calendar succeeds but Gmail fails:** stop. Do not present partial completion
  as success; investigate and repeat with new disposable artifacts.

## Post-roll — before publishing

- [ ] Verify every credential frame is covered in the edited export.
- [ ] Revoke the recording OpenRouter key.
- [ ] Retire the recording Google OAuth client and revoke its refresh token.
- [ ] Rotate the demo access and approval secrets.
- [ ] Restore stable production credentials if the demo remains hosted.
- [ ] Verify the Calendar event and Gmail draft IDs belong to the recorded run.
- [ ] Delete only the disposable rehearsal artifacts after evidence is retained.
- [ ] Add captions/narration without changing what the screen actually proves.
- [ ] Attach the final video/timings to MAR-363.

## Definition of done for the recording

- Fresh provider credentials were created live but never exposed.
- The app was built and deployed from the recorded project.
- A real email triggered the run.
- The review card showed two real free slots before any write.
- A human approved once.
- The recorded run produced one Calendar event and one Gmail draft.
- No email was sent.
- Audit evidence shows the gate before both writes.
- The final edit labels accelerated waits and any deterministic fallback honestly.
