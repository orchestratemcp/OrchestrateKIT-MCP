import { describe, it, expect } from "vitest";
import { getDoNotBuildRules } from "../../src/architecture/doNotBuildRules.js";

// ---------------------------------------------------------------------------
// getDoNotBuildRules
// ---------------------------------------------------------------------------

describe("getDoNotBuildRules — approval gate rules", () => {
  it("warns when external_publish is present without human_approval_gate", () => {
    const rules = getDoNotBuildRules({
      goal: "publish blog posts",
      componentIds: ["content_generation", "external_publish"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("publish") || r.toLowerCase().includes("approval"))).toBe(true);
  });

  it("does NOT warn about missing approval gate when human_approval_gate is present", () => {
    const rules = getDoNotBuildRules({
      goal: "publish blog posts",
      componentIds: ["content_generation", "external_publish", "human_approval_gate"],
    });
    const approvalWarning = rules.find(
      (r) => r.includes("Do not publish") || r.includes("human_approval_gate"),
    );
    expect(approvalWarning).toBeUndefined();
  });

  it("warns for critical risk without approval gate", () => {
    const rules = getDoNotBuildRules({
      goal: "send emails to customers",
      componentIds: ["intent_classifier"],
      riskLevel: "critical",
    });
    expect(rules.some((r) => r.toLowerCase().includes("critical") || r.toLowerCase().includes("approval"))).toBe(true);
  });

  it("does NOT warn for critical risk when approval gate is present", () => {
    const rules = getDoNotBuildRules({
      goal: "send emails",
      componentIds: ["optional_email_send", "human_approval_gate"],
      riskLevel: "critical",
    });
    const criticalWithoutGate = rules.find((r) => r.includes("Risk level is `critical`"));
    expect(criticalWithoutGate).toBeUndefined();
  });
});

describe("getDoNotBuildRules — data pipeline rules", () => {
  it("warns to not skip schema validation when data_scraper has no validation", () => {
    const rules = getDoNotBuildRules({
      goal: "scrape product data",
      componentIds: ["data_scraper"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("validat"))).toBe(true);
  });

  it("does NOT warn about validation when schema_validation is present", () => {
    const rules = getDoNotBuildRules({
      goal: "scrape product data",
      componentIds: ["data_scraper", "schema_validation"],
    });
    const validationWarning = rules.find((r) => r.includes("Do not skip schema validation"));
    expect(validationWarning).toBeUndefined();
  });

  it("warns about aggressive scraping when data_scraper is present", () => {
    const rules = getDoNotBuildRules({
      goal: "scrape job listings",
      componentIds: ["data_scraper"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("scrape") || r.toLowerCase().includes("robots"))).toBe(true);
  });
});

describe("getDoNotBuildRules — technology anti-patterns", () => {
  it("warns about vector DB for non-semantic workflows", () => {
    const rules = getDoNotBuildRules({
      goal: "scrape and store product data",
      componentIds: ["data_scraper", "schema_validation"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("vector"))).toBe(true);
  });

  it("does NOT warn about vector DB when goal mentions semantic search", () => {
    const rules = getDoNotBuildRules({
      goal: "semantic search over documents using vector embeddings",
      componentIds: ["source_retrieval"],
    });
    const vectorWarning = rules.find((r) => r.includes("Do not add a vector database"));
    expect(vectorWarning).toBeUndefined();
  });

  it("always warns about graph DB", () => {
    const rules = getDoNotBuildRules({
      goal: "any workflow",
      componentIds: ["source_retrieval"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("graph database"))).toBe(true);
  });

  it("warns about remote auth for local tools", () => {
    const rules = getDoNotBuildRules({
      goal: "local data pipeline",
      componentIds: ["data_scraper"],
      localOrHosted: "local",
    });
    expect(rules.some((r) => r.toLowerCase().includes("auth") || r.toLowerCase().includes("oauth"))).toBe(true);
  });

  it("does NOT warn about remote auth for hosted tools", () => {
    const rules = getDoNotBuildRules({
      goal: "hosted product",
      componentIds: ["data_scraper"],
      localOrHosted: "hosted",
    });
    const authWarning = rules.find((r) => r.includes("Do not add remote OAuth"));
    expect(authWarning).toBeUndefined();
  });
});

describe("getDoNotBuildRules — multi-agent warning", () => {
  it("warns against multi-agent swarm for small workflows", () => {
    const rules = getDoNotBuildRules({
      goal: "simple pipeline",
      componentIds: ["data_scraper", "schema_validation"],
      routeComponentCount: 3,
    });
    expect(rules.some((r) => r.toLowerCase().includes("multi-agent") || r.toLowerCase().includes("swarm"))).toBe(true);
  });

  it("does NOT warn against multi-agent when route has many components", () => {
    const rules = getDoNotBuildRules({
      goal: "complex pipeline",
      componentIds: Array.from({ length: 10 }, (_, i) => `component_${i}`),
      routeComponentCount: 10,
    });
    const swarmWarning = rules.find((r) => r.includes("Do not design this as a multi-agent swarm"));
    expect(swarmWarning).toBeUndefined();
  });
});

describe("getDoNotBuildRules — playbook avoid_when passthrough", () => {
  it("includes playbook avoid_when items as guidance", () => {
    const rules = getDoNotBuildRules({
      goal: "research pipeline",
      componentIds: ["source_retrieval"],
      matchedPlaybookAvoidWhen: ["use for legal decisions without expert review"],
    });
    expect(rules.some((r) => r.includes("legal decisions"))).toBe(true);
  });

  it("deduplicates avoid_when items", () => {
    const rules = getDoNotBuildRules({
      goal: "research pipeline",
      componentIds: ["source_retrieval"],
      matchedPlaybookAvoidWhen: [
        "use for legal decisions without expert review",
        "use for legal decisions without expert review",
      ],
    });
    const legalItems = rules.filter((r) => r.includes("legal decisions"));
    expect(legalItems).toHaveLength(1);
  });
});

describe("getDoNotBuildRules — research safety", () => {
  it("warns when research workflow goal mentions medical decisions", () => {
    const rules = getDoNotBuildRules({
      goal: "research pipeline for medical diagnosis",
      componentIds: ["research_synthesis", "citation_checker"],
    });
    expect(rules.some((r) => r.toLowerCase().includes("medical") || r.toLowerCase().includes("high-stakes"))).toBe(true);
  });

  it("does NOT warn about research safety for non-high-stakes goals", () => {
    const rules = getDoNotBuildRules({
      goal: "research competitive landscape for a SaaS product",
      componentIds: ["research_synthesis"],
    });
    const medicalWarning = rules.find((r) => r.includes("medical, legal or financial"));
    expect(medicalWarning).toBeUndefined();
  });
});
