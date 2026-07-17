# OrchestrateKit Project State and UX Review

- **Snapshot date:** 2026-07-16
- **Primary scope:** OrchestrateMCP (MCP), OrchestrateLab (LAB), OrchestrateDASH (DASH)
- **Perspective:** Product and user-experience assessment supported by repository inspection, tests, live MCP dogfooding, LAB browser inspection, GitHub history, and Linear planning context
- **Intended use:** Standalone context for an independent review in Claude or another reasoning system

---

## 1. Executive assessment

The project has built a credible, unusually thoughtful **agent-planning and safety system**, but it has not yet built the complete **goal-to-running-agent product** that the current UX language sometimes implies.

That distinction is the most important fact in this review.

OrchestrateMCP is close to being shippable if the promise is narrow and honest:

> Describe an agent goal, receive a registry-grounded plan, preserve its constraints in a portable build package, and evaluate the implementation against the plan.

The combined MCP + DASH + runtime experience is much farther from shipping if the promise is:

> Describe an agent goal, connect accounts, click the recommended setup, and receive a durable hosted agent with approvals, logs, safe retries, and ongoing maintenance.

The first promise is approximately **85–90% complete**. The second is approximately **35–45% complete** as an end-to-end product, even though many of its individual contracts and concepts exist. LAB is approximately **70% complete as a private owner/operator alpha**. DASH is approximately **15–20% complete as a user-facing product**.

These percentages are judgment calls, not engineering progress counters. They measure how much of the user promise is real, integrated, understandable, and repeatable—not how much code exists.

### Bottom-line status

| Product | Current reality | Strongest asset | Main shipping blocker |
|---|---|---|---|
| MCP | Strong deterministic design advisor and artifact compiler | Safety-aware registry, plan workflow, passports/replay/briefs, strong test discipline | Semantic trust failures in core flows and no execution/hosting bridge |
| LAB | Capable local/private operator cockpit | Evidence capture, contract debt, corpus/registry feedback loop | Cognitive load, contradictory truth, manual setup/import, incomplete run semantics |
| DASH | Contract and architecture foundation | Agent DOM v2 and telemetry contract | No public application, connection broker, approval UI, or runtime integration |

### My recommendation

Ship in two explicit waves:

1. **Wave 0 — Honest agent planning and proof**
   - Promise: “Plan an agent honestly. Build it anywhere. Prove it stayed honest.”
   - Scope: MCP planning, Plan Passport, build brief, replay/evaluation, evidence receipts.
   - Do not imply that OrchestrateKit currently hosts or runs customer agents.

2. **Wave 1 — Goal to running agent**
   - Promise: “State a goal, choose the recommended setup, connect accounts, and get a running agent.”
   - Scope: one real runtime adapter, browser OAuth, durable approvals, visible logs, idempotent side effects, DASH control surface.
   - Do not market this promise until one core flow passes a fully real end-to-end test with no terminal work and no hidden stubs.

---

## 2. How this assessment was produced

The review used the following evidence:

- Local repository inspection of MCP, LAB, DASH, and the DASH Agent DOM branch.
- Current Git state, branch divergence, open pull requests, and recent merged work.
- Full verification runs in each repository.
- Linear issue and project inventory, including priorities, blockers, epics, and product source-of-truth documents.
- A browser inspection of the local LAB application.
- A live `health_check` and `plan_workflow` call against the connected hosted MCP.
- A second execution of the same prompt against the newer local runtime-fit implementation.
- A controlled planner run excluding known false-positive components.
- Current official Google Gmail and Calendar API documentation for permission and notification behavior.

### Evidence confidence labels

This document uses three implicit evidence levels:

- **Observed:** directly seen in code, tests, tool output, Git, Linear, or the running UI.
- **Inferred:** a conclusion that follows from multiple observations but is not itself a stored project fact.
- **Recommended:** a product or engineering decision proposed in this review.

### Important limitations

- This was not a production security audit.
- No real Gmail or Calendar writes were performed.
- LAB is intentionally private and local-only; it was evaluated as an owner/operator tool, not as a public SaaS product.
- Readiness estimates reflect user outcomes, not story points or percentage of issues closed.

---

## 3. Product model: what each surface should own

The cleanest product model already appears in the project’s strongest strategy documents:

```text
User goal
   ↓
MCP: plan, safety contract, runtime fit, build package
   ↓
Runtime adapter: execute, persist, wait, retry, recover
   ↓
DASH: connect, approve, observe, inspect, control
   ↓
LAB: privately evaluate evidence, detect drift, improve contracts
   ↓
Registry proposal / replay / canary / approved rollout
   ↓
MCP becomes more relevant and trustworthy
```

### MCP should own

- Natural-language goal intake.
- Constraint detection and confirmation.
- Registry-grounded route recommendation.
- Safety policy and automation clearance.
- Runtime-fit recommendation.
- Portable build artifacts and Plan Passport.
- Validation and replay contracts.
- Honest disclosure of what it can and cannot install or execute.

MCP should **not** pretend to run durable agents. The MCP server is stateless and is a design-time advisor.

### DASH should own

- User-facing connection setup.
- Runtime selection and installation handoff.
- Approval inbox.
- Live run timeline and event inspection.
- Agent status, pause, resume, retry, revoke, and retire controls.
- Plan-versus-actual comparison.
- Human-readable health and evidence receipts.

DASH should not be described as the runtime. It is the control and interaction surface around a real runtime.

### LAB should own

- Private evidence ingestion.
- Evaluation of completed runs.
- Contract debt and failure clustering.
- Registry improvement proposals.
- Replay/canary evidence before promotion.
- Steward/owner workflow and sensitive operational context.

LAB should remain local/private unless its privacy model is deliberately changed. Its current repository instructions explicitly preserve loopback/local operation.

### Runtime adapters should own

- Durable execution.
- Secrets access.
- Persistent state.
- Scheduling or event triggers.
- Waiting for approvals.
- Retries and idempotency.
- Compensation and recovery.
- Emitting standard Agent DOM events to DASH/LAB.

The current project has contracts for much of this boundary, but not one fully productized adapter that completes the user journey.

---

## 4. State of OrchestrateMCP

### 4.1 What exists and works

MCP is the most mature part of the system.

Observed capabilities include:

