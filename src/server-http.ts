/**
 * MAR-111: OrchestrateKit MCP — HTTP (Streamable HTTP) transport server.
 *
 * Exposes the same 17 tools as the stdio server over the MCP Streamable HTTP
 * protocol so remote clients (ChatGPT Actions, Claude Cowork, Cursor remote,
 * etc.) can connect without a local process spawn.
 *
 * Usage:
 *   pnpm start:http             # listens on http://127.0.0.1:3001/mcp
 *   PORT=4000 pnpm start:http   # custom port
 *   HOST=0.0.0.0 pnpm start:http   # bind all interfaces (behind ngrok/tunnel)
 *
 * ChatGPT / OpenAI GPT Actions: point to https://<tunnel>/mcp
 * Claude Projects (Cowork):     same URL — uses POST + optional SSE GET
 *
 * Transport mode: STATELESS (sessionIdGenerator: undefined).
 * Each request is handled independently — no persistent server-side session.
 * This is the correct mode for hosted / remote clients.
 *
 * Security note: this server has no auth built in. When exposing via a tunnel
 * (ngrok / Cloudflare Tunnel / etc.), add an API-key header check or OAuth
 * layer in front — the MCP spec supports bearer tokens via the Authorization
 * header, but OrchestrateKit has no secrets to protect (read-only advisory).
 */

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS } from "./config.js";
import { registerTools } from "./tools/index.js";
import { logger } from "./lib/logger.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server);

  // Stateless transport: no session tracking — each request is self-contained.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    // CORS — allow all origins (OrchestrateKit is read-only advisory; no secrets)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = req.url ?? "/";

    // Health check endpoint — useful for tunnel health probes and uptime monitoring.
    if (url === "/" || url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          status: "ok",
          server: SERVER_NAME,
          version: SERVER_VERSION,
          transport: "streamable-http",
          mcp_endpoint: `http://${HOST}:${PORT}/mcp`,
        }),
      );
      return;
    }

    // MCP endpoint — all Streamable HTTP MCP methods (POST, GET/SSE, DELETE)
    if (url === "/mcp") {
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        logger.error("HTTP transport error", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" }).end(
            JSON.stringify({ error: "Internal server error" }),
          );
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        error: "Not found",
        hint: `MCP endpoint is at /mcp`,
      }),
    );
  });

  httpServer.listen(PORT, HOST, () => {
    process.stderr.write(
      `${SERVER_NAME} v${SERVER_VERSION} HTTP MCP server\n` +
        `  MCP endpoint: http://${HOST}:${PORT}/mcp\n` +
        `  Health check: http://${HOST}:${PORT}/health\n`,
    );
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    httpServer.close();
    void transport.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    httpServer.close();
    void transport.close();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
