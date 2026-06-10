import { describe, it, expect } from "vitest";
import {
  buildHealthCheckResult,
  type HealthCheckResult,
  type RegistrySummary,
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

  it("registry counts meet MAR-38 minimum seed targets", () => {
    const r = buildHealthCheckResult().registry;
    expect(r.component_count, "components").toBeGreaterThanOrEqual(20);
    expect(r.edge_count, "edges").toBeGreaterThanOrEqual(40);
    expect(r.stack_count, "stacks").toBeGreaterThanOrEqual(1);
    expect(r.route_count, "routes").toBeGreaterThanOrEqual(5);
    expect(r.playbook_count, "playbooks").toBeGreaterThanOrEqual(5);
  });

  it("result is JSON-serialisable and round-trips cleanly", () => {
    const result = buildHealthCheckResult();
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as HealthCheckResult;
    expect(parsed.name).toBe(SERVER_NAME);
    expect(parsed.version).toBe(SERVER_VERSION);
    expect(parsed.registry.component_count).toBeGreaterThanOrEqual(20);
  });
});