- `plan_workflow` as a deterministic, registry-grounded primary entry point.
- Validated playbook selection and composed candidate routes.
- Per-step model-tier guidance.
- Safety review and automation-clearance calculation.
- Human-approval gate insertion.
- Credential and integration guidance.
- Build brief and artifact compilation.
- Deterministic `agent.manifest.json` generation for DASH.
- Plan Passport and Plan Replay work on the current upstream line.
- MCP Resources and Claude Skill distribution.
- Session feedback formatting for LAB evidence ingestion.
- Registry linting, release trust checks, and broad test coverage.

The active local branch passed its full verification pipeline:

- 54 test files.
- 1,622 tests.
- Registry lint green.
- Release trust checks green.
- 64 components.
- 151 edges.
- 13 routes.
- 14 playbooks.
- 4 workers.

The registry has zero untested edges according to its current validation model.

### 4.2 Hosted state versus local/upstream state

The connected hosted MCP reported:

- Version `0.1.0`.
- 64 components.
- 151 edges.
- 12 routes.
- 12 playbooks.
- 4 workers.
- Build fingerprint `41ea718f8c49232a`.
- Built at `2026-07-14T21:39:30Z`.
- `safe_to_demo: true`.

The hosted build is therefore behind the current local/README counts. It does not include the newest runtime-fit experience.

The active local MCP branch at review time was `adversarial-batch-safety-fixes`, with local HEAD `945c788`. It was 36 commits behind and three commits ahead of `origin/master` (`d629514`) from common base `af18dfc`. The three local commits contained the adversarial safety findings and runtime-fit wizard work. Upstream had meanwhile merged PRs for MCP Resources, Plan Passport, Plan Replay, Claude distribution, and recording preparation. PR #109's validation record reported 59 test files and 1,653 tests, compared with 54 files and 1,622 tests on the active local branch—another concrete sign that the two launch lines have diverged.

This creates a release risk: the best safety/runtime-fit work and the newest upstream product work are not yet integrated on a single clean branch.

### 4.3 Main strengths

#### Deterministic provenance

The product’s strongest differentiator is that recommendations can be traced to registry components, edges, routes, and playbooks. It does not need an LLM to invent the architecture. This is a credible foundation for user trust.

#### Safety-first contracts

Approval gates, risk levels, failure modes, permissions, evals, and automation clearance are treated as first-class plan outputs. This is substantially better than a generic “agent builder” that produces code without an operational contract.

#### Artifact portability

The build brief, manifest, Plan Passport, and replay direction make it possible to preserve intent across different builders and runtimes. That supports an important product position: OrchestrateKit can own the contract even when another tool writes the implementation.

#### Test and release discipline

The repository has strong deterministic tests, snapshots, registry linting, and release checks. The project has repeatedly dogfooded the first-run experience and converted findings into issues and tests.

### 4.4 Main weaknesses

#### Matcher precision still breaks user trust

The core engine can interpret negative constraints as capability demand. In the email/calendar dogfood prompt, “Never send the email” still produced `optional_email_send`, and “visible run logs” produced `log_monitor`.

This is not cosmetic. A safety product must treat explicit prohibitions as structural exclusions.

#### “Full coverage” is too easy to earn

Coverage is currently dominated by lexical/component matching. It does not reliably validate:

- Cardinality: exactly one event and one draft.
- Quantities: two slots, each 30 minutes.
- Ordering: Gmail draft write only after approval.
- Filters: unread messages only.
- Side-effect type: save a draft versus send a message.
- Atomicity/idempotency requirements.

This makes “Full coverage” sound more certain than the plan deserves.

#### Design-time and runtime language are mixed

The live experience offers build targets, hosting choices, monitoring choices, and connection lists in a way that can feel executable. In reality, the system produces a plan and a build package. The newer runtime-fit work improves this honesty, but the user still reaches a dead end after “prepare runtime and connections.”

#### Registry semantics are not fine-grained enough for the golden flow

The registry has `email_draft`, which generates draft content with no side effect, and `optional_email_send`, which sends. It does not have a distinct provider write such as `gmail_draft_write` or `email_draft_save`.

That missing component makes it impossible to represent the dogfood prompt faithfully.

#### External freshness is weak

Registry lint showed:

- L0–L3: 100%.
- L4: 0%.

All 64 published component YAML files had empty `sources` arrays at review time, even though many had tests and failure modes. Some playbooks have sources, but component-level external provenance and `last_checked` evidence are not established.

The internal learning loop is much stronger than the external freshness loop.

### 4.5 MCP readiness assessment

| Promise | Readiness | Assessment |
|---|---:|---|
| Generate a useful agent plan | 90% | Strong, but matcher precision can still create dangerous contradictions |
| Preserve plan constraints in artifacts | 80–85% | Passport/build brief are strong; split-brain fields and route noise remain |
| Recommend where the agent should run | 65–70% locally, lower hosted | Runtime-fit direction is good but not integrated/deployed everywhere |
| Connect real services | 25–35% | Guidance and scripts exist, but no unified browser-first Connection Center |
| Install/host a running agent | 10–20% | No supported universal runner or one-click adapter |
| Keep a deployed agent relevant | 25–35% | Evidence concepts exist; lifecycle loop is not productized end to end |

---

## 5. State of OrchestrateLab

### 5.1 Current reality

LAB is a private, local-first operator cockpit. It is not meant to be publicly deployed.

Observed repository state:

- Private repository.
- Local branch `main` was eight commits ahead of `origin/master`.
- Multiple stacked open PRs, including the recent plan/Linear UX work.
- Verification passed:
  - Guard checks.
  - Typecheck.
  - Lint.
  - 33 test files.
  - 251 tests.
- Approximately 270 files and 33k lines of code.
- 34 pages and 23 API routes.
- Tauri/local desktop support.

LAB is substantially more than a prototype. It has enough surface area to function as an owner operating system, but it has not yet been consolidated into a simple, trustworthy daily workflow.

### 5.2 Main strengths

#### Strong visual identity

The dark, dense control-room visual language is distinctive. The home page communicates that the system is serious about evidence, health, telemetry, and operational state.

#### Evidence and contract-debt loop

LAB can connect real sessions, ratings, run evidence, contract debt, corpus fixtures, and registry proposals. This is strategically important: it can make MCP better based on observed failures rather than intuition.

#### Local/private boundary

Keeping LAB local is appropriate for sensitive operator context, credentials, raw transcripts, and internal planning. This is a coherent product boundary if preserved consistently.

#### Broad operator capabilities

The application already includes dashboards, agents, runs, knowledge/corpus state, project planning, health, telemetry, and chat surfaces.

### 5.3 Main UX problems observed

#### Cognitive load and hierarchy

