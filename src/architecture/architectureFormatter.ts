import type { RouteStep } from "../graph/routeComposer.js";

// ---------------------------------------------------------------------------
// Architecture recommendation formatter
// ---------------------------------------------------------------------------

export type ArchitectureData = {
  status: "ok" | "candidate_route" | "low_confidence" | "blocked_candidate" | "not_found";
  confidence: number;
  routeScore: number;
  goal: string;
  pattern: string;
  why: string;
  route: RouteStep[];
  routeId?: string;
  matchedPlaybookIds: string[];
  llmDrivenSteps: string[];
  deterministicSteps: string[];
  stateComponents: string[];
  stateNeeds: string[];
  toolComponents: string[];
  approvalGates: string[];
  evals: string[];
  stackId: string;
  stackName: string;
  stackChoicesSummary: string[];
  doNotBuild: string[];
  assumptions: string[];
  warnings: string[];
  untestedEdges: string[];
  nextSteps: string[];
};

export type OutputDepth = "brief" | "standard" | "deep";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function statusBadge(status: ArchitectureData["status"]): string {
  switch (status) {
    case "ok":
      return "✅ Validated";
    case "candidate_route":
      return "🔶 Candidate route (not yet validated)";
    case "low_confidence":
      return "⚠️ Low confidence — review carefully";
    case "blocked_candidate":
      return "⛔ Blocked — critical safety conflict, do not implement as-is";
    case "not_found":
      return "❌ No matching route found";
  }
}

