# DASH contract fixtures

The schemas, `contract.lock.json`, and `conformance/v1/*` are verbatim,
code-free copies of orchestratedash's frozen telemetry contract v1. The MCP
validates both its exported manifest and the MAR-363 demo event producer against
these assets.

**Dual-update discipline** (same rule as `tests/fixtures/matcher-corpus.json`):
when the DASH contract changes, copy the schemas, lock, and conformance folder
in the same commit and re-run `pnpm test`. Semantic schema fingerprints plus the
golden run fixture are the contract tripwire between repos, which otherwise
share no code.
