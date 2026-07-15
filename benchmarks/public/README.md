# Public benchmark — deterministic registry conformance

> This benchmark makes **zero LLM and network calls**. It reproduces matcher/graph fixture results, not model-quality uplift. Archived A/B/C scores are not a current public claim; that claim stays on hold until isolated client runs are completed.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm benchmark
pnpm benchmark:check
```

## Provenance

- Package: `orchestratekit-mcp@0.1.0`
- Registry fingerprint: `26b95a7a03de9ffd`
- Report fingerprint: `9d5a97033faa319e`
- Public non-beta registry: 64 components / 151 edges / 12 routes / 12 playbooks / 4 workers
- Prompt source SHA-256: `7a1b47ce10f1db158810205984f7f956aaa95c0d87f9334080032ac7abb6d8f9`
- False-positive fixture SHA-256: `5a2e8a3e5cabe5febb4eb9d9d5e5371a8e1c5458360a6b9be1e7e75364f51c25`

## Current result

**7/7 prompts pass; 50/50 required/forbidden assertions pass.**

Deterministic route scores range from 61 to 84 (average 72.6). These are graph-internal scores, not LLM quality scores. The report also exposes 3 non-validated routes, 0 untested-edge occurrences, and 3 compose-noise flags instead of hiding them.

| Prompt | Fixtures | Route status | Route score | Untested | Noise | Path | Verdict |
| --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| p1_research_workflow | 7/7 | candidate | 81 | 0 | 1 | compose | PASS |
| p2_content_publish_workflow | 8/8 | validated | 70 | 0 | 1 | `content_approval_pipeline` | PASS |
| p3_email_calendar_assistant | 7/7 | validated | 65 | 0 | 0 | `email_calendar_assistant` | PASS |
| p4_codebase_agent | 9/9 | candidate | 84 | 0 | 0 | compose | PASS |
| p5_data_pipeline | 9/9 | candidate | 79 | 0 | 0 | compose | PASS |
| p6_email_lead_crm | 5/5 | validated | 61 | 0 | 0 | `email_lead_to_crm` | PASS |
| p7_product_monitor_content | 5/5 | validated | 68 | 0 | 1 | `content_approval_pipeline` | PASS |

## What this proves

- The current registry fingerprint deterministically covers every declared required component in the seven public prompts.
- Known forbidden cross-domain components do not leak into those routes.
- Expected playbooks exist, and the composer can recommend playbook-first reuse when overlap warrants it.
- Candidate status, untested edges, blocking gaps, and matcher noise remain visible in the machine-readable report.

## What this does not prove

- It does not compare a vanilla model with an MCP-assisted model.
- It does not measure ChatGPT, Claude, or Cursor response quality.
- It does not prove that a designed workflow is production-reliable.
- A/B/C client scoring still follows [PROTOCOL.md](../PROTOCOL.md) and requires fresh isolated conversations plus human scoring.

Machine-readable result: [latest.json](latest.json). Historical manual runs remain under `benchmarks/results-*.md` with their original caveats.
