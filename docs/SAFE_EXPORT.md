# Safe Source Export

Use the safe export command when sending OrchestrateMCP source for review:

```bash
pnpm export:safe
```

The command writes `exports/orchestratekit-mcp-source.zip` with a deterministic
source-only zip process, then fails if forbidden archive paths are present.

Do not create review zips with Explorer, Finder, or a raw folder zip. Raw folder
zips can scoop up local runtime state that is useful on Henrik's machine but
must not travel with source review packages.

Forbidden export content:

- `.claude/` and `.claude/settings.local.json`
- `.env*`
- `.wrangler/`
- `dist/`
- `.next/`
- `.labos/`
- `node_modules/`
- `*.db` and `*.sqlite`
- logs, including `*.log` and `logs/`
- root `ai-agent-briefing-*` files in this public MCP repo

To inspect a produced archive without reading file contents:

```bash
pnpm tsx scripts/check-safe-export.ts --list exports/orchestratekit-mcp-source.zip
```

This lists zip entry names only, then confirms the forbidden path checks.
