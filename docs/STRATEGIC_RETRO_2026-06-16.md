# OrchestrateKit — Strategic Retro & State of Project

**Date:** 2026-06-16
**Author:** Opus (strategic session for Henrik)
**Status of code at the time of the retro:** the registry and test suite had reached the then-current public floor, with stdio + HTTP transports and local commits still ahead of remote.

---

## 0. The one-sentence read

You have built a genuinely good *advisory* product and an impressive amount of it — and the highest-leverage move now is **not** to build the vault or runtime model-switching, but to (a) prove it works in the target clients (ChatGPT/Cowork), (b) fix matcher precision one more round, and (c) ship the connection-guidance layer that's currently missing. The vault and runtime switching are a **second, separate, hosted product** — not a change to this one.

---

## 1. State of the project / retro (honest)

### What's genuinely strong
- **The trust spine is real and differentiated.** Untested-edge honesty, deterministic safety augmenter, advisory approval gates, plain-language `explain_component`, credential advisory. The archived M2 benchmark reported +4.7 C−B and suggested the graph adds *specificity and honesty about what's unproven*; because the protocol later identified isolation flaws, treat that uplift as a hypothesis pending a clean rerun.
- **The matcher-fix flywheel works end-to-end.** Dogfood session → Lab finding → Linear issue → node-probe (xfail) → fix → corpus-lock → CI gate. MAR-127/128/130/131/132/133/140/142 all came out of this loop. This is a mature engineering discipline most solo projects never reach.
- **Discipline held where it mattered:** stateless/advisory founding constraint survived the credential question (MAR-117 → advisory, not vault). That was the right call and it's the moat.

### What's over-built relative to evidence
- **14 dogfood sessions, rating ceiling ~3/5, and the headline metric is half-unmeasured** (`modelOutputRating` blank in 5/10 of the first batch). One clean playbook hit 4/5. That's the *entire* evidence base.
- **The autonomous batch roughly doubled surface area with zero dogfooding behind it.** 13+ new components (scheduled_trigger, webhook_trigger, pdf_extraction, airtable_lookup, stripe_data_read, reviewer_notification, github_trigger, loop_controller, fan_out_collector, saga_compensation, threshold_router, review_draft_composer, multi_variant_generator), plus HTTP transport, freshness, control-flow vocab. These are reasonable *gap-fills from session findings* — but they are now **new untested over-build**. The registry grew faster than the evidence that any of it routes correctly.
- **9/10 of the first dogfood batch were Claude (mostly Sonnet).** The "cross-client / Cursor+Claude mix" criterion was never actually met. **Nobody has ever successfully used this in ChatGPT or Cowork** — which is the *entire target audience*.

### The real bottleneck
**Matcher precision, confirmed repeatedly, is what caps the rating at 3/5.** The proof is in lab.db: the one session that hit a clean domain-specific playbook rated 4/5; every `email_calendar_assistant` over-match (precision 0.60–0.78) capped at 2–3. You've shipped four rounds of precision fixes (130/131/132/140/142) and the wild keeps producing new leak classes (negation-blindness, lexical token injection, low playbook precision floors). Keyword matching has a ceiling; you are approaching it. **This is the thing that most directly limits perceived quality.**

A close second bottleneck, newly created: **the target user can't reach the product yet.** HTTP shipped (MAR-111) but is unproven in ChatGPT/Cowork, and the "how do I connect Gmail" step (CTX-01/CTX-02) **does not exist in code** — it's still spec-only.

---

## 2. Deep user analysis