LAB often presents many valid facts without making the most important next action obvious. The strongest internal UX evaluation reached the same conclusion: the owner first needs to know:

1. What needs me?
2. What is the current launch objective?
3. What changed?
4. Is the system healthy?
5. What is the next automatable action?

Everything else should be progressively disclosed.

#### Agent creation/import is too technical

The Agents page currently expects the operator to paste raw `agent.manifest.json` into a textarea. That is appropriate as an advanced escape hatch, not as the primary UX.

Imported cards expose raw environment-variable names and a clear-text ingest token. Secrets should be masked, revocable, and managed in a dedicated connection/credential flow.

#### Run semantics can contradict the timeline

In one inspected run:

- `human_approval_gate` was shown as “not run.”
- The event timeline contained `gate_requested` and `gate_resolved`.

The plan-versus-actual calculation only counts `step_completed`, so gate events do not satisfy the planned gate. This causes the product to display two incompatible truths.

The forwarding score also ignored missing planned steps unless they appeared as explicit drift IDs or gate violations. An incomplete run could receive a perfect score.

This is a trust problem, especially for a product whose moat is plan-versus-actual evidence.

#### Gate compliance is too coarsely scoped

The current helper effectively tracks whether any gate has been resolved. It should correlate a specific approval with a specific irreversible action, payload, version, actor, and expiration. One earlier approval must not authorize every later write.

#### Desktop setup has visible rough edges

Observed issues included:

- A selected port displayed as `34103410`.
- Google OAuth redirect assumptions referenced port 3000 while the server ran on 3410.
- An expired/revoked Google token warning.

These details make a local-first product feel fragile even when the underlying server is healthy.

#### No single “create an agent with MCP” front door

The Plan page is visually promising, but it behaves more like a broad project/Conclave planning surface than a focused agent-creation flow. LAB does not yet give the owner one obvious path from goal to agent package to runtime to evidence.

### 5.4 LAB readiness assessment

| Use case | Readiness | Assessment |
|---|---:|---|
| Private owner cockpit | 70% | Useful today for a technical owner willing to tolerate density |
| Evidence review | 70–75% | Strong concepts, but scoring and gate semantics need repair |
| Agent import and management | 45–55% | Functional but too manual and exposes implementation details |
| Daily launch command center | 55–65% | Broad surface exists; hierarchy and truth reconciliation need work |
| Public/customer product | Not intended | Preserve the private/local boundary |

---

## 6. State of OrchestrateDASH

### 6.1 Current reality

DASH is still primarily a contract and architecture repository.

Observed `master` state:

- Exactly aligned with `origin/master`.
- Two commits.
- Eleven files.
- Approximately 1,124 lines of code.
- No application pages or API implementation.
- One test file with two tests.
- README explicitly describes a contract/design phase.

The Agent DOM v2 work exists on a separate clean branch:

- Branch `codex/mar-382-agent-dom-v2`.
- Commit `c665ace` from 2026-07-16.
- Twenty files.
- Approximately 2,366 lines.
- 34 passing tests.
- Contracts, examples, and documentation—but still no application, OAuth broker, connection broker, or runtime.

### 6.2 What is good

The Agent DOM direction is correct. A stable event and manifest model is necessary before building a control surface. The branch appears to have meaningful contract coverage rather than decorative UI code.

The intended DASH role is also becoming clearer:

- Optional public control surface.
- Plan-versus-actual analyzer.
- Connection Center.
- Agent workspace.
- Approval and evidence surfaces.

### 6.3 What is missing

- Public application scaffold.
- Authentication model.
- Connection Center.
- Google OAuth installation flow.
- Durable approval inbox.
- Agent workspace.
- Live event ingestion and run timeline.
- Plan-versus-actual UI.
- Pause/retry/revoke/retire controls.
- Runtime adapter integration.
- One real vertical slice.

### 6.4 Correct build order

The highest-leverage sequence is:

1. Merge Agent DOM v2 — MAR-382.
2. Build the minimal public scaffold — MAR-328.
3. Implement plan-versus-actual analysis — MAR-298.
4. Build Connection Center — MAR-383.
5. Build the agent workspace and run timeline — MAR-384.
6. Complete the Gmail/Calendar vertical slice — MAR-385.

Cost dashboards, generic memory, universal hosting, and broad analytics should follow—not lead—this sequence.

---

## 7. Live UX dogfood: email and calendar assistant

### 7.1 Exact prompt

> Build an email and calendar assistant that reads unread Gmail meeting requests, checks my real Google Calendar, drafts a reply with two available 30-minute slots, and only after I approve creates one Calendar event and one Gmail draft. Never send the email. I will be present for approval and I want visible run logs.

This is an excellent golden-flow prompt because it combines:

- Real private data.
- Read-only operations.
- LLM-generated content.
- Human approval.
- Two external writes.
- An absolute no-send constraint.
- Exactly-once expectations.
- Durable execution.
- Observability.

It tests whether the product can translate a normal user goal into a safe, hosted agent without forcing the user to speak in component IDs.

### 7.2 What the live MCP returned

The connected hosted MCP returned a candidate route:

```text
Log Monitor
→ Email Read
→ Calendar Lookup
→ Schema Validation
→ Email Draft
→ Human Approval Gate
→ Auth Failure Handler
→ Calendar Write
→ Optional Email Send
→ Audit Log
```

It reported:

- Full coverage.
- Approval enforced.
- Risk 19/100.
- Zero blocking issues.
- Zero untested edges.

It asked the user to connect:

- Gmail inbox.
- Optional email sender.
- A log provider such as Datadog/CloudWatch/Sentry/Loki.
- Calendar read and write access.

It described the key safeguard as keeping approval before sending.

No Gmail data was read. No Calendar data was read. No runtime was installed. No approval UI appeared. No run log was created. The experience stopped at a design plan.

### 7.3 What the newer local runtime-fit version returned

The newer local work improved the runtime section materially:

- Recommended a managed background worker/durable workflow.
- Explained that Gmail events or polling, persistent deduplication, and durable approval must outlive a client session.
- Recommended a provider-neutral approval inbox/generated UI.
- Explained offline behavior.
- Explicitly said there is no built-in runner or one-click installer.
- Changed the visible send label to “Email Send (disabled for this goal).”

However:

- `optional_email_send` remained in the route.
- It remained an automation-clearance driver.
- It remained a gate event target.
- It remained present in the underlying manifest/route semantics.
- `log_monitor` still appeared because the prompt contained “logs.”
- The recommended approval inbox does not exist.
- The next action had no executable install action.

