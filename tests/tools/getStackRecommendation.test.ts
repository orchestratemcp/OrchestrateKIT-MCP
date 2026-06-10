import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";

describe("get_stack_recommendation — registry data", () => {
  const registry = loadRegistry();

  it("default stack exists in registry", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
  });

  it("default stack has choices defined", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    expect(Object.keys(stack!.choices).length).toBeGreaterThan(0);
  });

  it("stack choices include app_framework and state_store", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    const choiceKeys = Object.keys(stack!.choices);
    expect(choiceKeys).toContain("app_framework");
    expect(choiceKeys).toContain("state_store");
  });

  it("stack has best_for and avoid_when lists", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    expect(stack!.best_for.length).toBeGreaterThan(0);
    expect(stack!.avoid_when.length).toBeGreaterThan(0);
  });

  it("stack has at least one tradeoff", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    expect(stack!.tradeoffs.length).toBeGreaterThan(0);
  });

  it("stack summary mentions SQLite or local", () => {
    const stack = registry.stacks.find((s) => s.id === "default_orchestratekit_stack");
    expect(stack).toBeDefined();
    const summary = stack!.summary.toLowerCase();
    expect(summary.includes("sqlite") || summary.includes("local")).toBe(true);
  });
});
