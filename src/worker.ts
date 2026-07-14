/**
 * OrchestrateMCP — Cloudflare Worker entry (Streamable HTTP, stateless).
 *
 * Same 18 tools as the Node servers, served from a filesystem-free runtime.
 * The registry and docs index are baked into the bundle at build time
 * (see scripts/gen-registry-bundle.ts) and injected into the providers below,
 * so no module in this import graph touches node:fs.
 *
 * Free, always-on, globally distributed — this is the intended public endpoint.
 * Deploy with `pnpm deploy:worker` (wrangler).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS } from "./config.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import {
  setRegistryLoader,
  setBuildInfoProvider,
} from "./registry/registryProvider.js";
import {
  loadRegistryBundled,
  bundledBuildInfo,
} from "./registry/loadRegistryBundled.js";
import { setDocsIndexLoader } from "./docs-index/provider.js";
import { loadDocsIndexBundled } from "./docs-index/loadBundled.js";

// Wire the bundle-based data sources once per isolate.
setRegistryLoader(loadRegistryBundled);
setBuildInfoProvider(bundledBuildInfo);
setDocsIndexLoader(loadDocsIndexBundled);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

function withCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return h;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          server: SERVER_NAME,
          version: SERVER_VERSION,
          transport: "streamable-http-worker",
          mcp_endpoint: `${url.origin}/mcp`,
        }),
        { status: 200, headers: withCors({ "Content-Type": "application/json" }) },
      );
    }

    if (url.pathname === "/mcp") {
      // Stateless: a fresh server + transport per request (the SDK forbids
      // reusing a stateless transport across requests).
      const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { instructions: SERVER_INSTRUCTIONS },
      );
      registerTools(server);
      registerResources(server);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);

      const response = await transport.handleRequest(request);
      // Re-emit with CORS headers (preserves SSE streaming body + status).
      return new Response(response.body, {
        status: response.status,
        headers: withCors(response.headers),
      });
    }

    return new Response(
      JSON.stringify({ error: "Not found", hint: "MCP endpoint is at /mcp" }),
      { status: 404, headers: withCors({ "Content-Type": "application/json" }) },
    );
  },
};