The local UX is more honest about hosting but not yet semantically correct or actionable.

### 7.4 Controlled exclusion run

A control run explicitly excluded `optional_email_send` and `log_monitor`.

That produced a cleaner route, but the matcher then added `reviewer_notification` due to generic overlap with “approval,” “approve,” and “send.” The planner correctly marked that component as “in the route but not asked for,” and coverage fell to partial.

This confirms that the engine can improve when false positives are manually excluded, but the burden is currently on a technical operator who knows internal component IDs. That is not acceptable first-run UX.

---

## 8. UX findings from the dogfood run

### 8.1 What worked

- The broad domain was recognized immediately.
- Gmail read, Calendar lookup, draft generation, approval, Calendar write, and audit were present.
- The workflow was correctly classified as attended/L3.
- The newer local version recommended a durable runtime rather than pretending a chat session could watch Gmail in the background.
- The newer local version was honest that the product has no runner or one-click installer.
- Observability event names are directionally good: `run_started`, `step_started`, `step_completed`, `gate_requested`, `gate_resolved`, `run_completed`, and `run_failed`.

### 8.2 Critical failure: “Never send” becomes a send capability

The live plan includes `optional_email_send`, offers send infrastructure, requests send-related permissions, and frames the approval gate around sending.

The local runtime-fit branch only relabels the step as disabled. The underlying route still contains it.

For a safety product, an explicit prohibition must produce all of the following:

- No send component.
- No send credential.
- No send OAuth scope.
- No send tool in the runtime.
- No send event in the manifest.
- No send action in approval UI.
- A test proving that send is impossible, not merely hidden.

### 8.3 Critical failure: no post-approval Gmail draft write

The current `email_draft` component composes text and has no side effect. It runs before the approval gate.

The user asked for a Gmail draft to be created **after** approval. The registry lacks a distinct external-write component for that operation.

The correct component model should separate:

```text
email_reply_preview        # LLM content generation, no provider write
gmail_draft_write          # Gmail provider write after approval
optional_email_send        # not present at all for this goal
```

Until that distinction exists, the planner cannot faithfully model this golden flow.

### 8.4 Critical failure: “visible run logs” becomes log ingestion

The user wants to observe the agent’s own execution. The planner interprets “logs” as an input-monitoring capability and adds Datadog/CloudWatch/Sentry/Loki.

These are different intents:

- “Monitor application logs for errors” → `log_monitor`.
- “Show me this agent’s run logs” → Agent DOM/audit/observability.

The matcher must distinguish object-of-monitoring from product-control language.

### 8.5 Coverage overclaims completeness

The system called the plan “Full coverage” without explicitly representing:

- `is:unread` filtering.
- Meeting-request classification.
- Exactly two suggested slots.
- 30-minute duration.
- Working hours and timezone.
- Exactly one Calendar event.
- Exactly one Gmail draft.
- Gmail draft creation after approval.
- Idempotency across retries.
- Compensation if one of the two writes succeeds and the other fails.

Coverage should validate constraints and effects, not merely nouns and verbs.

### 8.6 Permission guidance is inconsistent

The user-facing `what_you_need` catalog says Gmail draft creation requires both `gmail.compose` and `gmail.send`, and even claims send scope is required for drafts.

The repository’s newer connection contract deliberately excludes `gmail.send` for draft-only flows.

Google’s current `users.drafts.create` documentation allows draft creation with `gmail.compose`, `gmail.modify`, or the full mailbox scope. `gmail.send` is not required:

- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create

This is exactly the kind of split-brain truth that can damage trust. The product must have one credential catalog and derive every UI, build brief, script, and manifest from it.

### 8.7 Calendar notification behavior is a missing decision

Creating a Calendar event with attendees can send invitations. Google Calendar supports `sendUpdates=none`, but suppressing notifications may also mean the other participant never receives confirmation.

The product needs to ask:

> Should the approved action create a private hold on your calendar with no attendee notification, or create a real attendee invitation that Google may notify?

This decision cannot be buried in implementation notes because it changes the user-visible side effect and the meaning of “Never send the email.”

Reference:

- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert

### 8.8 Exactly-once behavior is advisory, not structural

The plan mentions state, retries, and rollback/compensation as build controls. They are not present in the route.

The user explicitly asked for one event and one draft. A real implementation needs:

- Persistent run state.
- Source identity, such as Gmail message/thread ID.
- Approval payload hash/version.
- Deterministic Calendar event ID or stored provider ID.
- Stored Gmail draft ID.
- Idempotency check before both writes.
- A partial-failure state.
- Resume or compensation behavior.
- Visible evidence of what did and did not happen.

### 8.9 Approval is represented but not experienced

`human_approval_gate` is present as a component. The user does not receive a real approval card, inbox, notification, timeout, rejection path, or edited-resubmission path.

An approval gate is only meaningful when it binds:

- Actor.
- Exact payload.
- Payload version/hash.
- Permitted effects.
- Expiration.
- Decision and comment.
- Downstream action IDs.

### 8.10 The journey ends before activation

The live product recommends generating a build prompt. The local product recommends preparing a runtime. Neither provides:

- “Connect Gmail.”
- “Connect Calendar.”
- “Install recommended runtime.”
- “Create test agent.”
- “Review permissions.”
- “Run safely.”
- “Open approval.”
- “View logs.”

This is the gap between a good advisor and a complete product.

### 8.11 UX scorecard for this prompt

| Dimension | Live hosted | Newer local | Ship target |
|---|---:|---:|---:|
| Intent recognition | 6/10 | 7/10 | 9/10 |
| Constraint fidelity | 2/10 | 4/10 | 10/10 |
| Safety trust | 3/10 | 5/10 | 10/10 |
| Runtime recommendation | 3/10 | 7/10 | 9/10 |
| Connection UX | 1/10 | 2/10 | 9/10 |
| Approval UX | 1/10 | 2/10 | 9/10 |
| Observability UX | 2/10 | 4/10 | 9/10 |
| End-to-end completion | 0/10 | 0/10 | 9/10 |

These scores are product judgments, not test measurements.

---

## 9. What an excellent user experience should look like

### 9.1 Step 1: reflect the understood goal

The product should convert the prompt into a short, editable contract:

> **Email & Calendar Assistant**
>
> - Watches unread Gmail messages for meeting requests.
> - Checks the selected Google Calendar.
> - Suggests exactly two available 30-minute slots.
> - Prepares a reply preview.
> - Waits for your approval.
> - After approval, creates one Calendar event and saves one Gmail draft.
> - Email sending is unavailable.
> - Every run is visible in the run timeline.