export function formatRecommendation(
  data: ArchitectureData,
  depth: OutputDepth = "standard",
): string {
  const conf = Math.round(data.confidence * 100);
  const lines: string[] = [
    `## Architecture Recommendation`,
    ``,
    `**Goal:** ${data.goal}`,
    ``,
    `**Status:** ${statusBadge(data.status)} | **Confidence:** ${conf}% | **Route score:** ${data.routeScore}/100`,
    ``,
  ];

  if (data.matchedPlaybookIds.length > 0) {
    lines.push(
      `**Reuses golden-path playbook(s):** ${data.matchedPlaybookIds.map((id) => `\`${id}\``).join(", ")}`,
      ``,
    );
  }

  if (data.routeId) {
    lines.push(`**Known route:** \`${data.routeId}\``, ``);
  }

  // Pattern + why
  lines.push(`### Pattern`, ``, `**${data.pattern}**`, ``);
  if (data.why) {
    lines.push(`> ${data.why.trim().replace(/\n/g, " ")}`, ``);
  }

  // Route steps
  lines.push(
    `### Route (${data.route.length} steps)`,
    ``,
    ...data.route.map(
      (s) => `${s.step}. **\`${s.component_id}\`** [risk: \`${s.risk_level}\`] — ${s.purpose}`,
    ),
    ``,
  );

  if (data.status === "blocked_candidate") {
    lines.push(
      `> ⛔ **This route is blocked by a critical safety conflict.** Do not implement as-is.`,
      `> See warnings for the violated avoid_when edge(s); remove the conflicting component or use a validated playbook.`,
      ``,
    );
  } else if (data.status === "candidate_route" || data.status === "low_confidence") {
    lines.push(
      `> ⚠️ **This is a candidate route.** It has not been validated in production.`,
      `> Review all untested edges before implementing.`,
      ``,
    );
  }

  if (depth === "brief") {
    if (data.warnings.length > 0) {
      lines.push(`### ⚠️ Warnings`, ``, ...data.warnings.map((w) => `- ${w}`), ``);
    }
    return lines.join("\n");
  }

  // Step classification
  lines.push(`### Step breakdown`, ``);
  if (data.llmDrivenSteps.length > 0) {
    lines.push(
      `**LLM-driven steps:** ${data.llmDrivenSteps.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  if (data.deterministicSteps.length > 0) {
    lines.push(
      `**Deterministic steps:** ${data.deterministicSteps.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  if (data.stateComponents.length > 0) {
    lines.push(
      `**State/storage:** ${data.stateComponents.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  if (data.toolComponents.length > 0) {
    lines.push(
      `**Tools/integrations:** ${data.toolComponents.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  if (data.approvalGates.length > 0) {
    lines.push(
      `**🔐 Approval gates:** ${data.approvalGates.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  lines.push(``);

  // State needs
  if (data.stateNeeds.length > 0) {
    lines.push(`### Storage needs`, ``, ...data.stateNeeds.map((n) => `- ${n}`), ``);
  }

  // Stack
  lines.push(
    `### Stack`,
    ``,
    `**Recommended:** \`${data.stackId}\` — ${data.stackName}`,
    ``,
    ...data.stackChoicesSummary.map((c) => `- ${c}`),
    ``,
  );

  // Do not build
  if (data.doNotBuild.length > 0) {
    lines.push(`### 🚫 Do not build`, ``, ...data.doNotBuild.map((d) => `- ${d}`), ``);
  }

  // Warnings
  if (data.warnings.length > 0) {
    lines.push(`### ⚠️ Warnings`, ``, ...data.warnings.map((w) => `- ${w}`), ``);
  }

  // Untested edges
  if (data.untestedEdges.length > 0) {
    lines.push(
      `### ⚠️ Untested edges`,
      ``,
      `These edges have not been tested in production. Validate before relying on them:`,
      ``,
      ...data.untestedEdges.map((e) => `- \`${e}\``),
      ``,
    );
  }

  if (depth === "deep") {
    // Evals
    if (data.evals.length > 0) {
      lines.push(`### Suggested evals`, ``, ...data.evals.map((e) => `- ${e}`), ``);
    }

    // Assumptions
    if (data.assumptions.length > 0) {
      lines.push(`### Assumptions`, ``, ...data.assumptions.map((a) => `- ${a}`), ``);
    }
  }

  // Next steps
  if (data.nextSteps.length > 0) {
    lines.push(`### Next steps`, ``, ...data.nextSteps.map((s) => `1. ${s}`), ``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pattern + why derivation
// ---------------------------------------------------------------------------

/**
 * Derives a plain-language architecture pattern description from the route shape.
 */
export function derivePattern(
  componentIds: string[],
  approvalGates: string[],
  stateComponents: string[],
  llmDrivenSteps: string[],
): string {
  const hasApproval = approvalGates.length > 0;
  const hasState = stateComponents.length > 0;
  const hasLlm = llmDrivenSteps.length > 0;
  const isLarge = componentIds.length > 7;

  if (isLarge && hasApproval) {
    return "Multi-step orchestration pipeline with human approval gate";
  }
  if (isLarge) {
    return "Multi-step orchestration pipeline";
  }
  if (hasApproval && hasState && hasLlm) {
    return "Stateful LLM pipeline with human approval gate";
  }
  if (hasApproval && hasLlm) {
    return "LLM pipeline with human approval gate";
  }
  if (hasApproval) {
    return "Sequential pipeline with human approval gate";
  }
  if (hasState && hasLlm) {
    return "Stateful LLM pipeline";
  }
  if (hasLlm) {
    return "LLM-augmented pipeline";
  }
  if (hasState) {
    return "Stateful sequential pipeline";
  }
  return "Sequential deterministic pipeline";
}

/**
 * Derives next steps to guide the user after reviewing the architecture.
 */
export function deriveNextSteps(
  untestedEdges: string[],
  doNotBuild: string[],
  evals: string[],
  matchedPlaybookIds: string[],
  status: ArchitectureData["status"],
): string[] {
  const steps: string[] = [];

  if (status === "blocked_candidate") {
    steps.push("This route is BLOCKED by a critical safety conflict — resolve the violated avoid_when edge(s) in the warnings before doing anything else.");
  }

  if (status === "candidate_route" || status === "low_confidence") {
    steps.push("Review candidate route components before implementation — use `get_graph_component` for details.");
  }

  if (matchedPlaybookIds.length > 0) {
    steps.push(
      `Review the matched playbook(s) for full implementation guidance: ${matchedPlaybookIds.map((id) => `get_playbook(playbook_id="${id}", include_graph=true)`).join(", ")}`,
    );
  }

  if (untestedEdges.length > 0) {
    steps.push(`Validate ${untestedEdges.length} untested edge(s) before production use: ${untestedEdges.slice(0, 3).join(", ")}${untestedEdges.length > 3 ? "…" : ""}`);
  }

  if (doNotBuild.length > 0) {
    steps.push("Address the do-not-build guidance above before starting implementation.");
  }

  if (evals.length > 0) {
    steps.push("Write eval fixtures for the suggested evals — start with the first 2-3.");
  }

  steps.push("Use `get_stack_recommendation` for detailed stack technology choices.");
  steps.push("Use `get_relevant_docs` with your playbook_id or component_ids to find reference documentation.");

  return steps;
}
