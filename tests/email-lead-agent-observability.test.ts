import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDashEvent,
  type DashEventType,
} from "../examples/email-lead-agent/src/dash.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as new (opts?: object) => {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown };
};
const addFormats = require("ajv-formats") as (ajv: object) => void;

const fixtureRoot = path.resolve("tests/fixtures/dash");
function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureRoot, relativePath), "utf-8"));
}
function semanticSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateManifest = ajv.compile(
  loadJson("agent.manifest.schema.json") as object,
);
const validateEvent = ajv.compile(loadJson("run-event.schema.json") as object);

describe("MAR-363 telemetry producer conformance", () => {
  it("locks both canonical DASH v1 schema fingerprints", () => {
    const lock = loadJson("contract.lock.json") as {
      version: number;
      schema_semantic_sha256: Record<string, string>;
    };
    expect(lock.version).toBe(1);
    for (const [file, expected] of Object.entries(lock.schema_semantic_sha256)) {
      expect(semanticSha256(loadJson(file)), file).toBe(expected);
    }
  });

  it("builds every event in the canonical MAR-363 sequence with the v1 shape", () => {
    const manifest = loadJson("conformance/v1/mar-363.agent.manifest.json");
    const events = loadJson("conformance/v1/mar-363.run-events.json") as Array<{
      run_id: string;
      seq: number;
      ts: string;
      type: DashEventType;
      component_id?: string;
      detail?: string;
    }>;
    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true);

    for (const expected of events) {
      const produced = buildDashEvent(
        expected.run_id,
        expected.type,
        expected.seq,
        expected.component_id,
        expected.detail,
        expected.ts,
      );
      expect(validateEvent(produced), JSON.stringify(validateEvent.errors)).toBe(true);
      expect(produced).toMatchObject({
        event_version: 1,
        agent: "email-lead-crm-slack-agent",
        run_id: expected.run_id,
        seq: expected.seq,
        ts: expected.ts,
        type: expected.type,
      });
    }
  });

  it("rejects the legacy event/event-without-agent shape", () => {
    const valid = validateEvent({
      event: "run_started",
      run_id: "legacy-run",
      ts: "2026-07-13T09:00:00Z",
    });
    expect(valid).toBe(false);
  });
});
