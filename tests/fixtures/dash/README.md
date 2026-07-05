# DASH contract fixtures

`agent.manifest.schema.json` is a **verbatim copy** of
`orchestratedash/contracts/agent.manifest.schema.json` (DASH-01 / MAR-295), the
frozen v1 telemetry contract. `export_build_brief` emits an `agent_manifest` that
must validate against it (MAR-296 / DASH-02).

**Dual-update discipline** (same rule as `tests/fixtures/matcher-corpus.json`):
when the DASH schema changes, copy the new version here in the same commit and
re-run `pnpm test`. If the two drift, `tests/tools/observabilityManifest.test.ts`
fails — that failure IS the contract tripwire between the two repos, which
otherwise share no code.
