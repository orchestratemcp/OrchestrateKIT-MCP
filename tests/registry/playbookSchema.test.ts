import { describe, it, expect } from "vitest";
import { PlaybookSchema } from "../../src/registry/playbookSchema.js";

const validPlaybook = {
  id: "research_agent_citations",
  version: "0.1.0",
  status: "published",
  title: "Research Agent with Citations",
  summary: "Research workflow with source citations.",
  workflow_type: "research",
  golden_path_route_id: "research_route_v1",
  stack_id: "default_local",
  risk_level: "low",
};

describe("PlaybookSchema", () => {
  it("accepts a minimal valid playbook", () => {
    const result = PlaybookSchema.safeParse(validPlaybook);
    expect(result.success).toBe(true);
  });

  it("defaults array fields to empty", () => {
    const result = PlaybookSchema.safeParse(validPlaybook);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.components).toEqual([]);
    expect(result.data.failure_modes).toEqual([]);
    expect(result.data.evals).toEqual([]);
    expect(result.data.guardrails).toEqual([]);
  });

  it("accepts recommended_architecture when present", () => {
    const result = PlaybookSchema.safeParse({
      ...validPlaybook,
      recommended_architecture: { pattern: "sequential", why: "Simpler and testable." },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field: title", () => {
    const result = PlaybookSchema.safeParse({ ...validPlaybook, title: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects invalid playbook status", () => {
    const result = PlaybookSchema.safeParse({ ...validPlaybook, status: "active" });
    expect(result.success).toBe(false);
  });

  it("accepts the 'candidate' status unique to playbooks", () => {
    const result = PlaybookSchema.safeParse({ ...validPlaybook, status: "candidate" });
    expect(result.success).toBe(true);
  });
});
