// ---------------------------------------------------------------------------
// Do-not-build anti-pattern rule engine
// ---------------------------------------------------------------------------
// All rules are deterministic. No LLM calls.
// Each rule returns a string when triggered, or null when it does not apply.
// ---------------------------------------------------------------------------

export type DoNotBuildContext = {
  goal: string;
  componentIds: string[];
  riskLevel?: string;
  localOrHosted?: "local" | "hosted" | "either";
  matchedPlaybookAvoidWhen?: string[];
  routeComponentCount?: number;
};

type Rule = (ctx: DoNotBuildContext) => string | null;

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

const noVectorDbUnlessNeeded: Rule = (ctx) => {
  const needsSemanticSearch =
    ctx.goal.toLowerCase().match(/semantic|embed|vector|similar|nearest neighbour|nearest neighbor|knn|similarity search/) != null;
  if (!needsSemanticSearch) {
    return (
      "Do not add a vector database (e.g. Pinecone, Weaviate, pgvector). " +
      "SQLite with full-text search (FTS5) handles most v0 retrieval use cases. " +
      "Add vector search only when your corpus genuinely requires semantic similarity retrieval."
    );
  }
  return null;
};

const noGraphDbUnlessNeeded: Rule = () => {
  return (
    "Do not add a graph database (e.g. Neo4j, ArangoDB). " +
    "The workflow graph is small enough for in-memory filtering. " +
    "Add a graph DB only if your data model has deeply nested relationships that relational queries cannot handle."
  );
};

const noRemoteAuthForLocalTools: Rule = (ctx) => {
  if (ctx.localOrHosted === "local" || ctx.localOrHosted === "either") {
    return (
      "Do not add remote OAuth / auth for a local tool. " +
      "Local-only workflows do not need authentication. " +
      "Add auth only when you have real multi-user, multi-tenant requirements."
    );
  }
  return null;
};

const noDirectPublishWithoutApprovalGate: Rule = (ctx) => {
  const hasExternalWrite = ctx.componentIds.some((id) =>
    ["external_publish", "optional_email_send", "calendar_write"].includes(id),
  );
  const hasApprovalGate = ctx.componentIds.includes("human_approval_gate");

  if (hasExternalWrite && !hasApprovalGate) {
    return (
      "Do not publish/send/write to external systems without a human_approval_gate. " +
      "External publish, email send and calendar write are irreversible actions. " +
      "Always require human sign-off before executing them."
    );
  }
  return null;
};

const noLlmForDeterministicSteps: Rule = (ctx) => {
  const hasDataScraper = ctx.componentIds.includes("data_scraper");
  const hasSchemaValidation = ctx.componentIds.includes("schema_validation");

  if (hasDataScraper || hasSchemaValidation) {
    return (
      "Do not use an LLM to perform data scraping or schema validation. " +
      "These are deterministic steps — use typed parsers, Zod/JSON Schema validators " +
      "and structured scraping libraries. LLMs add cost, latency and non-determinism to tasks that have exact solutions."
    );
  }
  return null;
};

const noMultiAgentForSimpleWorkflow: Rule = (ctx) => {
  const count = ctx.routeComponentCount ?? ctx.componentIds.length;
  if (count <= 6) {
    return (
      "Do not design this as a multi-agent swarm. " +
      `Your workflow has ${count} steps — a linear pipeline with clear step boundaries is simpler, ` +
      "faster to debug and easier to test than a distributed agent network."
    );
  }
  return null;
};

const noSkipValidationInDataPipeline: Rule = (ctx) => {
  const hasScraper = ctx.componentIds.includes("data_scraper");
  const hasValidation = ctx.componentIds.some((id) =>
    ["schema_validation", "deduplication"].includes(id),
  );

  if (hasScraper && !hasValidation) {
    return (
      "Do not skip schema validation in a data pipeline. " +
      "Scraped data must be validated before storage or publishing. " +
      "Silent schema mismatches corrupt downstream consumers. " +
      "Add schema_validation and deduplication before any output stage."
    );
  }
  return null;
};

const noCriticalRiskWithoutApproval: Rule = (ctx) => {
  if (
    (ctx.riskLevel === "high" || ctx.riskLevel === "critical") &&
    !ctx.componentIds.includes("human_approval_gate")
  ) {
    return (
      `Risk level is \`${ctx.riskLevel}\` but no human_approval_gate is present. ` +
      "High and critical risk workflows must include an approval gate before any action " +
      "that cannot be undone. Add human_approval_gate before the highest-risk step."
    );
  }
  return null;
};

const noResearchForHighStakesDecisions: Rule = (ctx) => {
  const isResearch = ctx.componentIds.some((id) =>
    ["research_synthesis", "source_ranking", "citation_checker"].includes(id),
  );
  const goalMentionsHighStakes = ctx.goal
    .toLowerCase()
    .match(/medical|legal|financial|clinical|diagnosis|invest|trade/) != null;

  if (isResearch && goalMentionsHighStakes) {
    return (
      "Do not use AI research synthesis for medical, legal or financial decisions without " +
      "adding an explicit domain-expert review step after synthesis. " +
      "Verified citations reduce hallucination risk but do not eliminate it for high-stakes decisions."
    );
  }
  return null;
};

const noAggressiveScraping: Rule = (ctx) => {
  if (ctx.componentIds.includes("data_scraper")) {
    return (
      "Do not scrape aggressively: respect robots.txt, honour HTTP 429 rate limits with " +
      "exponential backoff, and review the terms of service of every source domain before scraping. " +
      "Never scrape behind authentication without explicit legal review."
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule registry (order matters — most impactful rules first)
// ---------------------------------------------------------------------------

const ALL_RULES: Rule[] = [
  noDirectPublishWithoutApprovalGate,
  noCriticalRiskWithoutApproval,
  noSkipValidationInDataPipeline,
  noLlmForDeterministicSteps,
  noMultiAgentForSimpleWorkflow,
  noVectorDbUnlessNeeded,
  noGraphDbUnlessNeeded,
  noRemoteAuthForLocalTools,
  noResearchForHighStakesDecisions,
  noAggressiveScraping,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns an array of do-not-build anti-pattern warnings for the given context.
 * Results are deduplicated and ordered by severity (most blocking first).
 *
 * Also appends any `avoid_when` entries from matched playbooks.
 */
export function getDoNotBuildRules(ctx: DoNotBuildContext): string[] {
  const rules: string[] = [];

  for (const rule of ALL_RULES) {
    const result = rule(ctx);
    if (result !== null) rules.push(result);
  }

  // Append playbook-sourced avoid_when items as additional don't-build guidance
  for (const item of ctx.matchedPlaybookAvoidWhen ?? []) {
    const formatted = `Playbook guidance: avoid when — ${item}`;
    if (!rules.includes(formatted)) {
      rules.push(formatted);
    }
  }

  return rules;
}