The card should explicitly mark each statement as understood, assumed, or needing a decision.

### 9.2 Step 2: ask only the decisions that materially affect safety

Recommended questions:

1. **Availability policy**
   - Which timezone, working hours, days, and search horizon should define a valid slot?

2. **Calendar side effect**
   - Private hold with no attendee notification, or an attendee invitation?

3. **Trigger and hosting**
   - Recommended: continuously watch Gmail in a managed durable runtime.
   - Alternative: run manually while the client is open.

The product should propose defaults but require explicit confirmation for the Calendar notification choice.

### 9.3 Step 3: show the recommended architecture in user language

```text
Gmail watch/poll
→ unread filter
→ meeting-intent classifier
→ persistent dedupe/state
→ Google Calendar free/busy
→ two-slot policy
→ reply preview
→ approval inbox
→ Calendar event write + Gmail draft write
→ audit timeline
```

Do not show `optional_email_send`, SendGrid, or email-send permissions anywhere.

### 9.4 Step 4: connect services with least privilege

The Connection Center should show two cards:

#### Gmail

- Read messages required.
- Create drafts required.
- Send email not requested.
- Explain why each permission is needed.
- Provide browser OAuth.
- Show account identity after connection.
- Provide revoke/reconnect.

#### Google Calendar

- Read availability required.
- Create event required.
- Clearly show whether attendee notifications are enabled.
- Provide browser OAuth.
- Let the user select the target calendar.

No raw client IDs, refresh tokens, `.env` variables, or terminal commands should appear in the core-user flow.

### 9.5 Step 5: install the runtime

The product should recommend exactly one supported runtime adapter for the golden flow.

The user should see:

- What runs in the background.
- What happens when their computer is off.
- Where state and secrets live.
- Expected cost/limits at a simple level.
- How to pause or delete the agent.
- A single “Install agent” or “Create test agent” action.

Advanced alternatives can be available behind “Other deployment options.”

### 9.6 Step 6: run a safe connection test

Before activation:

- Confirm Gmail can search unread messages.
- Confirm Calendar free/busy can be read.
- Confirm a test draft can be created and immediately deleted, or use a supported dry-run if the user approves that test.
- Confirm a test Calendar event can be created with notifications suppressed and removed, or use a provider sandbox/dry-run.
- Confirm DASH receives run events.
- Confirm email sending is not available to the runtime.

### 9.7 Step 7: show a meaningful approval card

The approval card should include:

- Sender and subject.
- Relevant message excerpt.
- Meeting intent and confidence.
- Two candidate slots in the user’s timezone.
- Selected slot.
- Calendar name.
- Event title, attendees, timezone, and notification behavior.
- Full Gmail draft subject/body/recipients.
- Explicit effects:

```text
On approval
✓ Create one Calendar event
✓ Save one Gmail draft
✗ Send email — unavailable
```

Actions:

- Approve.
- Edit.
- Reject.
- Snooze.
- View full source context.

### 9.8 Step 8: show the run timeline

An ideal run timeline:

```text
09:00:01  Run started from Gmail event
09:00:02  Unread message loaded
09:00:02  Meeting request detected
09:00:03  Calendar availability checked
09:00:03  Two 30-minute slots selected
09:00:04  Reply preview generated
09:00:04  Waiting for Henri's approval
09:03:18  Approved by Henri
09:03:19  Calendar event created: event_id=...
09:03:19  Gmail draft saved: draft_id=...
09:03:20  Run completed
```

The user should be able to expand each row for inputs, outputs, duration, evidence, and redacted provider response.

### 9.9 Step 9: handle partial failure honestly

If Calendar succeeds and Gmail fails, the UI must not say “completed.” It should say:

> Partial completion: Calendar event was created; Gmail draft was not saved. No email was sent.

Then offer:

- Retry Gmail draft creation with the same idempotency key.
- Roll back the Calendar event if safe.
- Keep the event and resolve manually.

### 9.10 Step 10: keep the agent relevant

After activation, the user should see:

- Last successful run.
- Last approval.
- Connection health.
- Permission changes.
- Plan-versus-actual drift.
- Evaluation trend.
- Runtime version.
- Recommended update with evidence.
- Rollback option.

---

## 10. How users should create an agent

The agent-creation experience should be a progressive contract, not a code generator wizard.

### Phase A: Goal

The user describes the outcome in normal language.

### Phase B: Understanding

MCP reflects:

- Inputs.
- Decisions.
- Outputs.
- Allowed reads.
- Allowed writes.
- Forbidden actions.
- Approval points.
- Trigger.
- Monitoring expectation.

### Phase C: Resolve material ambiguity

Ask only questions that change safety, cost, or runtime fit. Do not ask implementation trivia that can be deferred.

### Phase D: Plan contract

Generate a Plan Passport containing:

- Goal and constraints.
- Route/components.
- Runtime class.
- Connections and least-privilege permissions.
- Approval policy.
- Observability policy.
- Evals and acceptance criteria.
- Assumptions and unresolved choices.

### Phase E: Build target

The user chooses:

- Orchestrate-supported runtime adapter.
- External coding agent.
- Portable prompt/package.
- Advanced self-hosted path.

The supported adapter should be recommended when it can satisfy the goal. “Generate a build prompt” should remain an escape hatch, not the only path.

### Phase F: Connect and test

Use browser OAuth and automated probes. Explain permissions in product language.

### Phase G: Activate

Show a final permission/effect review, then activate the runtime.

### Phase H: Observe and improve

Every run is compared against the plan. Proposed changes go through replay/canary evidence and human approval.

---

## 11. How users should “host” an agent

The word “host” hides several separate responsibilities:

- What wakes the agent?
- Where does code execute?
- Where are secrets stored?
- Where is state persisted?
- Can it wait for approval?
- Does it continue when the user’s computer is off?
- Where are logs and costs visible?
- Who owns retries and incident recovery?

The product should translate those responsibilities into a simple recommendation.

### Recommended runtime classes

#### Client/chat runtime

Use when:

- User explicitly starts every run.
- No background trigger is required.
- No durable wait is required.

#### Managed scheduled job

Use when:

- Work runs on a timer.
- Each run is bounded.
- Durable state/retries are required.

#### Managed durable background workflow

Use when:

- Events or polling trigger work continuously.
- The workflow must wait hours or days for approval.
- The user may be offline.
- Exactly-once state matters.

#### Self-hosted runtime

Use when:

