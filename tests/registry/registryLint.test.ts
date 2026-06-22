import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  lintRegistry,
  computeBrainCompletionPct,
  lintNoByteOrderMark,
} from "../../src/registry/registryLint.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_REGISTRY = join(__dirname, "fixtures");

describe("registry:lint — production registry (MAR-94)", () => {
  it("passes all lint rules on the main registry", () => {
    const result = lintRegistry();
    if (!result.ok) {
      const msgs = result.errors.map((e) => `[${e.entity}] ${e.field}: ${e.message}`).join("\n");
      expect.fail(`Registry lint failed:\n${msgs}`);
    }
    expect(result.ok).toBe(true);
  });

  it("reports brain completion percentages for L0–L4", () => {
    const result = lintRegistry();
    expect(result.brain_completion_pct.L0).toBeGreaterThanOrEqual(0);
    expect(result.brain_completion_pct.L4).toBeLessThanOrEqual(100);
    expect(result.component_count).toBeGreaterThanOrEqual(20);
  });

  it("no edge has tested:true without test_refs", () => {
    const registry = loadRegistry({ includeBeta: true });
    for (const edge of registry.edges) {
      if (edge.tested) {
        expect(edge.test_refs.length, edge.id).toBeGreaterThan(0);
      }
    }
  });

  it("routes parse sources field (MAR-94)", () => {
    const registry = loadRegistry();
    const route = registry.routes.find((r) => r.id === "research_route_v1");
    expect(route).toBeDefined();
    expect(Array.isArray(route!.sources)).toBe(true);
    expect(Array.isArray(route!.failure_modes)).toBe(true);
  });
});

describe("registry:lint — fixture registry", () => {
  it("passes on test fixtures", () => {
    const result = lintRegistry({ registryDir: FIXTURES_REGISTRY });
    expect(result.ok).toBe(true);
  });
});

describe("registry:lint — UTF-8 BOM hygiene gate (MAR-160)", () => {
  it("the production registry has no BOM-prefixed YAML files", () => {
    const errors = lintNoByteOrderMark(join(process.cwd(), "registry"));
    const msgs = errors.map((e) => `[${e.entity}] ${e.message}`).join("\n");
    expect(errors, msgs).toHaveLength(0);
  });

  it("flags a YAML file that begins with a UTF-8 BOM", () => {
    const dir = mkdtempSync(join(tmpdir(), "ok-bom-"));
    try {
      mkdirSync(join(dir, "components"));
      // EF BB BF + valid YAML body
      writeFileSync(
        join(dir, "components", "bommed.component.yaml"),
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id: bommed\n")]),
      );
      writeFileSync(join(dir, "components", "clean.component.yaml"), "id: clean\n");

      const errors = lintNoByteOrderMark(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0].entity).toBe("components:bommed.component.yaml");
      expect(errors[0].field).toBe("encoding");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("computeBrainCompletionPct", () => {
  it("returns 0% for empty component list", () => {
    const pct = computeBrainCompletionPct([]);
    expect(pct.L0).toBe(0);
  });
});
