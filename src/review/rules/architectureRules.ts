import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";

// ---------------------------------------------------------------------------
// Rule 1: Too many agents for a simple workflow
// ---------------------------------------------------------------------------

const tooManyAgentsForSimpleWorkflow: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  const agentCount = ctx.agents.length;

  if (agentCount <= 2) return [];

  const componentCount = ctx.componentIds.length || ctx.resolvedComponents.length;
  const isSimple = componentCount <= 5;

  if (!isSimple) return [];

  return [
    {
      severity: "medium",
      category: "architecture",
      message: `${agentCount} agents for a workflow with ${componentCount || "few"} components is over-engineered.`,
      reason:
        "Multi-agent systems add coordination overhead, failure modes and debugging complexity. " +
        "A linear pipeline with clear step boundaries is almost always simpler and faster to ship.",
      recommended_fix:
        "Reduce to 1 agent with sequential tool calls. " +
        "Add a second agent only when you have a clear, parallel workload that cannot be serialised.",
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 2: Lack of evals or test cases mentioned
// ---------------------------------------------------------------------------

const missingEvalCoverage: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  const goalLower = ctx.goal.toLowerCase();
  const archLower = (ctx.proposedArchitecture ?? "").toLowerCase();

  const mentionsEvals =
    goalLower.includes("eval") ||
    goalLower.includes("test") ||
    archLower.includes("eval") ||
    archLower.includes("test case") ||
    ctx.resolvedComponents.some((c) => c.category === "eval");

  if (mentionsEvals) return [];

  return [
    {
      severity: "low",
      category: "eval",
      message: "No evals or test cases mentioned in the workflow design.",
      reason:
        "AI workflows without evals have no observable quality signal. " +
        "You cannot know if your workflow regresses after a change.",
      recommended_fix:
        "Define at least 2-3 eval cases before implementation. " +
        "Use promptfoo for LLM-driven steps. " +
        "Use vitest fixtures for deterministic pipeline stages.",
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 3: Vague proposed architecture
// ---------------------------------------------------------------------------

const vagueProposedArchitecture: ReviewRule = (ctx: ReviewContext): ReviewFinding[] => {
  const arch = ctx.proposedArchitecture ?? "";
  if (arch.trim().length === 0) return []; // not provided — skip
  if (arch.trim().length >= 50) return []; // reasonable length — ok

  return [
    {
      severity: "low",
      category: "architecture",
      message: "Proposed architecture description is too vague to review meaningfully.",
      reason:
        "A description shorter than 50 characters cannot convey data flow, component responsibilities " +
        "or failure handling. Reviewers cannot assess risks without this detail.",
      recommended_fix:
        "Expand proposed_architecture to describe: data flow direction, component responsibilities, " +
        "how errors are handled and which steps are LLM-driven vs deterministic.",
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 4: Research synthesis without citation checker
// ---------------------------------------------------------------------------

const researchWithoutCitationChecker: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (!ctx.hasResearch) return [];
  if (ctx.hasCitationChecker) return [];

  return [
    {
      severity: "high",
      category: "architecture",
      message: "Research synthesis workflow has no citation checker.",
      reason:
        "LLMs fabricate plausible-looking citations. Without a citation_checker component, " +
        "synthesised outputs cannot be trusted to contain accurate source references.",
      recommended_fix:
        "Add `citation_checker` and `source_freshness_check` components after `research_synthesis`. " +
        "Verify that every cited URL is reachable and within an acceptable freshness window.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: "citation_checker",
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// Rule 5: Data scraper without schema validation
// ---------------------------------------------------------------------------

const dataScraperWithoutValidation: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (!ctx.hasDataScraper) return [];
  if (ctx.hasSchemaValidation) return [];

  return [
    {
      severity: "high",
      category: "architecture",
      message: "Data scraper present with no schema_validation step.",
      reason:
        "Scraped data is unstructured and unreliable. Without schema validation, " +
        "invalid records flow into downstream consumers and can silently corrupt data stores.",
      recommended_fix:
        "Add `schema_validation` after `data_normalizer`. " +
        "Quarantine invalid records in a separate table with error details rather than dropping them silently.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: "schema_validation",
      },
    },
  ];
};

export const architectureRules: ReviewRule[] = [
  tooManyAgentsForSimpleWorkflow,
  missingEvalCoverage,
  vagueProposedArchitecture,
  researchWithoutCitationChecker,
  dataScraperWithoutValidation,
];