- Privacy/infrastructure control requires it.
- The user accepts responsibility for uptime, updates, secrets, backups, and recovery.

### Product rule

MCP should recommend a runtime class. A supported adapter should turn that class into an installable choice. DASH should control it. The runtime should execute it. LAB should evaluate it.

Do not use DASH itself as a synonym for hosting.

---

## 12. How to keep an agent relevant

The project has the ingredients for a compelling relevance moat, but they are not yet connected into a lifecycle.

### Required lifecycle

```text
Plan Passport
→ Versioned agent manifest
→ Standard run events
→ DASH plan-versus-actual analysis
→ LAB evidence and evaluation
→ Contract-debt clustering
→ Registry/manifest change proposal
→ Replay against historical cases
→ Canary run
→ Human approval
→ Gradual rollout
→ Rollback or retirement
```

### Relevance signals

The system should monitor:

- Provider API changes.
- OAuth scope/permission changes.
- Model or prompt version changes.
- Runtime failures and latency.
- User edits to generated output.
- Approval/rejection reasons.
- False positives and missed cases.
- Drift between planned and executed components.
- Duplicate or partial side effects.
- Cost changes.
- Stale source documentation.

### Current strength: inward learning

The current loop from session feedback to contract debt, corpus fixtures, CI, and registry proposals is strong.

### Current weakness: outward freshness

The system lacks a complete mechanism for:

- Curated external source monitoring.
- Component-level provenance and `last_checked` dates.
- Provider change detection.
- Automatic gap briefs.
- Safe deployment of updated contracts/agents.

### Recommended new epic: Agent Lifecycle

Create a single epic that owns:

- Versioned Plan Passport and manifest binding.
- Runtime version identity.
- Replay/canary contracts.
- Evidence thresholds for promotion.
- Human-approved rollout.
- Rollback.
- Retirement and credential revocation.

Without this epic, “keeping agents relevant” will remain distributed across LAB, DASH, MCP, and runtime work without one shippable outcome.

---

## 13. Strategic roadmap state

Linear contained approximately 227 issues at review time:

- 159 Done.
- 51 Backlog.
- 3 In Progress.
- 1 Todo.
- 13 Canceled.

There were 55 active issues excluding Done/Canceled, including 32 Urgent or High priority items.

This shows high execution volume, but the remaining backlog still mixes launch-critical work with broad platform expansion.

### Important issue sequence

#### Goal to running agent

- MAR-377 — Goal → recommended runtime → running agent epic.
- MAR-378 — Runtime-fit wizard.
- MAR-379 — Runtime adapter decision and Email/Calendar proof.
- MAR-380 — Runtime work implied by the dependency chain.
- MAR-381 — Recommended-click end-to-end coverage across three runtime shapes.
- MAR-376 — Core-user Email/Calendar flow.

#### DASH

- MAR-294 — DASH epic.
- MAR-382 — Agent DOM v2.
- MAR-328 — Public scaffold.
- MAR-298 — Plan-versus-actual differentiator.
- MAR-383 — Connection Center.
- MAR-384 — Agent workspace.
- MAR-385 — Gmail vertical slice.

#### LAB and relevance

- MAR-305 — LAB OS epic.
- MAR-358 — Self-LAB.
- MAR-361 — Operator/approval inbox flywheel.
- MAR-221 — LAB RAG/private knowledge.
- MAR-129 — LAB steward agent.
- MAR-216 — External freshness briefing ingestion.

### Strategy drift to resolve

An earlier product plan correctly prioritized the public MCP product and private LAB brain while pausing broad DASH/LAB OS expansion. More recent issues reactivate a wide DASH/browser/connection/memory scope.

The team should explicitly declare two lanes:

- **Launch lane:** only work needed to ship the chosen Wave 0 or Wave 1 promise.
- **Moat lane:** evidence, lifecycle, LAB, and broader DASH capabilities that cannot interrupt the launch critical path.

Without this separation, the project can keep producing valuable components while the user still cannot complete one golden journey.

---

## 14. Prioritized work

### P0 — Restore semantic trust

These tasks should be completed before using the email/calendar flow as a public demonstration.

#### P0.1 Integrate the current branches

- Rebase/port MAR-378 runtime-fit work onto current `origin/master`.
- Resolve conflicts with MCP Resources, Passport, Replay, Claude distribution, and recording work.
- Verify from a clean clone/worktree.
- Deploy one traceable build.
- Make hosted health counts/fingerprint match release documentation.

**Acceptance criteria:** one branch contains all launch work; CI and local verify pass; hosted fingerprint is recorded in the release note.

#### P0.2 Treat no-send as a structural prohibition

- Remove `optional_email_send` from route composition when absolute no-send/draft-only intent is present.
- Remove it from automation clearance, manifests, events, credentials, build briefs, and UI.
- Add adversarial tests covering normal phrasing, not component terminology.

**Acceptance criteria:** the exact dogfood prompt contains no send component, scope, credential, tool, event, or action anywhere.

#### P0.3 Add a Gmail draft-write component

- Separate content generation from provider write.
- Add `gmail_draft_write` or provider-neutral `email_draft_save`.
- Place it after approval for this goal.
- Define permissions, side effects, failure modes, idempotency, evals, and edges.

**Acceptance criteria:** plan order is preview → approval → Calendar write + Gmail draft write; email sending remains impossible.

#### P0.4 Fix visible-run-log intent

- Distinguish run observability from log-source monitoring.
- Prevent `log_monitor` from matching “show run logs,” “visible logs,” or “run history.”
- Route those phrases to the observability contract/audit timeline.

**Acceptance criteria:** the exact prompt does not request Datadog/CloudWatch/Sentry/Loki.

#### P0.5 Strengthen coverage semantics

Coverage should validate:

- Quantities.
- Durations.
- Filters.
- Ordering constraints.
- Forbidden effects.
- Required writes.
- Exactly-once language.

**Acceptance criteria:** the current uncorrected route cannot report full coverage; the corrected route can explain how each constraint is represented.

#### P0.6 Unify permission truth

- Use one credential/scope catalog.
- Remove contradictory `gmail.send` guidance for draft-only creation.
- Generate UI, connection scripts, build briefs, and manifests from the same source.
- Add tests comparing all rendered permission surfaces.

**Acceptance criteria:** no product surface requests send permission in the dogfood flow.

#### P0.7 Repair demo-health truth

The current `safe_to_demo` logic checks component and edge floors but not route/playbook counts or expected fingerprint. LAB’s hosted/local “match” display similarly compares only core counts.

