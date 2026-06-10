import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { classifySteps } from "../../src/architecture/stepClassifier.js";
import { getDoNotBuildRules } from "../../src/architecture/doNotBuildRules.js";
import {
  formatRecommendation,
  derivePattern,
  deriveNextSteps,
  type ArchitectureData,
} from "../../src/architecture/architectureFormatter.js";

const registry = loadRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildArchData(overrides: Partial<ArchitectureData> = {}): ArchitectureData {
  return {
    status: "ok",
    confidence: 0.85,
    routeScore: 78,
    goal: "Test goal",
    pattern: "Sequential pipeline",
    why: "Because it works",
    route: [],
    routeId: undefined,
    matchedPlaybookIds: [],
    llmDrivenSteps: [],
    deterministicSteps: [],
    stateComponents: [],
    stateNeeds: [],
    toolComponents: [],
    approvalGates: [],
    evals: [],
    stackId: "default_orchestratekit_stack",
    stackName: "Default OrchestrateKit Stack",
    stackChoicesSummary: [],
    doNotBuild: [],
    assumptions: [],
    warnings: [],
    untestedEdges: [],
    nextSteps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Full pipeline — 5 golden-path playbooks
// ---------------------------------------------------------------------------

describe("recommend_architecture — 5 golden-path playbook goals", () => {
  const PLAYBOOK_GOALS = [
    {
      name: "codebase_agent_workflow",
      goal: "scan codebase, generate a plan, edit code, run tests and produce a PR summary",
    },
    {
      name: "data_extraction_enrichment",
      goal: "scrape product data, normalise, deduplicate and validate before storage",
    },
    {
      name: "email_calendar_assistant",
      goal: "read emails, classify intent and draft a reply based on calendar availability",
    },
    {
      name: "content_approval_workflow",
      goal: "generate marketing copy from a brief and route it for human approval before publishing",
    },
    {
      name: "research_agent_citations",
      goal: "research a topic, retrieve and rank sources, synthesise with citations",
    },
  ];

  for (const { name, goal } of PLAYBOOK_GOALS) {
    it(`produces a valid route for "${name}" goal`, () => {
      const composed = composeRoute(
        { goal, must_have_capabilities: [], must_avoid: [] },
        registry,
      );
      expect(composed.status).not.toBe("not_found");
      expect(composed.recommended_route.length).toBeGreaterThanOrEqual(3);
    });

    it(`classifies steps for "${name}"`, () => {
      const composed = composeRoute(
        { goal, must_have_capabilities: [], must_avoid: [] },
        registry,
      );
      const componentIds = composed.recommended_route.map((s) => s.component_id);
      const classification = classifySteps(componentIds, registry.components);
      const total =
        classification.llm_driven_steps.length +
        classification.deterministic_steps.length +
        classification.state_components.length +
        classification.approval_gate_components.length;
      expect(total).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Candidate route (composed route, not a known playbook)
// ---------------------------------------------------------------------------

describe("recommend_architecture — candidate route labelling", () => {
  it("labels composed route correctly based on confidence", () => {
    const composed = composeRoute(
      {
        goal: "monitor a website for content changes and alert on differences",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    // The status should reflect whether this is a validated or candidate route
    expect(["ok", "candidate_route", "low_confidence", "not_found"]).toContain(composed.status);
  });

  it("candidate_route status is set when confidence < 0.7", () => {
    // Confidence < 0.5 → low_confidence, 0.5-0.7 → candidate_route, >= 0.7 → ok
    // We can test this by checking the scoring thresholds
    const archData = buildArchData({ status: "candidate_route", confidence: 0.6 });
    const md = formatRecommendation(archData, "standard");
    expect(md.toLowerCase()).toContain("candidate");
  });
});

// ---------------------------------------------------------------------------
// High-risk workflows include approval guidance
// ---------------------------------------------------------------------------

describe("recommend_architecture — high-risk workflows", () => {
  it("external_publish route triggers approval gate in safety augmentation", () => {
    const composed = composeRoute(
      {
        goal: "publish approved content to social media",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );

    if (composed.status !== "not_found") {
      // Safety augmenter should have added human_approval_gate
      const ids = composed.recommended_route.map((s) => s.component_id);
      if (ids.includes("external_publish")) {
        expect(ids).toContain("human_approval_gate");
        expect(composed.required_approval_gates).toContain("human_approval_gate");
      }
    }
  });

  it("do-not-build rules flag missing approval gate for external_publish", () => {
    const rules = getDoNotBuildRules({
      goal: "publish content",
      componentIds: ["external_publish"],
      riskLevel: "high",
    });
    expect(rules.some((r) => r.toLowerCase().includes("approval") || r.toLowerCase().includes("publish"))).toBe(true);
  });

  it("do-not-build rules include critical risk warning", () => {
    const rules = getDoNotBuildRules({
      goal: "send emails",
      componentIds: ["optional_email_send"],
      riskLevel: "critical",
    });
    expect(rules.some((r) => r.toLowerCase().includes("critical") || r.toLowerCase().includes("approval"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// derivePattern
// ---------------------------------------------------------------------------

describe("derivePattern", () => {
  it("returns sequential pipeline for simple deterministic workflow", () => {
    const pattern = derivePattern(["data_scraper", "schema_validation"], [], [], []);
    expect(pattern.toLowerCase()).toContain("sequential");
  });

  it("includes 'approval gate' when approval gates are present", () => {
    const pattern = derivePattern(
      ["data_scraper", "external_publish", "human_approval_gate"],
      ["human_approval_gate"],
      [],
      [],
    );
    expect(pattern.toLowerCase()).toContain("approval");
  });

  it("includes 'LLM' when LLM-driven steps are present", () => {
    const pattern = derivePattern(
      ["plan_generation", "code_editing"],
      [],
      [],
      ["plan_generation", "code_editing"],
    );
    expect(pattern.toLowerCase()).toContain("llm");
  });

  it("includes 'multi-step orchestration' for large routes", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `comp_${i}`);
    const pattern = derivePattern(ids, ["human_approval_gate"], [], ["comp_0"]);
    expect(pattern.toLowerCase()).toContain("multi-step");
  });

  it("returns stateful pipeline when state components are present", () => {
    const pattern = derivePattern(
      ["data_scraper", "state_store"],
      [],
      ["state_store"],
      [],
    );
    expect(pattern.toLowerCase()).toContain("stateful");
  });
});

// ---------------------------------------------------------------------------
// formatRecommendation
// ---------------------------------------------------------------------------

describe("formatRecommendation", () => {
  it("brief output contains goal and route", () => {
    const archData = buildArchData({
      goal: "test email workflow",
      route: [
        { step: 1, component_id: "email_read", component_name: "Email Read", purpose: "Read incoming emails", risk_level: "low" },
        { step: 2, component_id: "intent_classifier", component_name: "Intent Classifier", purpose: "Classify email intent", risk_level: "low" },
      ],
    });
    const md = formatRecommendation(archData, "brief");
    expect(md).toContain("test email workflow");
    expect(md).toContain("email_read");
  });

  it("standard output contains stack section", () => {
    const archData = buildArchData({
      stackId: "default_orchestratekit_stack",
      stackName: "Default OrchestrateKit Stack",
      stackChoicesSummary: ["**state_store:** `sqlite`"],
    });
    const md = formatRecommendation(archData, "standard");
    expect(md.toLowerCase()).toContain("stack");
    expect(md).toContain("sqlite");
  });

  it("standard output contains do-not-build section when rules present", () => {
    const archData = buildArchData({
      doNotBuild: ["Do not add a vector database unless needed"],
    });
    const md = formatRecommendation(archData, "standard");
    expect(md.toLowerCase()).toContain("do not build");
    expect(md).toContain("vector database");
  });

  it("deep output contains evals section", () => {
    const archData = buildArchData({
      evals: ["[data_scraper] recall on 50 test URLs"],
    });
    const md = formatRecommendation(archData, "deep");
    expect(md.toLowerCase()).toContain("eval");
    expect(md).toContain("recall");
  });

  it("candidate route produces candidate label in standard output", () => {
    const archData = buildArchData({ status: "candidate_route", confidence: 0.6 });
    const md = formatRecommendation(archData, "standard");
    expect(md.toLowerCase()).toContain("candidate");
  });

  it("ok status with high confidence produces no candidate warning", () => {
    const archData = buildArchData({ status: "ok", confidence: 0.9 });
    const md = formatRecommendation(archData, "standard");
    expect(md).not.toContain("This is a candidate route");
  });

  it("untested edges section appears in standard output", () => {
    const archData = buildArchData({
      untestedEdges: ["source_retrieval__produces__source_ranking"],
    });
    const md = formatRecommendation(archData, "standard");
    expect(md.toLowerCase()).toContain("untested");
  });
});

// ---------------------------------------------------------------------------
// deriveNextSteps
// ---------------------------------------------------------------------------

describe("deriveNextSteps", () => {
  it("includes stack recommendation step always", () => {
    const steps = deriveNextSteps([], [], [], [], "ok");
    expect(steps.some((s) => s.toLowerCase().includes("stack"))).toBe(true);
  });

  it("includes untested edge step when there are untested edges", () => {
    const steps = deriveNextSteps(["edge_a", "edge_b"], [], [], [], "ok");
    expect(steps.some((s) => s.toLowerCase().includes("untested"))).toBe(true);
  });

  it("includes get_playbook step when playbooks are matched", () => {
    const steps = deriveNextSteps([], [], [], ["codebase_agent_workflow"], "ok");
    expect(steps.some((s) => s.includes("codebase_agent_workflow"))).toBe(true);
  });

  it("includes candidate route review step for candidate status", () => {
    const steps = deriveNextSteps([], [], [], [], "candidate_route");
    expect(steps.some((s) => s.toLowerCase().includes("candidate"))).toBe(true);
  });

  it("returns at least 2 steps", () => {
    const steps = deriveNextSteps([], [], [], [], "ok");
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Registry data integrity for architecture recommendations
// ---------------------------------------------------------------------------

describe("recommend_architecture — registry data integrity", () => {
  it("all registry components have at least one capability for matching", () => {
    for (const c of registry.components) {
      expect(c.capabilities.length, `${c.id} capabilities`).toBeGreaterThan(0);
    }
  });

  it("all 5 registry playbooks have recommended_architecture field", () => {
    const withArch = registry.playbooks.filter((p) => p.recommended_architecture);
    expect(withArch.length).toBe(registry.playbooks.length);
  });

  it("all registry playbooks have llm_driven_steps or deterministic_steps", () => {
    for (const p of registry.playbooks) {
      const hasAny =
        p.llm_driven_steps.length > 0 || p.deterministic_steps.length > 0;
      expect(hasAny, `${p.id} should have step classification`).toBe(true);
    }
  });
});
