import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = path.resolve(here, "..");
export const RUNTIME_DIR = path.join(AGENT_ROOT, "runtime");
export const FIXTURES_DIR = path.join(AGENT_ROOT, "fixtures");

export const PATHS = {
  leadsFixture: path.join(FIXTURES_DIR, "leads.json"),
  auditLog: path.join(RUNTIME_DIR, "audit.jsonl"),
  dashEvents: path.join(RUNTIME_DIR, "dash_events.jsonl"),
  crmNotes: path.join(RUNTIME_DIR, "crm_notes.json"),
  slackOutbox: path.join(RUNTIME_DIR, "slack_outbox.jsonl"),
  outboundDrafts: path.join(RUNTIME_DIR, "outbound_drafts.jsonl"),
  approvals: path.join(RUNTIME_DIR, "approvals.json"),
  processedIds: path.join(RUNTIME_DIR, "processed_ids.json"),
  killSwitch: path.join(RUNTIME_DIR, "KILL_SWITCH"),
};

export function ensureRuntimeDir(): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

export function appendJsonLine(filePath: string, obj: unknown): void {
  ensureRuntimeDir();
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

export function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw) as T[];
}

export function writeJson(filePath: string, obj: unknown): void {
  ensureRuntimeDir();
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}