- Extend health criteria to expected routes, playbooks, and release fingerprint.
- Make LAB compare every displayed count.
- Show “compatible,” “matching,” or “different” precisely.

**Acceptance criteria:** an older hosted build cannot be labeled safe/current merely because component and edge counts match.

#### P0.8 Repair LAB evidence truth

- Count gate events as execution of the planned gate.
- Correlate each approval with its exact downstream action.
- Penalize missing planned steps.
- Prevent incomplete runs from receiving a perfect forwarding score.
- Mask and revoke ingest tokens.

**Acceptance criteria:** timeline, plan-versus-actual, and score cannot contradict one another on the inspected fixture.

---

### P1 — Complete one real activation path

#### P1.1 Choose one supported runtime adapter — MAR-379

Do not design a universal runtime abstraction first. Select one runtime capable of:

- Gmail event/poll trigger.
- Persistent state.
- Durable wait for approval.
- Browser OAuth integration.
- Idempotent retries.
- Event emission.
- Pause/resume/cancel.
- Reasonable local development.

Document why it was selected and what it does not support.

#### P1.2 Build the real Email/Calendar vertical slice

The slice must use:

- Real Gmail OAuth and unread search.
- Real Google Calendar free/busy.
- Real two-slot calculation.
- Real approval UI.
- Real Calendar event creation.
- Real Gmail draft creation.
- No email-send capability.
- Real DASH run events.
- Persistent provider IDs and idempotency.

No Slack stub, CRM stub, terminal-only secret setup, manual GitHub Actions dispatch, or template fallback should be counted as completing this slice.

#### P1.3 Build browser-first connections

- Connect Gmail.
- Connect Google Calendar.
- Explain permissions.
- Select target account/calendar.
- Probe connection.
- Reconnect/revoke.
- Hide implementation secrets.

#### P1.4 Build durable approval

- Approval inbox.
- Payload preview.
- Edit/reject/snooze.
- Actor and payload version binding.
- Expiration.
- Notification.
- Action-specific gate resolution.

#### P1.5 Prove three runtime shapes — MAR-381

Run end-to-end tests for:

1. Interactive client/chat.
2. Managed scheduled job.
3. Managed durable background workflow.

Each recommendation must lead to an achievable next action, not merely a description.

---

### P2 — Build the minimum useful DASH

Sequence:

1. Merge Agent DOM v2.
2. Public/authenticated scaffold.
3. Event ingestion.
4. Plan-versus-actual analyzer.
5. Connection Center.
6. Agent workspace.
7. Approval inbox.
8. Gmail/Calendar golden slice.

The first useful DASH does not need generic memory, cost optimization, a marketplace, or universal hosting.

---

### P3 — Productize the relevance loop

- Create the Agent Lifecycle epic.
- Add external source provenance to published components.
- Implement MAR-216 external briefing ingestion.
- Connect LAB proposals to replay/canary evidence.
- Define promotion thresholds.
- Add approved rollout and rollback.
- Show version and evidence in DASH.

---

## 15. Work to pause or strictly time-box

Until the golden activation flow ships, pause or time-box:

- More general Conclave capabilities.
- News/Sites/voice expansion.
- DASH cost dashboards.
- Generic RAG/memory products.
- Vault expansion unrelated to the golden path.
- Universal runtime abstraction.
- More unevidenced playbooks.
- Broad connection marketplace work.
- Public LAB deployment.

These may be strategically valuable later. They are not the current bottleneck.

---

## 16. Release definitions

### Wave 0: honest planning product

Wave 0 is ready when:

- Hosted counts and release fingerprint match documentation.
- Exact no-send constraints cannot leak send components or scopes.
- Plan summaries do not contradict structured route data.
- Plan Passport and replay work from a clean release.
- Build briefs preserve every confirmed constraint.
- Unsupported runtime actions are clearly labeled unavailable.
- A first-time user can reach a useful portable artifact in under two minutes.
- At least five adversarial golden prompts pass semantic review.
- Public copy consistently says “design advisor,” not “agent host.”

### Wave 1: running-agent product

Wave 1 is ready when a non-developer can:

1. Paste the exact email/calendar prompt.
2. Understand the reflected contract.
3. Answer the two critical clarification questions.
4. Connect Gmail in the browser.
5. Connect Calendar in the browser.
6. Review least-privilege permissions.
7. Install the recommended durable runtime.
8. Start a real test run.
9. Receive a real approval request.
10. Approve the exact payload.
11. See exactly one Calendar event and one Gmail draft.
12. Verify no email was sent.
13. See a complete run timeline.
14. Retry without duplicates.
15. Pause, revoke, and remove the agent.

No terminal, `.env`, raw JSON manifest, manual GitHub secret, or hidden stub should be required.

---

## 17. Metrics that should govern shipping

### Activation

- Goal-to-understood-contract time.
- Contract confirmation rate.
- OAuth completion rate.
- Runtime installation completion rate.
- First successful safe run rate.
- Median time from goal to first approved action.

### Trust and safety

- Explicit constraint preservation rate.
- Forbidden-capability leakage rate.
- Over-broad permission rate.
- Approval/action correlation failures.
- Duplicate side-effect rate.
- Partial failure transparency rate.
- Plan-versus-actual accuracy.

### Usability

- Clarification-question abandonment.
- Number of technical terms shown before activation.
- Number of terminal/manual steps.
- Time to find a failed step.
- Time to revoke a connection.
- User comprehension of what runs when offline.

### Relevance

- Acceptance rate of proposed agent updates.
- Replay regression rate.
- Time from provider change to updated contract.
- Percentage of published components with current external sources.
- Rollback success rate.
- Drift detected before user-reported failure.

---

## 18. Suggested execution sequence

### Days 0–7: truth and semantic correctness

- Integrate runtime-fit work with current master.
- Fix no-send, log-intent, Gmail draft-write, and permission truth.
- Improve coverage semantics.
- Fix hosted health/fingerprint truth.
- Repair LAB gate and score calculations.

### Days 8–21: one real runtime proof

- Complete MAR-379 runtime decision.
- Implement browser OAuth.
- Implement durable state and approval.
- Execute the real Gmail/Calendar vertical slice.
- Capture all Agent DOM events.

### Days 22–45: minimum DASH

- Merge Agent DOM.
- Scaffold app/auth.
- Build Connection Center.
- Build approval inbox and run timeline.
- Implement plan-versus-actual.

### Days 46–60: hardening and relevance

