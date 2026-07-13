import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT } from "./runtimePaths.js";

// Minimal .env loader (side-effect import, first in run.ts) so the agent
// picks up whatever scripts/connect.mjs wrote — zero-dependency on purpose,
// same as the connect script itself. Real environment variables win over
// .env values, matching dotenv semantics.
const envPath = path.join(AGENT_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
