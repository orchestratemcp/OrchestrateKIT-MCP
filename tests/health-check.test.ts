import { describe, it, expect } from "vitest";
import {
  buildHealthCheckResult,
  type HealthCheckResult,
  type RegistrySummary,
  type RegistryBuild,
} from "../src/tools/index.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/config.js";

describe("health_check tool", () => {
  it("returns the correct server name", () => {
    const result: HealthCheckResult = buildHealthCheckResult();
    expect(result.name).toBe(SERVER_NAME);
  });

  it("returns the correct server version", () => {
    const result = buildHealthCheckResult();
    expect(result.version).toBe(SERVER_VERSION);
  });

  it("returns a registry summary object", () => {
    const result = buildHealthCheckResult();
    expect(result.registry).toBeDefined();
    expect(typeof result.registry).toBe("object");
  });

  it("registry summary has all five count fields as non-negative numbers", () => {
    const r: RegistrySummary = buildHealthCheckResult().registry;
    const fields: (keyof RegistrySummary)[] = [
      "component_count",
      "edge_count",
      "stack_count",
      "route_count",
      "playbook_count",
    ];
    for (const field of fields) {
      expect(typeof r[field], field).toBe("number");
      expect(r[field], field).toBeGreaterThanOrEqual(0);
    }
  });

  it("registry summary includes untested_edge_pct (MAR-92)", () => {
    const r: RegistrySummary = buildHealthCheckResult().registry;
    expect(typeof r.untested_edge_pct).toBe("number");
    expect(r.untested_edge_pct).toBeGreaterThanOrEqual(0);
    expect(r.untested_edge_pct).toBeLessThanOrEqual(100);
  });

  // MAR-114: count floor regression — must never drop below post-MAR-95 baseline
  it("registry counts meet baseline (≥41 components, ≥72 edges after T3 integration components)", () => {
    const r = buildHealthCheckResult().registry;
    expect(r.component_count, "components (regression floor: 41 after pdf_extraction/airtable_lookup/stripe_data_read)").toBeGreaterThanOrEqual(41);
    expect(r.edge_count, "edges (regression floor: 72 after T3 integration edges)").toBeGreaterThanOrEqual(72);
    expect(r.stack_count, "stacks").toBeGreaterThanOrEqual(1);
    expect(r.route_count, "routes").toBeGreaterThanOrEqual(5);
    expect(r.playbook_count, "playbooks").toBeGreaterThanOrEqual(5);
  });

  // MAR-114: build fingerprint and stale-dist detection
  it("returns a build object with required fields", () => {
    const b: RegistryBuild = buildHealthCheckResult().build;
    expect(b).toBeDefined();
    expect(typeof b.fingerprint).toBe("string");
    expect(b.fingerprint.length).toBeGreaterThan(0);
    expect(typeof b.newest_mtime).toBe("string");
    expect(new Date(b.newest_mtime).getTime()).toBeGreaterThan(0);
    expect(typeof b.stale).toBe("boolean");
    expect(Array.isArray(b.stale_files)).toBe(true);
  });

  it("build.built_at is null in dev (tsx) mode — no _build_manifest.json in src registry", () => {
    // When running tests via tsx, defaultRegistryDir resolves to registry/ (source).
    // There is no _build_manifest.json there, so built_at must be null.
    const b = buildHealthCheckResult().build;
    expect(b.built_at).toBeNull();
  });

  it("build.stale is false in dev mode (built_at is null, nothing to compare against)", () => {
    const b = buildHealthCheckResult().build;
    if (b.built_at === null) {
      expect(b.stale).toBe(false);
      expect(b.stale_files).toHaveLength(0);
    }
  });

  it("build.fingerprint is stable across two calls with the same registry", () => {
    const a = buildHealthCheckResult().build.fingerprint;
    const b = buildHealthCheckResult().build.fingerprint;
    expect(a).toBe(b);
  });

  // MAR-141: process_started_at and process_stale fields
  it("build.process_started_at is a valid ISO timestamp", () => {
    const b = buildHealthCheckResult().build;
    expect(typeof b.process_started_at).toBe("string");
    expect(new Date(b.process_started_at).getTime()).toBeGreaterThan(0);
  });

  it("build.process_stale is false in dev mode (built_at is null)", () => {
    const b = buildHealthCheckResult().build;
    if (b.built_at === null) {
      expect(b.process_stale).toBe(false);
    }
  });

  it("build.process_stale is boolean", () => {
    const b = buildHealthCheckResult().build;
    expect(typeof b.process_stale).toBe("boolean");
  });

  it("result is JSON-serialisable and round-trips cleanly", () => {
    const result = buildHealthCheckResult();
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as HealthCheckResult;
    expect(parsed.name).toBe(SERVER_NAME);
    expect(parsed.version).toBe(SERVER_VERSION);
    expect(parsed.registry.component_count).toBeGreaterThanOrEqual(32);
    expect(parsed.build.fingerprint.length).toBeGreaterThan(0);
  });
});