**Who they are:** A new builder who lives in ChatGPT agents or Claude Cowork. Not a developer. Has built *something* before (Henrik's ecological-food social bot) by trial and error. Will abandon anything that doesn't work in the first few minutes. Doesn't know what a "schema_validation step" or "produces_input_for" means and shouldn't have to.

**The concrete problems they hit (in order they hit them):**
1. **"Where do I even start?"** — They have a goal ("email leads to my CRM") and no model of the steps, the order, or what's dangerous. → `plan_workflow` answers this *today*. Strong.
2. **"Is this safe / will it spam my customers?"** — They don't know that auto-send needs an approval gate. → safety augmenter + advisory gates answer this *today*. Strong, and rare.
3. **"How do I actually connect Gmail / Stripe / Slack?"** — This is where they get stuck and quit. → **Not answered today.** CTX-01/CTX-02 don't exist. This is the #1 gap to the felt experience.
4. **"Where do I put my API keys, and is it safe?"** — The "never hunt for keys again" dream. → Not answered (and shouldn't be answered by *this* product — see §4).
5. **"Did my flow actually work / why did it stall?"** — Post-build. → Not answered; requires runtime visibility this product doesn't have.

**The felt workflow end-to-end, today:** They connect the MCP (currently fiddly — local server, stdio or HTTP), type a goal, get a genuinely good numbered plan with safety warnings, then hit a wall the moment they need to wire up a real service, and there's no in-product hand-holding for that wall. They fall back to googling "how to connect Gmail to ChatGPT." **The plan is good; the bridge to a running thing is missing.**

---

## 3. The hook — one USP per phase

You asked for one build-time USP and one in-loop USP. Here are the most defensible.

### Build-time USP: **"The planner that tells you what's unproven and where you'll get hurt."**
Honest, graph-grounded, safety-aware planning in plain language. Untested-edge warnings + advisory approval gates + per-step risk + plain-English component explanations. The current implementation deterministically flags registry gaps and refuses to silently drop a safety gate. That behavior is the strongest, most ownable hook; comparative claims about other planners or model-quality uplift require a fresh controlled evaluation.

### In-loop USP: **the watchdog coworker + connection-context utility — NOT the vault, NOT runtime model-switching.**
The defensible embedded hook is the thing only a *persistent companion* can do and that nobody bundles with planning: **"I know which keys each step needs, I can tell you what's still unconnected, and I'll warn you if your live flow stalls or starts doing something risky."** Health checks, drift/staleness warnings, connection-readiness. This keeps you in the loop without making you a credential custodian or a runtime engine.

### Verdict on Henrik's two candidates
- **Vault** — *not* your most defensible hook. It's a commodity (Composio/Nango/Pipedream already do it), it's a liability magnet (§4), and it directly destroys the "stateless, stores nothing, nothing leaves your machine" trust property that makes the MCP *safe to connect in the first place*. Reselling/brokering managed auth = fine. Custody = no.
- **Mid-flow model switching** — real phenomenon, **not yours to own as a runtime feature** (§5). The *advice* (per-step model tier) is ownable and already shipped; the *execution* would turn you into an orchestration runtime (LangGraph/Temporal territory) — a different, far bigger company.

**Most defensible single hook overall:** the honest planner at build time. The in-loop watchdog is the retention mechanism, not the wedge.

---

## 4. Vault feasibility + security memo (Idea A)

**Is a vault meaningfully riskier than a website login? Yes — categorically.**

A website login authenticates a user *to your own service*. A vault holds **third-party, long-lived, high-value secrets** (Gmail OAuth tokens, Stripe keys, Slack tokens) belonging to *other people's* accounts. The difference:

| Website login | Credential vault |
|---|---|
| If breached: your app's sessions compromised | If breached: *every connected third-party service* of *every user* compromised |
| You authenticate identity | You become a **credential custodian** — a single, concentrated, high-value breach target |
| Reset a password, move on | Liability for downstream damage (drained Stripe, leaked customer data); likely contractual/legal exposure |
| Standard auth hygiene | KMS, envelope encryption, key rotation, secret-zero problem, audit logging, blast-radius isolation, SOC2-grade expectations |

**What building it actually entails (minimal safe design, if you ever did):**
- Never store raw secrets at rest in plaintext. Per-user **envelope encryption** with a KMS (AWS KMS / GCP KMS); the data key encrypts the secret, KMS encrypts the data key, master key never leaves the HSM.
- Prefer **OAuth brokering** over raw key storage: store short-lived refresh tokens, mint access tokens on demand, so a breach yields revocable tokens not permanent keys.
- Strict tenant isolation, full audit log of every secret access, automatic rotation, breach-notification plumbing.
- This is **months** of security-critical work and an ongoing operational liability — for a solo builder, it's the kind of thing that ends the project if it goes wrong once.

**Recommendation: do NOT build a credential vault. Broker, don't custody.**
- Integrate a managed-auth layer that already carries the SOC2/custody burden: **Composio, Nango, Paragon, Pipedream Connect, or the emerging MCP Gateway pattern.** They hold the secrets; you orchestrate. This *is* already the sharpened MAR-123 direction — keep it there.
- The "vault in every flow / pull keys on demand" UX can be a **thin client over a managed broker**, giving the user the *felt* experience ("connected, never hunt for keys again") without you ever holding a raw secret. That preserves the public MCP's stateless trust property *and* delivers the dream onboarding.

**If Henrik still wants a first-party vault:** it must live in the **separate hosted product** (the OrchestrateLab account layer), never in the public MCP, and it should still broker rather than custody for v1. **This is a founding-constraint change and needs Henrik's explicit go/no-go.** My recommendation is **no-go on first-party custody; go on managed-broker integration.**

---

## 5. Model-switching feasibility + advisory-vs-runtime decision (Idea B)

**Is it real?** Yes. Routing different steps to different models (frontier for judgment, small for extraction/classification) genuinely cuts cost, often 2–10× on the cheap steps. The insight is correct.

**Is it ours to own?** **The advice is. The execution is not.**
- You already ship `model_tier_profile` per step (MAR-116) — frontier/standard/small/none. That's the ownable, defensible asset and it's *already built*.
- Executing the switch mid-flow means **running the workflow** — intercepting each step and dispatching to a chosen model. That makes you an **orchestration runtime** (LangGraph, Temporal, Inngest, CrewAI, ChatGPT's own agent runtime). That contradicts the founding constraint ("we're advisory, we RECOMMEND") *and* puts you head-to-head with infra companies. It's a different company.

**Decision: stay advisory. Package the advice better.**
- Make the per-step model recommendation a **portable, exportable artifact** the user's runtime can consume — e.g. a per-step model map the user drops into their LangGraph/Cowork/ChatGPT config. That's the bridge between "advice" and "value the user can act on" without you executing anything.
- **Don't promise runtime switching** in any marketing — memory already flags this and it's right. Claiming it and not doing it would burn the honesty USP.
- "Cheaper" is a legitimate selling point **as advice**: "here's which steps can run on a small/cheap model and why." Frame it that way.

**Is it a moat alone?** No. It's a *feature*, easily copied, and the real version (runtime) isn't ours. It's a nice third bullet, not the wedge.

---

## 6. The /plan → /build → /test → /ship flow — is it doable, how far off?

The crux: **/plan is real today; /build and /test as Henrik imagines them require the stateful hosted product**, because they need connection *state* and the ability to *run* the user's flow — both of which a stateless advisory MCP cannot do by definition.

| Step | What Henrik wants | What exists today | Gap |
|---|---|---|---|
| **/plan** | "I want X→Y→Z" → numbered flow → "does this match?" → "you need these connections, you have these, here's how to connect Gmail/Obsidian" | `plan_workflow` does the numbered flow + safety + tested-pattern detection (~80%). `credential_advisory` lists *which* scopes each step needs. | **The "here's how to connect Gmail" content (CTX-01/CTX-02) does not exist.** And "you already have these" requires connection *state* the MCP can't hold. The conversational "does this match?" loop is the client's job (fine). |
| **/build** | "we have all connections; let's test the flow this way: 1…2…3" | `explain_component`, credential advisory, model-tier profile. | "We have all connections" requires knowing what's connected = **state** = hosted product or the user telling it each time. |
| **/test** | "the test shows: 1…2…3" | Track-A node-probes test the *registry's* matcher — **not the user's actual running flow**. | Testing the user's real flow = executing it = **runtime** = out of scope for advisory MCP. Big gap unless the *agent itself* (ChatGPT/Cowork) runs the test and reports back, with the MCP as advisor. |
| **/ship** | "want to go live?" + final safety check | `record_session_feedback` does a stateless safety self-check + paste-ready block. Closest to done conceptually. | Mostly there as an *advisory* gate. "Going live" itself is the runtime's job. |

**How far off the *felt* experience:**
- **/plan to a strong felt experience: ~1–2 weeks.** Build CTX-01 (connection setup guide content) + CTX-02 (app catalog with auth model/scopes). This closes the "how do I connect Gmail" wall — the single biggest UX gap. The "you have these already" half stays advisory ("ask the user / your client which of these are connected") until/unless the hosted product exists.
- **/build and /test as imagined: gated on the hosted product OR on letting the agent be the runtime.** The cleanest near-term version: the MCP *advises* the test ("test it like this: send a fake invoice, check the Slack message fired"), and the **ChatGPT/Cowork agent actually runs it** using its own connected tools. That keeps you advisory and is shippable. The fully-integrated "we ran your flow and here's the result" needs the hosted layer.
- **/ship: shippable now** as an advisory final-check.

**So: doable, but it forces the split decision.** The advisory MCP can deliver a *guided* plan→build→test→ship narrated by the agent; the *integrated* version (knows your connections, runs your tests) needs the hosted product.

---

## 7. The architecture decision (the critical tension, resolved)

**Split the product. Don't move the whole thing.**

```
┌─────────────────────────────────────────────────────────────┐
│  PUBLIC: OrchestrateKit MCP  (this repo)                     │
│  Stateless · read-only · no secrets · no telemetry          │
│  → trivial to connect, safe to connect, the trust moat      │
│  → planning, safety, honesty, plain language, model-tier    │
│    ADVICE, connection-setup GUIDANCE (CTX-01/02)            │
│  This is the wedge. Keep it pure.                           │
└─────────────────────────────────────────────────────────────┘
                          │  (advises / hands off to)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  HOSTED: OrchestrateLab account product  (private sibling)  │
│  Accounts · connection state · managed-auth BROKER          │
│  (Composio/Nango — not first-party custody) · watchdog/     │
│  health · "needs-rating" evidence loop · billing            │
│  This is the retention + monetization layer. Optional v2.   │
└─────────────────────────────────────────────────────────────┘
```

**Why this and not "move everything":**
- The MCP's *entire* ease-of-adoption and trust story ("stateless, stores nothing, nothing leaves your machine") is what makes a non-technical user willing to connect it in 2 minutes. The moment it holds secrets, you inherit the full custody liability *and* you make connection scary. You'd be trading your only moat for a commodity.
- The stateful stuff (accounts, connection state, vault-feel, watchdog) genuinely needs a backend — and you *already have the private sibling repo* (orchestratelab) as the natural home. You don't need a new product; you need to decide *when* to grow Lab from an evidence factory into an account product. That's a real fork in the road and a Henrik call.

**Trust/security implications either way:**
- **Split (recommended):** public MCP stays auditable, no breach surface (nothing to steal). Hosted layer carries risk but it's isolated, opt-in, and brokered. Clean separation of liability.
- **Move everything:** one breach compromises the planner's reputation *and* every user's third-party credentials. You become a security company whether you wanted to or not. For a solo builder, this is existential risk for marginal differentiation. **Don't.**

---

## 8. ETA to a launchable MVP

**Define two MVPs — they have very different timelines.**

### MVP-A — "The honest planner, in your client" (recommended first launch)
*Advisory MCP, connectable from ChatGPT + Cowork, guides you through planning + connection setup.*

**Blockers (in order):**
1. **Cross-client validation (MAR-104)** — *prove* it actually works in ChatGPT and Cowork. This has never been done. **This is the real gate.** (Days, but could surface real problems.)
2. **Push / re-slice the 11 unpushed commits** — review the autonomous batch, decide push-as-is vs re-slice into PRs (MCP repo's norm is branch+PR). (Hours–1 day.)
3. **CTX-01 + CTX-02 connection guidance** — the "how to connect Gmail" content. (~1–2 weeks; this is the biggest real build.)
4. **Easy install (MAR-112)** — the connect step must be near-trivial. (Days–1 week depending on ambition.)
5. **Matcher round-3** — one more precision pass on the wild leaks (MAR-140 residual, negation-blindness) so the ceiling lifts off 3/5. (Days, gated by probes.)

**ETA: ~2–3 weeks of focused solo work** to a launchable advisory MVP, *assuming* cross-client validation doesn't surface a structural problem. The rating ceiling is the quality risk; everything else is execution.

### MVP-B — "The 4-box dream" (vault-feel, connect buttons)
*Requires the hosted account product + managed-auth broker integration.*

**ETA: ~2–3 months** if reselling a managed broker (Composio/Nango) rather than building custody — and that's with the account product, connection state, and billing. Much longer (and inadvisable) if building first-party credential storage.

**Recommendation:** Ship **MVP-A as the wedge**, validate that non-technical users actually get value from the planner in their real client, *then* decide whether the demand justifies MVP-B. Don't build the hosted product on a hypothesis; build it on MVP-A's usage signal.

**Assumptions behind the estimate:** solo builder, Sonnet for mechanical work / Opus for judgment, no new founding-constraint changes, cross-client works without a rewrite, and you resist adding more registry surface area until dogfooding demands it.

---

## 9. Roadmap forward (sequenced, leverage-ordered)

**T0 — Validate what you already shipped (do this before building anything new)**
- **Push or re-slice the 11 commits.** *(Henrik go/no-go: push-as-is vs PRs.)*
- **MAR-104 cross-client gate** — connect the HTTP server from ChatGPT *and* Cowork, run 3–5 real goals in each, log them. This is the single most important unvalidated assumption in the whole project.
- **Reconnect + re-dogfood** the new components (the autonomous batch has zero dogfood behind it).

**T1 — Lift the quality ceiling**
- **Matcher round-3:** MAR-140 residual (negation-blindness, schedule→calendar leak), close the cheapest sub-parts. Gate with probes.
- **Enforce + fill `modelOutputRating`** so the headline metric stops being half-unmeasured. You can't manage the ceiling you can't see.

**T2 — Close the felt-experience gap**
- **CTX-01 connection-setup guidance** + **CTX-02 app/auth catalog.** This is the "how do I connect Gmail" wall. Highest-leverage *new* build.
- **Easy install (MAR-112).**

**T3 — Launch MVP-A**
- Public benchmark demo (MAR-118), repo split (MAR-110 — clean public/private boundary supports the §7 architecture), launch gate (MAR-113).

**Reach / decide-later**
- **MAR-138 Claude Skill packaging** *(needs Henrik's blessing)* — likely the fastest path to Cowork non-technical users; Skills are the portable distribution format. Evaluate seriously after MVP-A.
- **Hosted product (MVP-B)** — only on MVP-A's demand signal. Managed-auth broker, not custody.

**Defer / kill**
- First-party credential vault (custody). Runtime model-switching. True cyclic graph. Heavy Lab governance features. Real model API keys (nothing needs them yet).

---

## 10. Full selling-points list

### Claimable TODAY (verifiable in code)
- ✅ One-call workflow planner from a plain-English goal (`plan_workflow`).
- ✅ Flags **untested / unproven** steps instead of pretending everything's validated (with edge severity, MAR-133).
- ✅ Deterministic **safety guardrails** — auto-inserts approval gates before irreversible writes; never silently drops one (advisory reconciliation, MAR-132).
- ✅ **Plain-language** explanations for non-developers (`explain_component`, MAR-136).
- ✅ Per-step **model-tier advice** ("run this cheap step on a small model") — the *cheaper* story, honestly scoped as advice (MAR-116).
- ✅ Tells you **which permissions/scopes** each step needs (credential advisory, MAR-117) and recommends managed secret handling — without ever holding a secret.
- ✅ **Stateless, read-only, nothing leaves your machine** — safe to connect. *(This is itself a top selling point for a privacy-wary non-technical user.)*
- ✅ Reuses **validated patterns** when one matches, composes a candidate otherwise — and tells you which you got.
- ✅ Connectable from **ChatGPT / claude.ai / Cowork** over HTTP (MAR-111) — *pending cross-client proof (MAR-104).*
- ✅ Registry **freshness** labels (fresh/recent/stale) so advice isn't silently dated (MAR-137).

### Planned / not yet claimable
- ⏳ "Here's exactly how to connect Gmail/Slack/Stripe" (CTX-01/02 — **not built**).
- ⏳ "Connect once, never hunt for keys again" (needs hosted broker — MVP-B).
- ⏳ Watchdog coworker ("email me if my flow stalls") — needs hosted/runtime.
- ⏳ Proven cross-client (ChatGPT + Cowork) — needs MAR-104.
- ❌ **Do not claim:** runtime mid-flow model switching, a first-party vault, "we run/test your flow." These are either out of scope or would break the honesty USP.

---

## 11. Next tests — when and what

**Immediately (gates everything else):**
- **MAR-104 cross-client gate (Track B).** Connect HTTP from ChatGPT *and* Cowork; run 3–5 goals each; log to Lab. **This is the #1 test — the target user has never successfully used the product.** If this fails, nothing else matters.
- **Reconnect + re-run the autonomous-batch components** through `plan_workflow` (Track B). They've never been dogfooded.

**Track A (deterministic, already automated, keep green):**
- Node-probes (`pnpm probe`) already gate the matcher in CI. Add probes for the new components as you dogfood them and find leaks.
- After matcher round-3, the MAR-140 xfail probes should flip green.

**Track B (human-judged, the MAR-109 model):**
- Round-3 dogfood **after reconnect** (the MAR-141 stale-build gotcha is real — always `pnpm build` + reconnect first).
- **Enforce `modelOutputRating`** every session so the ceiling is measurable.
- Tie session findings into the corpus (MAR-122 loop) so round-3 fixes lock.

**Reminder from MAR-141:** always rebuild + reconnect the MCP before any dogfood/capture run, or you log stale-server garbage. This is a hard prerequisite for any automated capture (MAR-139).

---

## 12. Decisions that need Henrik's explicit go/no-go

1. **The 11 unpushed commits:** push-as-is, or re-slice into PRs per the MCP repo's branch+PR norm? *(My lean: re-slice the bigger ones — HTTP, the component batch — into reviewable PRs; this batch is large and unreviewed.)*
2. **Vault — founding-constraint change.** My recommendation: **no-go on first-party custody; go on managed-auth broker (Composio/Nango).** Your call.
3. **The product split (§7):** confirm "public stateless MCP + separate hosted account product," and that the hosted layer is grown from the existing private orchestratelab repo rather than a new product. Your call on *when*.
4. **MAR-138 Claude Skill packaging** — still needs your blessing before building. My lean: evaluate it right after MVP-A; it may be the fastest route to your actual users.
5. **MVP definition:** confirm we launch **MVP-A (advisory)** first and treat MVP-B (vault/connect-buttons) as demand-gated. My strong recommendation: yes.

---

## Bottom line

The product is good and over-built relative to its evidence. The wedge is the **honest planner** — and it's basically done. The three things standing between you and a launch are **proof it works in ChatGPT/Cowork**, **one more matcher round**, and **the connection-guidance layer**. The vault and runtime model-switching are seductive but they're a *different, riskier, second product* — keep this one pure and advisory, broker credentials instead of holding them, and let the advice (model-tier, connection scopes) be the bridge to value. Ship MVP-A in ~2–3 weeks, validate demand, then decide on the hosted layer.
