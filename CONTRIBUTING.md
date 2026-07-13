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

## Scope

The public repository contains the read-only planner and public registry. LAB,
LAB OS, private evidence, credentials, and personal operational data do not
belong here. See `README.md` for the product's explicit non-goals.

By contributing, you agree that your contribution is licensed under the MIT
License in this repository.
