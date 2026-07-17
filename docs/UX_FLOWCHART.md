# UX Flowchart — Today vs Target

- **Status:** reference doc, adopted 2026-07-17 (companion to [AGENT_CREATION_UX_SPINE.md](./AGENT_CREATION_UX_SPINE.md))
- **Visual version:** claude.ai artifact "OrchestrateKit — UX Flow: Today vs Target" (Henrik's artifact gallery)
- **Status colors reflect:** master `6ff9bc6` (PRs #116–#119 merged, worker deployed)

**Legend:** 🟢 shipped on master · 🟡 in flight · 🔴 missing · ⭐ recommended path. Following only ⭐ options is the fastest safe path; every branch stays open.

## Today — honest planner, dead-end journey

The plan is now trustworthy (constraint coverage, calendar-notification question, structural no-send). But after the menu every path leaves the product: the user hand-drives a coding agent, OAuth lives in a terminal script, and nothing observes the result.

```mermaid
flowchart TD
  G["🟢 Goal (one sentence)"] --> P["🟢 plan_workflow<br/>route + safety + runtime fit<br/>constraint coverage · calendar question"]
  P --> M["🟢 A/B/C/D continuation menu"]
  M -->|A| SV["🟢 Save plan to Linear / Notion"]
  M -->|B| HP["🟢 Portable handoff prompt"]
  M -->|C ⭐| BB["🟢 export_build_brief"]
  M -->|D| RV["🟢 Review / change plan"]
  M -.->|unnamed| CHAT["🟡 Client freelances:<br/>runs workflow in chat"]
  BB --> CC["🔴 Hand brief to Claude Code / Cursor<br/>(manual, outside product)"]
  CC --> CONN["🔴 connect.mjs terminal OAuth"]
  CONN --> RUN["🔴 Agent runs somewhere<br/>no approval inbox · no timeline"]
  RUN --> X1["∅ nothing observes it"]
  CHAT --> X2["∅ dies with the session"]
```

## Target — one spine, three scope sizes

After the plan, the product **sizes the task** and recommends the matching path. Small tasks never see hosting questions; large ones never get pretended into a single prompt.

```mermaid
flowchart TD
  G["🟢 Goal (one sentence)"] --> P["🟢 Reflected contract<br/>plan + constraint coverage<br/>+ 1–3 material questions"]
  P --> S{"🔴 Scope assessment<br/>S / M / L"}

  S -->|"SMALL · run it"| S1["🟡 ⭐ Attended dry run<br/>in chat / Cowork — nothing persists"]
  S1 --> S2["🔴 Approve the real preview card"]
  S2 --> S3["🔴 Done — offer: save as routine"]

  S -->|"MEDIUM · build it"| M1["🟡 ⭐ Dry run first"]
  M1 --> M2["🔴 ⭐ Connect — least privilege<br/>connection = MCP server, once"]
  M2 --> M3["🔴 ⭐ One-prompt build<br/>build brief → coding agent"]
  M3 --> M4{"🔴 Runtime?"}
  M4 -->|"⭐ hosted worker"| M5["🔴 Golden-journey verify"]
  M4 -->|local| M5
  M5 --> M6["🔴 Promote — agent live<br/>approval inbox · run timeline"]

  S -->|"LARGE · plan it"| L1["🔴 ⭐ Generate Linear project<br/>milestoned issues from plan"]
  L1 --> L2["🔴 Build vertical slices<br/>(each slice = a MEDIUM journey)"]
  L2 --> L3["🔴 DASH workspace<br/>plan-vs-actual · evidence · LAB loop"]

  S3 -.->|outgrows chat| M1
  M6 --> OBS["🔴 Observe & keep relevant"]
  L3 --> OBS
```

### Scope sizing — deterministic drivers

| Size | Drivers (derivable from the plan itself) | Recommended path |
|---|---|---|
| **Small — run it** | attended, no durable trigger, ≤1 low-risk write, ≤2 connections | dry run now → approve → done; offer "save as routine" |
| **Medium — build it** | durable trigger or schedule, 1–3 connections, single runtime, L2–L3 clearance | dry run → connect → one-prompt build → hosted worker → verify → promote |
| **Large — plan it** | multi-agent route, >3 connections, multiple runtimes, ongoing ops | Linear project from plan → build slices as MEDIUM journeys → DASH |

**Design rule:** scope size never gates capability — it only changes which option is recommended first. A small task can still be promoted to a hosted agent; a large one can still be dry-run in chat. The chart is a decision *default*, not a wall.

## The golden-journey test — the self-running check

The MCP is deterministic; the only unpredictable actor is the client LLM. So the test harness replaces it with a **mechanical client that always picks the ⭐ recommended option**. If a mechanical client can complete the journey, an LLM client has no room to freelance — which is exactly what broke the MAR-363 demo takes.

```mermaid
flowchart LR
  A["Golden goal<br/>(fixture)"] --> B["plan_workflow"]
  B --> C["Mechanical client<br/>always picks ⭐"]
  C --> D["Journey transcript<br/>plan → dry run → brief → runtime"]
  D --> E{"Diff vs golden<br/>expectations"}
  E -->|match| F["✅ CI green — UX is boring<br/>(boring = recordable)"]
  E -->|drift| H["❌ Failing step named<br/>fix product, not test"]
  H --> B
```

**Recording bar, restated:** MAR-363 gets recorded when the golden-journey test passes 5 consecutive runs with an identical transcript. The test *is* the rehearsal.

## Build order implied by the charts

1. 🟡 Attended dry-run continuation mode (in flight — parallel session)
2. 🔴 Scope assessment in `plan_workflow` (`scope_assessment` field + scope-aware ⭐ in the menu)
3. 🔴 Golden-journey harness (mechanical client + journey fixtures in CI)
4. 🔴 Connect (MAR-383, connection-as-MCP-server) → one-prompt build → promote (MAR-379/377) → observe (MAR-298/384)
