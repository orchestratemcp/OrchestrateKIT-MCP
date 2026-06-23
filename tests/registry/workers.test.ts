import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { isWriteTool } from "../../src/registry/workerSchema.js";
import type { Worker } from "../../src/registry/workerSchema.js";

/**
 * MAR-166 — per-worker contract probes. The acceptance criterion is "probes for
 * each worker's contract": each worker must honour the safe-contract invariants
 * its role implies (planner forbidden from write tools, coder may write but not
 * ship, reviewer never mutates, tester never edits source) and the build team
 * must form a planner → coder → reviewer → tester handoff chain.
 */
const registry = loadRegistry();
const workers = registry.workers;
const byId = new Map(workers.map((w) => [w.id, w]));

function get(id: string): Worker {
  const w = byId.get(id);
  if (!w) throw new Error(`worker "${id}" not in registry`);
  return w;
}

describe("worker registry — starter set", () => {
  it("ships the four starter workers", () => {
    expect(byId.has("planner")).toBe(true);
    expect(byId.has("coder")).toBe(true);
    expect(byId.has("reviewer")).toBe(true);
    expect(byId.has("tester")).toBe(true);
  });

  it("every worker declares a handoff contract (inputs + outputs)", () => {
    for (const w of workers) {
      expect(w.inputs.length, `${w.id}.inputs`).toBeGreaterThan(0);
      expect(w.outputs.length, `${w.id}.outputs`).toBeGreaterThan(0);
      expect(w.quality_gates.length, `${w.id}.quality_gates`).toBeGreaterThan(0);
      expect(w.evals.length, `${w.id}.evals`).toBeGreaterThan(0);
    }
  });

  it("no worker lists a tool as both allowed and forbidden", () => {
    for (const w of workers) {
      const allowed = new Set(w.allowed_tools);
      for (const t of w.forbidden_tools) {
        expect(allowed.has(t), `${w.id} allows+forbids "${t}"`).toBe(false);
      }
    }
  });
});

describe("planner contract", () => {
  const planner = get("planner");

  it("is forbidden from write tools (read + reason only)", () => {
    expect(planner.allowed_tools.some(isWriteTool)).toBe(false);
    expect(planner.forbidden_tools.length).toBeGreaterThan(0);
  });

  it("hands off to the coder", () => {
    expect(planner.handoff_to).toContain("coder");
  });

  it("uses the frontier tier for design judgement", () => {
    expect(planner.model_tier).toBe("frontier");
  });
});

describe("coder contract", () => {
  const coder = get("coder");

  it("may write code", () => {
    expect(coder.allowed_tools.some(isWriteTool)).toBe(true);
  });

  it("may not ship — deploy / publish are forbidden", () => {
    expect(coder.forbidden_tools).toContain("deploy");
    expect(coder.forbidden_tools).toContain("external_publish");
  });

  it("hands off to the reviewer", () => {
    expect(coder.handoff_to).toContain("reviewer");
  });
});

describe("reviewer contract", () => {
  const reviewer = get("reviewer");

  it("never mutates the tree (no write tools allowed)", () => {
    expect(reviewer.allowed_tools.some(isWriteTool)).toBe(false);
    expect(reviewer.forbidden_tools).toContain("file_write");
  });

  it("can advance to the tester and loop back to the coder", () => {
    expect(reviewer.handoff_to).toContain("tester");
    expect(reviewer.handoff_to).toContain("coder");
  });
});

describe("tester contract", () => {
  const tester = get("tester");

  it("never edits source (no write tools allowed)", () => {
    expect(tester.allowed_tools.some(isWriteTool)).toBe(false);
    expect(tester.forbidden_tools).toContain("code_write");
  });

  it("closes the fix loop back to the coder", () => {
    expect(tester.handoff_to).toContain("coder");
  });

  it("runs on the cheap small tier (deterministic test running)", () => {
    expect(tester.model_tier).toBe("small");
  });
});
