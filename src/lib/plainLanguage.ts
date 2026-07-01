/**
 * MAR-136 / MAR-249: the plain-language register (audience: operator).
 *
 * A single deterministic source for translating registry enums (risk level,
 * category, edge relation) into plain conversational English aimed at a
 * non-technical workflow builder. Extracted from explain_component so the same
 * wording powers both the per-component explainer AND the per-step text in a
 * composed plan (the "picker → scope compiler" step-text win, MAR-249 T1).
 *
 * No LLM, no I/O — pure lookups, so both callers stay stateless/deterministic.
 */

/** Full-sentence risk consequence (explain_component "At a glance" line). */
export function riskStatement(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "Low-risk step — generally safe to run automatically.";
    case "medium":
      return "Medium-risk step — review the output before letting it feed into a write operation.";
    case "high":
      return "High-risk step — should always be paired with a human approval check before it runs.";
    case "critical":
      return "Critical-risk step — requires explicit human sign-off and audit logging every time it executes.";
    default:
      return `Risk level: ${riskLevel}.`;
  }
}

/**
 * Compact per-step risk note for a route step line (MAR-249). Keeps the risk
 * WORD (so a scanner still sees the level) and adds the plain-English
 * consequence, replacing the bare `[medium risk]` enum tag.
 */
export function riskStepNote(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "low risk — safe to run automatically";
    case "medium":
      return "medium risk — check its output before it feeds a write step";
    case "high":
      return "high risk — pair with a human approval step before it runs";
    case "critical":
      return "critical — needs human sign-off and audit logging every run";
    default:
      return `${riskLevel} risk`;
  }
}

/** Plain-English label for a component category. */
export function categoryStatement(category: string): string {
  const labels: Record<string, string> = {
    input: "data source or trigger",
    processing: "data transformation step",
    state: "state management component",
    safety: "safety and control checkpoint",
    tool: "tool or external lookup",
    output: "content generation or output step",
    eval: "evaluation and scoring step",
    orchestration: "workflow routing or orchestration",
    integration: "external service integration",
  };
  return labels[category] ?? category;
}

/** Natural-language connector for an edge relation. */
export function relationPhrase(relation: string): string {
  const phrases: Record<string, string> = {
    produces_input_for: "feeds its output to",
    requires: "must always be paired with",
    safer_with: "works more safely when paired with",
    compatible_with: "works well alongside",
    recommended_for: "is recommended before",
    before: "should run before",
    tested: "has been tested with",
    avoid_when: "should be avoided together with",
  };
  return phrases[relation] ?? relation;
}
