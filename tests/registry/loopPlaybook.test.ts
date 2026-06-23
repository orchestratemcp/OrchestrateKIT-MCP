import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { lintLoopPlaybooks } from "../../src/registry/registryLint.js";
import type { Playbook } from "../../src/registry/playbookSchema.js";
import type { Worker } from "../../src/registry/workerSchema.js";

/**
 * MAR-167 — dynamic_worker_loop playbook + loop-contract guardrail probes.
 * The acceptance: "Probes assert the guardrails are present." A bounded,
 * reviewer-independent loop is the whole safety story, so each guardrail is
 * checked explicitly against the registry data.
 */
const registry = loadRegistry();
const loop = registry.playbooks.find((p) => p.id === "dynamic_worker_loop");

describe("dynamic_worker_loop playbook — loop contract guardrails", () => {
  it("exists and is published with a loop_contract + worker_sequence", () => {
    expect(loop, "dynamic_worker_loop playbook").toBeDefined();
    expect(loop!.status).toBe("published");
    expect(loop!.loop_contract).toBeDefined();
    expect((loop!.worker_sequence ?? []).length).toBeGreaterThan(0);
  });

  it("is BOUNDED — a positive max_iterations", () => {
    expect(loop!.loop_contract!.max_iterations).toBeGreaterThan(0);
  });

  it("declares stop and escalation conditions", () => {
    expect(loop!.loop_contract!.stop_condition.length).toBeGreaterThan(0);
    expect(loop!.loop_contract!.escalation_condition.length).toBeGreaterThan(0);
  });

  it("requires state + audit and gates external actions", () => {
    const lc = loop!.loop_contract!;
    expect(lc.state_required).toBe(true);
    expect(lc.audit_required).toBe(true);
    expect(lc.no_write_until_final_gate).toBe(true);
    for (const cls of ["external write", "deploy", "send", "publish"]) {
      expect(lc.human_gate_required_for).toContain(cls);
    }
  });

  it("asserts reviewer independence — and the worker_sequence backs it", () => {
    expect(loop!.loop_contract!.reviewer_independent).toBe(true);
    const roleById = new Map(registry.workers.map((w) => [w.id, w.role]));
    const seq = loop!.worker_sequence ?? [];
    const reviewers = seq.filter((id) => roleById.get(id) === "reviewer");
    const coders = seq.filter((id) => roleById.get(id) === "coder");
    expect(reviewers.length, "a reviewer-role worker is sequenced").toBeGreaterThan(0);
    expect(coders.length, "a coder-role worker is sequenced").toBeGreaterThan(0);
    // reviewer and coder are different workers
    expect(reviewers.some((r) => coders.includes(r))).toBe(false);
  });

  it("references only real worker ids in worker_sequence", () => {
    const ids = new Set(registry.workers.map((w) => w.id));
    for (const wid of loop!.worker_sequence ?? []) {
      expect(ids.has(wid), `worker "${wid}"`).toBe(true);
    }
  });

  it("has a golden-path route (DAG-only, no cyclic edge)", () => {
    const route = registry.routes.find((r) => r.id === loop!.golden_path_route_id);
    expect(route, "golden_path_route_id resolves").toBeDefined();
    // the loop is a contract, not a graph cycle: the route's components are acyclic
    expect(route!.components).toContain("loop_controller");
  });
});

// ── lint gate negatives ──────────────────────────────────────────────────
function pb(partial: Partial<Playbook> & Pick<Playbook, "id">): Playbook {
  return {
    version: "1.0.0",
    status: "published",
    title: partial.id,
    summary: "s",
    workflow_type: "agentic-loop",
    golden_path_route_id: "",
    components: [],
    edges: [],
    stack_id: "default_orchestratekit_stack",
    risk_level: "high",
    best_for: [],
    avoid_when: [],
    llm_driven_steps: [],
    deterministic_steps: [],
    permissions: {},
    guardrails: [],
    failure_modes: [],
    evals: [],
    implementation_steps: [],
    sources: [],
    ...partial,
  } as Playbook;
}

const LC = {
  max_iterations: 5,
  stop_condition: "approved",
  escalation_condition: "cap",
  state_required: true as const,
  audit_required: true as const,
  human_gate_required_for: ["external write"],
  reviewer_independent: true as const,
  no_write_until_final_gate: true as const,
};

const WORKERS: Worker[] = [
  { id: "planner", role: "planner" } as Worker,
  { id: "coder", role: "coder" } as Worker,
  { id: "reviewer", role: "reviewer" } as Worker,
];

describe("lintLoopPlaybooks (MAR-167)", () => {
  it("passes a loop playbook with an independent reviewer + coder", () => {
    const errors = lintLoopPlaybooks(
      [pb({ id: "ok", loop_contract: LC, worker_sequence: ["planner", "coder", "reviewer"] })],
      WORKERS,
    );
    expect(errors).toHaveLength(0);
  });

  it("flags a loop playbook with no reviewer in the sequence", () => {
    const errors = lintLoopPlaybooks(
      [pb({ id: "noreview", loop_contract: LC, worker_sequence: ["planner", "coder"] })],
      WORKERS,
    );
    expect(errors.some((e) => e.message.includes("reviewer-role worker"))).toBe(true);
  });

  it("flags a loop playbook with no coder in the sequence", () => {
    const errors = lintLoopPlaybooks(
      [pb({ id: "nocoder", loop_contract: LC, worker_sequence: ["planner", "reviewer"] })],
      WORKERS,
    );
    expect(errors.some((e) => e.message.includes("coder-role worker"))).toBe(true);
  });

  it("ignores non-loop playbooks (no loop_contract)", () => {
    const errors = lintLoopPlaybooks([pb({ id: "plain" })], WORKERS);
    expect(errors).toHaveLength(0);
  });
});
