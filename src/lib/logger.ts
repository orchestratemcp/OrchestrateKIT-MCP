// All output goes to stderr — stdout is reserved for MCP JSON-RPC transport.

const isDebug =
  process.env["DEBUG"] === "true" ||
  process.env["DEBUG"] === "orchestratekit";

export const logger = {
  info(msg: string): void {
    process.stderr.write(`[orchestratekit-mcp] INFO  ${msg}\n`);
  },

  debug(msg: string): void {
    if (isDebug) {
      process.stderr.write(`[orchestratekit-mcp] DEBUG ${msg}\n`);
    }
  },

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `: ${err.message}` : "";
    process.stderr.write(`[orchestratekit-mcp] ERROR ${msg}${detail}\n`);
  },
};