- Three-shape E2E tests.
- Failure, retry, duplicate, revoke, and rollback drills.
- LAB evidence ingestion.
- Replay/canary loop.
- External source freshness.

The sequence matters more than the calendar estimate. If the real runtime proof takes longer, reduce surface area rather than declaring the flow complete with stubs.

---

## 19. Risk register

| Risk | Severity | Why it matters | Mitigation |
|---|---|---|---|
| Safety language contradicts actual route | Critical | Destroys the core trust proposition | Structural constraint tests and forbidden-capability elimination |
| Planner implies execution that does not exist | High | Users reach a dead end after committing intent | Explicit Wave 0 promise and one supported adapter |
| Branch/release divergence | High | Best work is not present in one deployable build | Integrate, clean-clone verify, fingerprint releases |
| DASH scope expansion | High | UI breadth can outrun the golden flow | Build only Connection → Approval → Run → Evidence first |
| LAB contradictory truth | High | Evidence product cannot display incompatible facts | One event interpretation model and scoring contract |
| Over-broad OAuth scopes | High | Violates least privilege and user intent | Single credential catalog and scope snapshot tests |
| Stubs counted as end-to-end proof | High | Creates false confidence before launch | Define “real” acceptance criteria and evidence receipts |
| External freshness at L4 = 0 | Medium/High | Registry advice can become stale while tests still pass | Source provenance, review dates, provider-change ingestion |
| Private/public boundary drift | Medium | Sensitive LAB state could leak or architecture could duplicate | Keep LAB local; make DASH the deliberate public surface |
| Universal runtime abstraction too early | Medium | Delays proof of value | Productize one adapter before generalizing |

---

## 20. Final product judgment

The project is not missing vision. It has more product architecture, safety thinking, and evidence infrastructure than many agent products that are already public.

The problem is that the system’s strongest internal concepts have not yet been compressed into one obvious user outcome.

Today, a user can receive a thoughtful plan. They cannot yet reliably:

- Trust every reflected constraint.
- Connect the required services through a simple interface.
- Install the recommended runtime.
- Approve a real action.
- Observe a real run.
- Know that retries will not duplicate effects.
- See the agent remain aligned over time.

The most important move is therefore not to add another broad capability. It is to make one narrow, valuable, high-trust agent journey completely real.

The email/calendar prompt is the right journey. It exercises the entire product thesis:

- Plain-language intent.
- Safe planning.
- Runtime fit.
- Least-privilege connections.
- Durable human approval.
- Multiple external effects.
- Visible evidence.
- Plan-versus-actual evaluation.
- Ongoing relevance.

If OrchestrateKit can make that flow excellent—with no send capability, no terminal setup, no hidden stubs, and honest recovery—it will have a compelling foundation for everything else.

---

## 21. Evidence index

### MCP repository

- Repository: `C:\Users\henri\Desktop\projekt\MCP\orchestratekit-mcp`
- Primary planner: `src/tools/planWorkflow.ts`
- Constraint signals: `src/lib/constraintSignals.ts`
- Capability matcher: `src/graph/capabilityMatcher.ts`
- Observability contract: `src/lib/observabilityContract.ts`
- Connection contract: `src/lib/connectContract.ts`
- Build brief compiler: `src/tools/exportBuildBrief.ts`
- Runtime-fit tests: `tests/tools/placementWizard.test.ts`
- Runtime-fit manual transcript: `docs/MANUAL_TRANSCRIPT_MAR378.md`
- Email/calendar playbook: `registry/playbooks/email_calendar_assistant.playbook.yaml`
- Email/calendar route: `registry/routes/email_calendar_route_v1.route.yaml`
- Email draft component: `registry/components/email_draft.component.yaml`
- Calendar write component: `registry/components/calendar_write.component.yaml`
- State/dedupe components: `registry/components/state_store.component.yaml`, `registry/components/deduplication.component.yaml`

### LAB repository

- Repository: `C:\Users\henri\Desktop\projekt\MCP\orchestratelab`
- Agent import page: `app/agents/page.tsx`
- Agent event interpretation: `lib/agentEvents.ts`
- Cockpit health truth: `lib/cockpitTruth.ts`
- Private/local policy: repository `AGENTS.md`

### DASH repositories/worktrees

- Main: `C:\Users\henri\Desktop\projekt\MCP\orchestratedash`
- Agent DOM branch worktree: `C:\Users\henri\Desktop\projekt\MCP\orchestratedash-mar382-agent-dom`

### Recent MCP pull requests

- PR #109 — MAR-363 recording control sheet: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/109
- PR #107 — Claude Skill distribution: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/107
- PR #106 — Plan Replay: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/106
- PR #104 — Plan Passport: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/104
- PR #103 — MCP Resources: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/103
- PR #102 — First-run activation: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/102
- PR #90 — 90-second golden flow: https://github.com/orchestratemcp/OrchestrateKIT-MCP/pull/90

### Key Linear issues

- MAR-376 — Core-user Email/Calendar flow.
- MAR-377 — Goal → recommended runtime → running agent epic.
- MAR-378 — Runtime-fit wizard.
- MAR-379 — Runtime adapter decision and Email/Calendar proof.
- MAR-381 — Three runtime-shape end-to-end proof.
- MAR-382 — Agent DOM v2.
- MAR-328 — DASH scaffold.
- MAR-298 — Plan-versus-actual.
- MAR-383 — Connection Center.
- MAR-384 — Agent workspace.
- MAR-385 — Gmail vertical slice.
- MAR-358 — Self-LAB.
- MAR-361 — Operator/approval inbox flywheel.
- MAR-216 — External freshness briefing ingestion.

### External technical references

- Gmail `users.drafts.create`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- Google Calendar `events.insert`: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert

---

## 22. Suggested prompt for Claude

Copy the following prompt with this document:

> Read the attached OrchestrateKit project-state and UX review as an independent product and engineering reviewer. Do not merely agree with it. Identify factual contradictions, weak inferences, missing evidence, and recommendations that are sequenced incorrectly. Then provide:
>
> 1. Your independent state assessment for MCP, LAB, and DASH.
> 2. The five most important disagreements or refinements.
> 3. A strict definition of the smallest shippable product promise.
> 4. A prioritized P0/P1 roadmap with dependencies and acceptance criteria.
> 5. A critique of the email/calendar golden-flow UX.
> 6. A recommendation for how creation, hosting, approvals, observability, and ongoing relevance should fit together.
> 7. Anything the review underestimates or overestimates.
>
> Distinguish observed facts from your inferences. Optimize for user trust and completion, not breadth of features or amount of code.
