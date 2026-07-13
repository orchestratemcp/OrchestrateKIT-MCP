# Claude-client acceptance run — 2026-07-13

Fresh, isolated acceptance run against the public hosted endpoint. **No code
was changed.** Raw wire evidence lives beside this file (`00`–`06` JSON).

## Client identity

| | |
|---|---|
| Client | Claude Code (Claude Agent SDK harness, desktop app, Windows 11 Home 10.0.26200) |
| Model | `claude-fable-5` |
| Endpoint | `https://mcp.orchestratemcp.dev/mcp` (Cloudflare Worker, streamable HTTP, stateless) |
| Server build | `built_at 2026-07-13T11:46:34Z`, worker version `df50c16a-6e3a-4258-a6a3-ab8212589285` |
| Run window (UTC) | 2026-07-13T16:03:16Z → 16:03:18Z |
| Method | Two lanes: (a) raw JSON-RPC over HTTP with no MCP SDK — wire-level evidence in this folder; (b) Claude Code's native MCP connector, exercised earlier the same day in the same session (friction findings below come from both). |

Screenshots: not producible from this headless CLI context — the raw JSON-RPC
exchanges are committed verbatim instead (`01`–`05`). No cross-client uplift is
claimed; this documents ONE client's experience.

## Results

| Step | Result | Wall time |
|---|---|---:|
| `initialize` | 200 OK, protocol accepted | 331 ms |
| `tools/list` | **18 tools discovered** — bare request worked without an initialize handshake (stateless transport accepts single-POST calls; very low connection friction for curl/script users) | 250 ms |
| `health_check` | 64 components / 151 edges / 12 routes / 12 playbooks, 0% untested edges, `safe_to_demo: true`, no demo blockers | 47 ms |
| `plan_workflow` (canonical benchmark goal: email-lead-to-CRM) | `plan_source: playbook` (`email_lead_to_crm`), `route_status: validated`, 9 steps, 5 host/monitor choices (local / cron / github_action / hosted_endpoint / cowork) | 58 ms |
| `export_build_brief` (from that plan) | 200 OK, sections §0–§9 + §11 Connect, `connect` field present with the 8-var credential manifest, manifest fingerprint `26b95a7a03de9ffd` (matches the local bundle) | 243 ms |

## Findings (client-specific friction, mismatches)

1. **`export_build_brief` payload size vs Claude-client token caps.** The raw
   response is **616 KB** (261 KB even for the 9-step in-session variant).
   Claude Code refuses to inline tool results this large: the harness dumps
   them to a file and the model must post-process with jq/node. The tool works,
   but a Claude-driven flow never *sees* the brief inline — a size-tiered brief
   (or paginated sections) would remove this friction. Observed on both lanes.
2. **`health_check` returns no `structuredContent`** — only `content[0].text`
   (JSON-as-string). Every other tool checked (plan_workflow,
   export_build_brief) returns both. Clients that read the structured field get
   `null` for health. Inconsistent output contract, cosmetic but real
   (`03-health-check.json`).
3. **No connection friction otherwise.** No auth, no session juggling, SSE and
   plain-JSON response framing both parse, cold-call latency after warmup is
   double-digit ms. All 18 tools visible with schemas on first `tools/list`.
4. No missing tools, no rendering mismatches beyond (1), no errors on any call.

Raw files: `00-client.json` (identity) · `01-initialize.json` ·
`02-tools-list.json` · `03-health-check.json` · `04-plan-workflow.json` ·
`05-export-build-brief.json` · `06-summary.json` (timings).
