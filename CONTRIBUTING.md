# Contributing to OrchestrateMCP

Thanks for helping make AI workflow planning more honest and useful.

## Before you start

1. Check the public issue tracker for an existing issue or discussion.
2. Keep one behavior change per pull request.
3. Do not include credentials, private prompts, customer data, or private LAB
   evidence in issues, fixtures, screenshots, commits, or archives.

Bug reports should include a minimal synthetic goal, expected behavior, actual
behavior, the client used, and the output of `health_check`. Remove secrets and
personal data before posting.

## Local development

Requirements: Node.js 20 or newer and pnpm 9.

```bash
git clone https://github.com/orchestratemcp/OrchestrateKIT-MCP.git
cd OrchestrateKIT-MCP
pnpm install --frozen-lockfile
pnpm verify
```

Run the stdio server with `pnpm dev`. See the client-specific setup guides in
`docs/` before testing with ChatGPT, Claude, or Cursor.

## Pull requests

- Explain the user-visible behavior and why it belongs in the public,
  stateless MCP server.
- Add or update deterministic tests for behavior changes.
- Run `pnpm verify` and include the result in the pull request.
- Keep registry counts, claims, fixtures, and generated output honest.
- Treat generated registry bundles as build artifacts; do not commit them.
- Use `pnpm export:safe` for review archives instead of zipping the worktree.

Registry changes must include evidence appropriate to the claim: schema-valid
YAML, relevant test references, matcher/corpus coverage where applicable, and
no promotion from suggestion to “tested” without reproducible proof.

## Grounded prose (non-negotiable)

Every user-visible sentence must be entailed by the evidence that emitted it.
The condition that emits a sentence must be exactly as narrow as the evidence
justifying it — no broader.

This has now been violated three times in three different places, which is why
it is a rule and not a review note:

- **MAR-397** — copy asserted a refund/scope consequence the plan did not entail.
- **MAR-413** — a safeguard sentence true of the price-monitor case was emitted
  for *every* scheduled + Slack plan, and an authorization caveat was appended to
  plans that required no connection at all.
- **Steward Chief (LAB)** — a prose model attributed a Journey finding to the
  briefing; it narrated a provenance it had not read.

In practice:

1. **Narrow the condition to the evidence.** If a sentence is only true when
   three signals hold, gate it on all three. Generalizing a true sentence to a
   neighbouring case is how it becomes false.
2. **Never let a model narrate provenance.** Where a sentence names its source
   ("the briefing found…", "this was flagged by…"), assemble it from the stored
   record. Free prose over a set of findings will mislabel which one it read.
3. **Say nothing rather than say a caveat that does not apply.** An
   inapplicable safeguard trains the reader to skip the applicable ones.
4. **Cover it both ways.** A behavior test that the sentence appears where it
   should, and one that it is absent where it should not. The absence fixture
   carries equal weight — that is the half that was missing all three times.

## Scope

The public repository contains the read-only planner and public registry. LAB,
LAB OS, private evidence, credentials, and personal operational data do not
belong here. See `README.md` for the product's explicit non-goals.

By contributing, you agree that your contribution is licensed under the MIT
License in this repository.
