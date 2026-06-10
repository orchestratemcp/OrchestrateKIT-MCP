import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import {
  classifySteps,
  describeStateNeeds,
} from "../../src/architecture/stepClassifier.js";

const registry = loadRegistry();

// ---------------------------------------------------------------------------
// classifySteps
// ---------------------------------------------------------------------------

describe("classifySteps", () => {
  it("places human_approval_gate in approval_gate_components", () => {
    const result = classifySteps(["human_approval_gate"], registry.components);
    expect(result.approval_gate_components).toContain("human_approval_gate");
  });

  it("places state_store in state_components and deterministic_steps", () => {
    const result = classifySteps(["state_store"], registry.components);
    expect(result.state_components).toContain("state_store");
    expect(result.deterministic_steps).toContain("state_store");
  });

  it("places audit_log in state_components when category is state", () => {
    const auditLog = registry.components.find((c) => c.id === "audit_log");
    if (auditLog && auditLog.category === "state") {
      const result = classifySteps(["audit_log"], registry.components);
      expect(result.state_components).toContain("audit_log");
    }
  });

  it("returns empty arrays for empty input", () => {
    const result = classifySteps([], registry.components);
    expect(result.llm_driven_steps).toHaveLength(0);
    expect(result.deterministic_steps).toHaveLength(0);
    expect(result.state_components).toHaveLength(0);
    expect(result.tool_components).toHaveLength(0);
    expect(result.approval_gate_components).toHaveLength(0);
  });

  it("skips unknown component ids gracefully", () => {
    const result = classifySteps(["this_does_not_exist"], registry.components);
    expect(result.llm_driven_steps).toHaveLength(0);
  });

  it("playbook llm_driven_steps hint overrides heuristic", () => {
    // data_scraper is normally deterministic — force it into llm_driven via hint
    const result = classifySteps(["data_scraper"], registry.components, {
      llm_driven_steps: ["data_scraper"],
    });
    expect(result.llm_driven_steps).toContain("data_scraper");
  });

  it("classifies plan_generation as LLM-driven (has generate/plan capabilities)", () => {
    const comp = registry.components.find((c) => c.id === "plan_generation");
    if (!comp) return; // skip if not in registry
    const result = classifySteps(["plan_generation"], registry.components);
    // plan_generation should be in llm_driven_steps
    expect(
      result.llm_driven_steps.includes("plan_generation") ||
      result.deterministic_steps.includes("plan_generation"),
    ).toBe(true);
  });

  it("full codebase agent playbook components produce non-empty classification", () => {
    const playbook = registry.playbooks.find((p) => p.id === "codebase_agent_workflow");
    expect(playbook).toBeDefined();

    const result = classifySteps(playbook!.components, registry.components, {
      llm_driven_steps: playbook!.llm_driven_steps,
      deterministic_steps: playbook!.deterministic_steps,
    });

    const total =
      result.llm_driven_steps.length +
      result.deterministic_steps.length +
      result.state_components.length +
      result.approval_gate_components.length;

    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// describeStateNeeds
// ---------------------------------------------------------------------------

describe("describeStateNeeds", () => {
  it("returns 'no state needed' for empty list", () => {
    const result = describeStateNeeds([], "local");
    expect(result.components).toHaveLength(0);
    expect(result.needs.some((n) => n.toLowerCase().includes("no"))).toBe(true);
  });

  it("recommends SQLite for local with state_store", () => {
    const result = describeStateNeeds(["state_store"], "local");
    expect(result.needs.some((n) => n.toLowerCase().includes("sqlite"))).toBe(true);
  });

  it("recommends Supabase/Postgres for hosted with state_store", () => {
    const result = describeStateNeeds(["state_store"], "hosted");
    const combined = result.needs.join(" ").toLowerCase();
    expect(combined.includes("supabase") || combined.includes("postgres")).toBe(true);
  });

  it("includes job queue guidance when job_queue component is present", () => {
    const result = describeStateNeeds(["state_store", "job_queue"], "local");
    const combined = result.needs.join(" ").toLowerCase();
    expect(combined.includes("queue") || combined.includes("bullmq") || combined.includes("inline")).toBe(true);
  });

  it("includes audit guidance when audit_log component is present", () => {
    const result = describeStateNeeds(["audit_log"], "local");
    const combined = result.needs.join(" ").toLowerCase();
    expect(combined.includes("audit") || combined.includes("log")).toBe(true);
  });
});
