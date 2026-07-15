# OrchestrateKit Agent Planner Skill

Portable Claude Skill package for MAR-138.

## Recommendation

Build and ship the hybrid Skill plus MCP path.

The Skill is useful as a low-friction distribution artifact for Claude users because it packages the planning procedure, safety checklist, and current published playbook catalogue into a copyable folder. It should not be the only distribution path: live OrchestrateMCP remains required for current registry matching, component explanations, route confidence, Plan Passport export, and replay verification.

## Contents

- `SKILL.md` - Claude Skill entrypoint and invocation policy.
- `references/playbooks.md` - static catalogue of published playbooks.
- `references/safety-checklist.md` - portable safety and approval checklist.
- `references/setup.md` - hosted MCP setup path and offline-mode limits.

## Install

Copy the `orchestratekit-agent-planner` folder into a Claude skills location such as:

```text
~/.claude/skills/orchestratekit-agent-planner/
```

The folder name becomes the user-invocable Skill command in Claude Code.

## Maintenance

Run the repository verification suite before publishing changes:

```bash
pnpm verify
```

The focused test `tests/distribution/claudeSkill.test.ts` checks that this package keeps the required structure and that the static playbook reference includes every currently published registry playbook.
