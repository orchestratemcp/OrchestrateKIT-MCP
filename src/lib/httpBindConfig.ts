export type HttpBindEnv = {
  HOST?: string;
  PORT?: string;
  ORCHESTRATEKIT_ALLOW_PUBLIC_BIND?: string;
};

export type HttpBindConfig = {
  host: string;
  port: number;
  publicBindAllowed: boolean;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PUBLIC_BIND_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function isPublicBindHost(host: string): boolean {
  return PUBLIC_BIND_HOSTS.has(host.trim().toLowerCase());
}

export function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function resolveHttpBindConfig(env: HttpBindEnv = process.env): HttpBindConfig {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT ?? "3001"}`);
  }

  const host = env.HOST ?? "127.0.0.1";
  const publicBindAllowed = parseBooleanFlag(env.ORCHESTRATEKIT_ALLOW_PUBLIC_BIND);

  if (isPublicBindHost(host) && !publicBindAllowed) {
    throw new Error(
      "Refusing to bind the HTTP MCP server to a public interface. " +
        "Use HOST=127.0.0.1 for local/tunnel use, or set " +
        "ORCHESTRATEKIT_ALLOW_PUBLIC_BIND=1 when a reverse proxy or hosting platform is intentionally fronting it.",
    );
  }

  return { host, port, publicBindAllowed };
}
