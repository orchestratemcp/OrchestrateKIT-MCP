import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { composeWorkerPipeline } from "../../src/graph/workerPipeline.js";
import type { Worker } from "../../src/registry/workerSchema.js";

const registry = loadRegistry();

function worker(partial: Partial<Worker> & Pick<Worker, "id" | "role">): Worker {
  return {
    version: "1.0.0",
    status: "published",
    title: partial.id,
    summary: "test worker",
    best_for: [],
    inputs: ["in"],
    outputs: ["out"],
    allowed_tools: [],
    forbidden_tools: [],
    handoff_to: [],
    model_tier: "standard",
    quality_gates: ["g"],
    evals: ["e"],
    sources: [],
    ...partial,
  } as Worker;
}

describe("composeWorkerPipeline", () => {
  it("orders the real registry workers planner → coder → reviewer → tester", () => {
    const pipeline = composeWorkerPipeline(registry.workers);
    const ids = pipeline.workers.map((w) => w.worker_id);
    expect(ids).toEqual(["planner", "coder", "reviewer", "tester"]);
    expect(pipeline.workers.map((w) => w.step)).toEqual([1, 2, 3, 4]);
  });

  it("emits forward handoffs for the build chain", () => {
    const pipeline = composeWorkerPipeline(registry.workers);
    const fwd = pipeline.handoffs.map((h) => `${h.from}->${h.to}`);
    expect(fwd).toContain("planner->coder");
    expect(fwd).toContain("coder->reviewer");
    expect(fwd).toContain("reviewer->tester");
  });

  it("classifies a backward handoff as a fix loop, not a forward step", () => {
    const pipeline = composeWorkerPipeline(registry.workers);
    const loops = pipeline.feedback_loops.map((h) => `${h.from}->${h.to}`);
    // tester → coder and reviewer → coder are fix loops, not pipeline order.
    expect(loops).toContain("tester->coder");
    // and they must NOT appear as forward handoffs
    expect(pipeline.handoffs.map((h) => `${h.from}->${h.to}`)).not.toContain("tester->coder");
  });

  it("attaches the outputs→inputs contract to each handoff", () => {
    const pipeline = composeWorkerPipeline(registry.workers);
    for (const h of pipeline.handoffs) {
      expect(h.contract).toBe(`${h.from}.outputs → ${h.to}.inputs`);
    }
  });

  it("is deterministic and ignores worker array order", () => {
    const a = composeWorkerPipeline(registry.workers);
    const b = composeWorkerPipeline([...registry.workers].reverse());
    expect(b.workers.map((w) => w.worker_id)).toEqual(a.workers.map((w) => w.worker_id));
  });

  it("returns an empty pipeline for no workers", () => {
    const pipeline = composeWorkerPipeline([]);
    expect(pipeline.workers).toEqual([]);
    expect(pipeline.handoffs).toEqual([]);
    expect(pipeline.feedback_loops).toEqual([]);
  });

  it("drops handoffs to unknown worker ids", () => {
    const workers = [
      worker({ id: "planner", role: "planner", handoff_to: ["coder", "ghost"] }),
      worker({ id: "coder", role: "coder", handoff_to: [] }),
    ];
    const pipeline = composeWorkerPipeline(workers);
    const targets = pipeline.handoffs.map((h) => h.to);
    expect(targets).toContain("coder");
    expect(targets).not.toContain("ghost");
  });
});
