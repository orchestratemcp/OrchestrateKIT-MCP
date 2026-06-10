# OrchestrateKit MCP — Local Setup Guide

Connect the OrchestrateKit workflow graph to Cursor or Claude Desktop via **stdio** —
no remote hosting, no auth, no API keys required.

---

## Prerequisites

| Requirement | Minimum version |
|-------------|----------------|
| Node.js     | 20.x or later  |
| pnpm        | 9.x or later   |

Check your versions:

```bash
node --version
pnpm --version
```

---

## Install

```bash
cd orchestratekit-mcp
pnpm install
```

---

## Build

```bash
pnpm build
```

This compiles `src/server.ts` → `dist/server.js` and copies `registry/` into `dist/`.

---

## Verify the server starts

```bash
node dist/server.js
```

The process should start and wait on stdin — no output is expected unless an MCP
client sends a message. Press `Ctrl+C` to stop.

To use the dev server instead (no build step, slower startup):

```bash
pnpm dev
```

---

## Locate the executable

The stdio entry point after `pnpm build` is:

```
<project-root>/orchestratekit-mcp/dist/server.js
```

Both Cursor and Claude Desktop require the **absolute path** to the built file
(or the `node`/`npx tsx` command with the project directory as working directory).

---

## Connect in Cursor

Copy `examples/cursor-mcp.json` into your Cursor MCP settings. Cursor stores the
global MCP configuration at:

- **macOS/Linux:** `~/.cursor/mcp.json`
- **Windows:** `%APPDATA%\Cursor\mcp.json`

Edit the path to match your local installation:

```json
{
  "mcpServers": {
    "orchestratekit": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/absolute/path/to/orchestratekit-mcp"
    }
  }
}
```

On Windows, use forward slashes or escaped backslashes:

```json
"cwd": "C:/Users/yourname/projects/orchestratekit-mcp"
```

After saving, restart Cursor. The tools should appear under **MCP** in the
Cursor settings sidebar and be callable from any chat in that workspace.

See `docs/CURSOR_USAGE.md` for prompt examples and workflow guidance.

---

## Connect in Claude Desktop

Claude Desktop reads its MCP configuration from:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Use the example from `examples/claude-desktop-config.json`:

```json
{
  "mcpServers": {
    "orchestratekit": {
      "command": "node",
      "args": ["/absolute/path/to/orchestratekit-mcp/dist/server.js"]
    }
  }
}
```

> Claude Desktop requires the full absolute path in `args`, not a `cwd` key.

After saving, restart Claude Desktop fully (quit and reopen — not just new conversation).
The 🔌 icon in the bottom-left of a conversation shows connected MCP servers.

See `docs/CLAUDE_DESKTOP_USAGE.md` for usage guidance.

---

## Run smoke tests

```bash
pnpm smoke
```

This runs the vitest smoke suite that verifies all 12 registered M2 tools return
valid structured JSON. Expected output: 12/12 tests passing.

For a human-readable print-out of each tool's output, run the standalone script:

```bash
pnpm tsx scripts/smoke-mcp.ts
```

---

## Troubleshooting

### Server starts but Cursor does not list any tools

1. Make sure the path in `mcp.json` is absolute, not relative.
2. Make sure `pnpm build` ran after the last code change.
3. Check `dist/server.js` exists: `ls orchestratekit-mcp/dist/`.
4. Restart Cursor fully (not just the window — use *File → Quit*).

### "MODULE_NOT_FOUND" error on startup

The build copies `registry/` to `dist/registry/`. If the error mentions a YAML
file, run `pnpm build` again and verify `dist/registry/` exists.

### Claude Desktop shows a spinning icon but no tools

The Claude Desktop MCP process runs in a separate sandbox. Check:

1. Absolute path is correct (no `~` expansion — use the full path).
2. Node 20+ is on the system `PATH` (not just your shell profile).
   Test with: `which node` (macOS/Linux) or `where node` (Windows).
3. On Windows, prefer `C:/path/to/node.exe` as the `command` if `node` is not
   on the system `PATH`.

### Tools return unexpected errors

Run `pnpm verify` from the project root. All 47+ tests should pass. If any fail,
the error message identifies which registry file or logic is broken.
