# Public claim ledger

**Evidence snapshot:** 2026-07-17

**Owner:** OrchestrateMCP maintainers

**Refresh before:** every public release, demo recording, launch post, or hosted registry deployment

This is the source of truth for public product claims. If a claim is not listed here, describe the behavior narrowly or hold the claim until evidence exists.

## Approved claims

| Claim | Evidence | Approved public wording |
| --- | --- | --- |
| Hosted registry | Hosted `health_check`, build fingerprint `4722c8f8e0240af7`, content fingerprint `825e5120f319f842` (matches pinned P0-06 `EXPECTED_RELEASE_FINGERPRINT`, `matches_expected_release: true`), built 2026-07-17 | “The hosted registry publishes 65 components, 156 connections, 12 routes, 12 playbooks, 4 workers, and 1 reference stack.” |
| Registry edge references | Hosted `health_check`: `untested_edge_pct: 0` | “All 156 published connections carry registry test references.” |
| Demo readiness | Hosted `health_check`: `safe_to_demo: true`, no demo blockers, `matches_expected_release: true` | “The current hosted registry passes its freshness, minimum-count, and pinned-fingerprint demo gate.” |
| Deterministic conformance | `pnpm benchmark:check`; source fingerprint `825e5120f319f842`; report fingerprint `b302b97a81286cc8` | “The deterministic registry benchmark passes 7/7 prompts and 50/50 required/forbidden assertions.” |
| Honest failure visibility | Public benchmark report | “The report exposes 3 candidate routes and 3 compose-noise flags instead of hiding them.” |
| Runtime boundary | Server implementation and tests | “OrchestrateMCP is a stateless, read-only design advisor. Its tools store no prompts or credentials, execute no workflow, and make no LLM calls.” |
| Deterministic tool logic | Deterministic tool and benchmark tests | “Given the same versioned inputs, OrchestrateMCP’s tool logic returns deterministic structured results.” |

## Definitions and limits

- **Published counts are not source totals.** Source files may include beta, candidate, or archived material. Public copy must use the non-beta counts returned by the hosted `health_check`.
- **A registry test reference is not end-to-end production proof.** `untested_edge_pct: 0` means every published edge has the metadata required by the registry trust gate. It does not certify an entire deployed workflow or third-party integration.
- **`safe_to_demo` is a narrow operational gate.** It checks registry freshness and minimum counts. It does not prove production reliability, security, or client compatibility.
- **Deterministic tools do not guarantee byte-identical client prose.** ChatGPT, Claude, and Cursor may render, summarize, or wrap the same structured tool result differently.
- **Plans are implementation inputs, not deployed systems.** A proposed route still requires implementation, credentials, integration testing, security review, and human approval where writes are involved.

## Claims on hold

Do not publish these until the named evidence exists:

| Held claim | Why held | Release condition |
| --- | --- | --- |
| “The graph improves model quality by +4.7” | The archived A/B/C run had isolation flaws documented in `benchmarks/PROTOCOL.md`. | Fresh isolated A/B/C runs in at least two clients with human scoring. |
| “Byte-identical across ChatGPT, Claude, and Cursor” | Tool logic is deterministic; client-generated prose and rendering are not controlled. | Compare the structured tool payload only, or publish client-specific evidence with precise wording. |
| “Battle-tested” / “production-ready” / “won’t break in production” | Registry tests and local rehearsals do not prove production reliability. | Real deployed runs with reviewed outcome evidence and a defined reliability threshold. |
| “The complete CRM/Slack/draft flow is proven” | Current rehearsal evidence includes simulated or stubbed downstream steps. | A recorded, labelled end-to-end run with real integrations and retained evidence. |

## Reproduce the current evidence

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm benchmark
pnpm benchmark:check
```

The public benchmark report is in [`benchmarks/public/README.md`](../benchmarks/public/README.md), with machine-readable output in [`benchmarks/public/latest.json`](../benchmarks/public/latest.json).
