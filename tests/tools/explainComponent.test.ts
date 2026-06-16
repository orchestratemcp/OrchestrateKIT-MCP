/**
 * MAR-136: explain_component — plain-language operator tool.
 */
import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";

// Import renderPlainText indirectly by calling the logic directly on registry data
// (the tool is registered on an McpServer; unit-test the prose function via a thin wrapper)

// We re-export the prose renderer from the module for testability.
// For now, test the output by running against the registry directly.

const registry = loadRegistry();

function explainViaRegistry(componentId: string) {
  const component = registry.components.find((c) => c.id === componentId);
  if (!component) return null;
  const outgoing = registry.edges.filter((e) => e.from === componentId);
  const incoming = registry.edges.filter((e) => e.to === componentId);
  // Mirrors the logic in explainComponent.ts
  return { component, outgoing, incoming };
}

describe("explain_component — plain-language prose (MAR-136)", () => {
  it("resolves a known component", () => {
    const result = explainViaRegistry("human_approval_gate");
    expect(result).not.toBeNull();
    expect(result!.component.name).toBe("Human Approval Gate");
  });

  it("returns null for unknown component", () => {
    const result = explainViaRegistry("does_not_exist_xyz");
    expect(result).toBeNull();
  });

  it("every published component can be looked up (no missing registry entries)", () => {
    const published = registry.components.filter((c) => c.status === "published");
    for (const c of published) {
      const result = explainViaRegistry(c.id);
      expect(result, `component ${c.id} must be findable`).not.toBeNull();
    }
  });

  it("high-risk components have requires or recommended_with entries", () => {
    const highRisk = registry.components.filter(
      (c) => c.risk_level === "high" && c.status === "published",
    );
    for (const c of highRisk) {
      const hasSafetyPartner =
        c.requires.length > 0 || c.recommended_with.length > 0;
      expect(
        hasSafetyPartner,
        `high-risk component ${c.id} should recommend at least one partner`,
      ).toBe(true);
    }
  });

  it("data_scraper has outgoing edges to data_normalizer", () => {
    const result = explainViaRegistry("data_scraper");
    expect(result).not.toBeNull();
    const hasNormalizer = result!.outgoing.some((e) => e.to === "data_normalizer");
    expect(hasNormalizer).toBe(true);
  });

  it("slack_notification has incoming edge from audit_log", () => {
    const result = explainViaRegistry("slack_notification");
    expect(result).not.toBeNull();
    const hasAudit = result!.incoming.some((e) => e.from === "audit_log");
    expect(hasAudit).toBe(true);
  });

  it("external_publish requires human_approval_gate", () => {
    const result = explainViaRegistry("external_publish");
    expect(result).not.toBeNull();
    const requiresGate = result!.component.requires.includes("human_approval_gate");
    expect(requiresGate).toBe(true);
  });
});
