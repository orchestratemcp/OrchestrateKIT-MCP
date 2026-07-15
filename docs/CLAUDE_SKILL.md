# Claude Skill Packaging Evaluation

MAR-138 recommendation: build the hybrid Skill plus MCP path.

## Decision

Ship a portable Claude Skill as an on-ramp, not as a standalone replacement for OrchestrateMCP.

The checked-in slice lives at:

```text
distribution/claude-skill/orchestratekit-agent-planner/
```

The package contains a `SKILL.md` entrypoint plus references for published playbooks, safety checks, and setup. This follows Claude's current Skill shape: a directory with `SKILL.md` as the required entrypoint and optional supporting files.

## Why Hybrid Wins

Standalone Skill:
- Low-friction to share with Claude users.
- Good for repeated instructions, safety reminders, and a static playbook catalogue.
- Cannot inspect the latest registry graph, score route confidence, expose current MCP resources, or export/replay Plan Passports.

Live MCP:
- Current source of truth for registry data, component explanations, playbook matching, and build brief export.
- Requires users to connect an MCP endpoint before they see value.

Skill plus MCP:
- Gives Cowork/Claude users an immediate planning habit and setup path.
- Falls back honestly when tools are disconnected.
- Nudges serious implementation handoff back through `plan_workflow`, `get_playbook`, `explain_component`, `export_build_brief`, and replay verification.

## Maintenance

The static playbook catalogue is intentionally small and conservative. `tests/distribution/claudeSkill.test.ts` verifies that every published registry playbook appears in the packaged reference and that the Skill points users back to the hosted MCP path for live planning.

When a playbook is promoted to `published`, update:

```text
distribution/claude-skill/orchestratekit-agent-planner/references/playbooks.md
```

Then run:

```bash
pnpm verify
```

## Source Notes

Claude Skill packaging was evaluated against Anthropic's Claude Code Skills documentation, which describes `SKILL.md` as the required entrypoint and supporting files as the way to keep larger references out of the main Skill body.
