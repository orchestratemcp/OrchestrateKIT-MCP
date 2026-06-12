import type { Component } from "../registry/componentSchema.js";
import type { Edge } from "../registry/edgeSchema.js";
import type { Playbook } from "../registry/playbookSchema.js";
import type { Route } from "../registry/routeSchema.js";
import type { Stack } from "../registry/stackSchema.js";
import { matchCapabilities } from "./capabilityMatcher.js";
import { augmentWithSafety } from "./safetyAugmenter.js";
import {
  orderComponents,
  edgesWithinSet,
  computeExecutionOrder,
  detectAvoidViolations,
  type AvoidViolation,
} from "./routeOrdering.js";
import {
  findOverlappingPlaybooks,
  findOverlappingRoutes,
} from "./playbookOverlap.js";
import { scoreRoute } from "./routeScoring.js";
import {
  toInlineEdgeSummary,
  criticalUntestedChecklist,
  type InlineEdgeSummary,
} from "../tools/graphToolFormatters.js";
import {
  computeRouteValidation,
  formatScoreBreakdownMarkdown,
  type RouteStatus,
  type ConfidenceLabel,
} from "./routeValidationStatus.js";
import type { ScoreBreakdown } from "./routeScoring.js";

const MAX_COMPONENTS = 12;
const MIN_SCORE_THRESHOLD = 0;
/** Max components to add via keyword match before safety augmentation. */
const MATCH_TOP_N = 8;

export type RouteStep = {
  step: number;
  component_id: string;
  component_name: string;
  purpose: string;
  risk_level: string;
  model_tier: string;
  fallback_tier: string;
  context_need: string;
  compression_strategy: string;
};

export type ComposeNoiseFlag = {
  component_id: string;
  reason: string;
};

/**
 * Playbook-first recommendation output (MAR-91).
 * Present when a known playbook covers >= 80 % of the composed route.
 */
export type PlaybookRecommendation = {
  /** "playbook" when recall >= 0.80 AND precision >= 0.50; "composed" otherwise. */
  recommendation_type: "playbook" | "composed";
  playbook_id: string;
  playbook_title: string;
  /** Use get_playbook({ id }) for the full playbook. */
  suggestion: string;
  overlap: {
    recall: number;
    precision: number;
    jaccard: number;
    extra_components: string[];
    missing_components: string[];
  };
};

export type ComposedRoute = {
  status: "ok" | "candidate_route" | "low_confidence" | "blocked_candidate" | "not_found";
  /** Trust-first status label (MAR-93): validated | candidate | blocked_candidate */
  route_status: RouteStatus;
  /** Specific blockers preventing validation — listed before score. */
  blocking_gaps: string[];
  /** Human-readable explanation of why this route is not validated. Always present for candidate/blocked. */
  why_not_validated: string;
  /** Qualitative confidence: high | medium | low (replaces numeric headline). */
  confidence_label: ConfidenceLabel;
  confidence: number;
  route_score: number;
  score_breakdown: ScoreBreakdown;
  summary_markdown: string;
  matched_capabilities: string[];
  recommended_route: RouteStep[];
  /** Topological order (dependency reasoning). */
  planning_order: string[];
  /** Runtime-correct order; recommended_route steps follow this. */
  execution_order: string[];
  edges_used: InlineEdgeSummary[];
  known_playbooks_reused: string[];
  untested_edges: string[];
  /** avoid_when edges violated by this route (critical → blocked_candidate). */
  avoid_when_violations: AvoidViolation[];
  /** Components that matched but have no graph edges to the route — possible false positives. */
  compose_noise: ComposeNoiseFlag[];
  /** Playbook-first recommendation when a known playbook covers ≥80% of this route. */
  playbook_recommendation: PlaybookRecommendation | null;
  missing_capabilities: string[];
  required_approval_gates: string[];
  /**
   * Credential/permission surface of the route (MAR-117): which steps need
   * credentials, their declared scopes, and a secret-manager recommendation.
   */
  credential_advisory: CredentialAdvisory;
  /**
   * Breakdown of route steps by required LLM tier (MAR-116).
   * Helps clients pick models per-step rather than over-provisioning the whole route.
   */
  model_tier_profile: {
    frontier: string[];
    standard: string[];
    small: string[];
    none: string[];
  };
  recommended_stack: object;
  warnings: string[];
  assumptions: string[];
  evals_to_add: string[];
  next_recommended_tools: string[];
};

export type ComposeInput = {
  goal: string;
  must_have_capabilities: string[];
  must_avoid: string[];
  risk_level?: string;
  local_or_hosted?: string;
  output_depth?: "brief" | "standard" | "deep";
};

export type RegistrySnapshot = {
  components: Component[];
  edges: Edge[];
  stacks: Stack[];
  routes: Route[];
  playbooks: Playbook[];
};

export function componentPurpose(component: Component): string {
  // One-line purpose from summary (first sentence)
  const first = component.summary.split(/[.!?]/)[0]?.trim() ?? component.summary;
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
}

/**
 * Groups components into the four model-tier buckets (MAR-116).
 * Shared by composeRoute and planWorkflow so both report tiers identically.
 */
export function computeModelTierProfile(components: Component[]): {
  frontier: string[];
  standard: string[];
  small: string[];
  none: string[];
} {
  return {
    frontier: components.filter((c) => c.model_tier === "frontier").map((c) => c.id),
    standard: components.filter((c) => c.model_tier === "standard").map((c) => c.id),
    small: components.filter((c) => c.model_tier === "small").map((c) => c.id),
    none: components.filter((c) => c.model_tier === "none").map((c) => c.id),
  };
}

/**
 * Components that authenticate against an external service and therefore need
 * credentials/scopes provisioned at deploy time (MAR-117). Includes read-side
 * integrations (email_read, calendar_lookup, page_monitor) — they need scopes
 * too, even though only the write-side set gets an auth_failure_handler edge.
 */
const CREDENTIALED_COMPONENTS = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "calendar_lookup",
  "email_read",
  "crm_note_write",
  "data_scraper",
  "page_monitor",
]);

/** Advisory describing which steps need credentials and how to provision them safely. */
export type CredentialAdvisory = {
  components_requiring_credentials: Array<{
    component_id: string;
    required_scopes: string[];
  }>;
  /** Non-null when at least one credentialed component is in the route. */
  secret_manager_recommendation: string | null;
};

export const SECRET_MANAGER_RECOMMENDATION =
  "Provision credentials via a named secret manager (1Password, Doppler, " +
  "HashiCorp Vault, or env + OIDC) with least-privilege scopes. OrchestrateKit " +
  "is advisory and never stores credentials.";

/**
 * Surfaces the credential/permission surface of a route up front (MAR-117):
 * which steps talk to an authenticated external service and the read/write
 * scopes they declare. Recommends a named secret manager — never stores secrets.
 */
export function computeCredentialAdvisory(components: Component[]): CredentialAdvisory {
  const requiring = components
    .filter((c) => CREDENTIALED_COMPONENTS.has(c.id))
    .map((c) => ({
      component_id: c.id,
      required_scopes: [...c.permissions.read, ...c.permissions.write],
    }));

  return {
    components_requiring_credentials: requiring,
    secret_manager_recommendation:
      requiring.length > 0 ? SECRET_MANAGER_RECOMMENDATION : null,
  };
}

/** Builds a RouteStep (with model-tier metadata) from a component at position i. */
export function toRouteStep(component: Component, i: number): RouteStep {
  return {
    step: i + 1,
    component_id: component.id,
    component_name: component.name,
    purpose: componentPurpose(component),
    risk_level: component.risk_level,
    model_tier: component.model_tier,
    fallback_tier: component.fallback_tier,
    context_need: component.context_need,
    compression_strategy: component.compression_strategy,
  };
}

function buildSummaryMarkdown(
  goal: string,
  steps: RouteStep[],
  warnings: string[],
  overlappingPlaybooks: string[],
  score: number,
  validation: {
    route_status: RouteStatus;
    blocking_gaps: string[];
    why_not_validated: string;
    confidence_label: ConfidenceLabel;
  },
  breakdown: ScoreBreakdown,
  pbRec: PlaybookRecommendation | null = null,
  inlineEdges: InlineEdgeSummary[] = [],
): string {
  const lines: string[] = [];

  const statusLine =
    `**Route status:** \`${validation.route_status}\` | **Confidence:** ${validation.confidence_label} _(score breakdown below)_`;

  // Playbook-first banner (MAR-91): leads the summary when recommendation_type is "playbook"
  if (pbRec?.recommendation_type === "playbook") {
    lines.push(
      `## ✅ Use Playbook: \`${pbRec.playbook_id}\``,
      ``,
      `**Goal:** ${goal}`,
      ``,
      statusLine,
      ``,
      `> This goal is covered by the validated playbook **\`${pbRec.playbook_id}\`** ` +
        `(recall ${Math.round(pbRec.overlap.recall * 100)}%, precision ${Math.round(pbRec.overlap.precision * 100)}%, ` +
        `Jaccard ${Math.round(pbRec.overlap.jaccard * 100)}%).`,
      `> **Use \`get_playbook({ id: "${pbRec.playbook_id}" })\` as your primary reference.** ` +
        `Compose is only needed for adaptation / gaps.`,
      ``,
    );
    if (pbRec.overlap.extra_components.length > 0) {
      lines.push(
        `**Extra components not in playbook** (review, may be noise): ${pbRec.overlap.extra_components.map((c) => `\`${c}\``).join(", ")}`,
        ``,
      );
    }
    if (pbRec.overlap.missing_components.length > 0) {
      lines.push(
        `**Playbook components not in compose result** (gaps): ${pbRec.overlap.missing_components.map((c) => `\`${c}\``).join(", ")}`,
        ``,
      );
    }
    lines.push(`---`, ``, `### Compose output (for adaptation reference only)`, ``);
  } else {
    const headline =
      validation.route_status === "blocked_candidate"
        ? `## ⛔ Blocked Candidate Route`
        : `## Candidate Route`;
    lines.push(headline, ``, `**Goal:** ${goal}`, ``, statusLine, ``);
  }

  // MAR-93: blocking gaps and why_not_validated lead before steps/score
  if (validation.blocking_gaps.length > 0) {
    lines.push(`### Blocking gaps`);
    validation.blocking_gaps.forEach((gap, i) => {
      lines.push(`${i + 1}. ${gap}`);
    });
    lines.push(``);
  }

  if (validation.why_not_validated) {
    lines.push(`**Why not validated:** ${validation.why_not_validated}`, ``);
  }

  lines.push(
    `### Steps`,
    ...steps.map(
      (s) =>
        `${s.step}. **\`${s.component_id}\`** [risk: \`${s.risk_level}\`] — ${s.purpose}`,
    ),
  );

  if (overlappingPlaybooks.length > 0) {
    lines.push(
      ``,
      `### Reuses known playbook(s)`,
      ...overlappingPlaybooks.map((id) => `- \`${id}\``),
    );
  }

  if (warnings.length > 0) {
    lines.push(``, `### ⚠️ Warnings`, ...warnings.map((w) => `- ${w}`));
  }

  // MAR-92: critical untested edges checklist — critical first, then rest
  const checklist = criticalUntestedChecklist(inlineEdges);
  if (checklist) {
    lines.push(checklist);
  }

  // MAR-93: score demoted below blockers
  lines.push(``, formatScoreBreakdownMarkdown(breakdown, score));

  lines.push(
    ``,
    `> This is a **candidate route**, not a validated playbook. Test before relying on it.`,
  );

  return lines.join("\n");
}

/**
 * Deterministic route composer. No LLM calls.
 *
 * Algorithm:
 * 1. Match goal → components via keyword/capability matching
 * 2. Take top N by score, enforce must_avoid exclusions
 * 3. Add required components from `requires` edges
 * 4. Safety-augment (add human_approval_gate, audit_log where needed)
 * 5. Topologically order
 * 6. Find overlapping known playbooks/routes
 * 7. Score the route
 * 8. Build output
 */
export function composeRoute(
  input: ComposeInput,
  registry: RegistrySnapshot,
): ComposedRoute {
  const { goal, must_have_capabilities, must_avoid, output_depth = "standard" } = input;

  const warnings: string[] = [];
  const assumptions: string[] = [];

  // ── Step 1: Match capabilities ──
  const { matches, missing_capabilities } = matchCapabilities(
    goal,
    must_have_capabilities,
    must_avoid,
    registry.components,
    registry.edges,
  );

  if (matches.length === 0) {
    const emptyBreakdown: ScoreBreakdown = {
      capability_coverage: 0,
      tested_edge_score: 0,
      safety_score: 0,
      simplicity_score: 0,
      source_confidence: 0,
      risk_penalty: 0,
      untested_edge_penalty: 0,
      complexity_penalty: 0,
    };
    return {
      status: "not_found",
      route_status: "candidate",
      blocking_gaps: ["No registry components matched this goal"],
      why_not_validated:
        "No components matched — rephrase with domain-specific terms (email, research, code, data, publish).",
      confidence_label: "low",
      confidence: 0,
      route_score: 0,
      score_breakdown: emptyBreakdown,
      summary_markdown: `## No matching components\n\nNo registry components matched the goal: _"${goal}"_. Try rephrasing with more specific terms (e.g. "email", "research", "code", "data", "publish").`,
      matched_capabilities: [],
      recommended_route: [],
      planning_order: [],
      execution_order: [],
      edges_used: [] as InlineEdgeSummary[],
      known_playbooks_reused: [],
      untested_edges: [],
      avoid_when_violations: [],
      compose_noise: [],
      playbook_recommendation: null,
      missing_capabilities,
      required_approval_gates: [],
      credential_advisory: { components_requiring_credentials: [], secret_manager_recommendation: null },
      model_tier_profile: { frontier: [], standard: [], small: [], none: [] },
      recommended_stack: {},
      warnings: ["No registry components matched this goal."],
      assumptions: [],
      evals_to_add: [],
      next_recommended_tools: ["list_graph_components", "get_stack_recommendation"],
    };
  }

  // ── Step 2: Select top N matches ──
  let selected = matches.slice(0, MATCH_TOP_N).map((m) => m.component);
  const matchedCapabilities = matches
    .slice(0, MATCH_TOP_N)
    .flatMap((m) => m.matched_tokens)
    .filter((v, i, a) => a.indexOf(v) === i);

  // ── Step 3: Expand with required components from `requires` edges ──
  const selectedIds = new Set(selected.map((c) => c.id));
  const mustAvoidSet = new Set(must_avoid.map((s) => s.toLowerCase()));

  for (const edge of registry.edges) {
    if (edge.relation !== "requires") continue;
    if (!selectedIds.has(edge.from)) continue;
    if (selectedIds.has(edge.to)) continue;
    if (mustAvoidSet.has(edge.to)) continue;

    const required = registry.components.find((c) => c.id === edge.to);
    if (required) {
      selected.push(required);
      selectedIds.add(required.id);
      assumptions.push(
        `Added \`${required.id}\` because \`${edge.from}\` requires it.`,
      );
    }
  }

  // ── Step 4: Safety augmentation ──
  const { components: augmented, added_gates, added_audit, added_validation, added_auth_handler, added_by_chain } =
    augmentWithSafety(selected, registry.edges, registry.components);

  if (added_gates.length > 0) {
    warnings.push(
      `Added human_approval_gate because the route includes external write actions (${augmented
        .filter((c) =>
          ["external_publish", "optional_email_send", "calendar_write"].includes(c.id),
        )
        .map((c) => c.id)
        .join(", ")}). Do not remove this gate.`,
    );
  }
  if (added_validation) {
    warnings.push(
      `Added schema_validation before the external-write step. ` +
        `Required chain: artifact → schema_validation → human_approval_gate → write → audit_log. ` +
        `Do not remove schema_validation — silent publish of invalid data is harder to debug than a clean rejection.`,
    );
  }
  if (added_audit) {
    assumptions.push("Added audit_log because the route includes external actions.");
  }
  if (added_auth_handler) {
    warnings.push(
      `Added auth_failure_handler because the route calls an external integration with expirable credentials. ` +
        `Provision those credentials via a named secret manager (1Password, Doppler, HashiCorp Vault, or env + OIDC) ` +
        `with least-privilege scopes — OrchestrateKit is advisory and never stores credentials.`,
    );
  }
  if (added_by_chain.length > 0) {
    assumptions.push(
      `Added via prerequisite chain walk: ${added_by_chain.join(", ")}.`,
    );
  }

  // Cap total components
  let finalComponents = augmented.slice(0, MAX_COMPONENTS);
  if (augmented.length > MAX_COMPONENTS) {
    warnings.push(
      `Route was capped at ${MAX_COMPONENTS} components. ${augmented.length - MAX_COMPONENTS} lower-scoring matches were dropped.`,
    );
  }

  // ── Step 5: Ordering — planning (topological) vs execution (runtime) ──
  const planningComponents = orderComponents(finalComponents, registry.edges);
  const executionComponents = computeExecutionOrder(finalComponents, registry.edges);
  // Steps follow execution order (runtime-correct); planning order is reported
  // separately for dependency reasoning.
  finalComponents = executionComponents;

  // ── Step 6: Edges used & untested ──
  const finalIds = new Set(finalComponents.map((c) => c.id));
  const internalEdges = edgesWithinSet(finalIds, registry.edges);
  const untestedEdges = internalEdges.filter((e) => !e.tested).map((e) => e.id);

  // ── Step 6b: avoid_when violations & compose noise ──
  const avoidViolations = detectAvoidViolations(finalIds, registry.edges);
  const hasCriticalViolation = avoidViolations.some((v) => v.severity === "critical");
  for (const v of avoidViolations) {
    warnings.push(
      `avoid_when violation (${v.severity}): \`${v.from}\` and \`${v.to}\` should not co-occur — ${v.reason} [edge: ${v.edge_id}]`,
    );
  }

  // compose_noise: route components with no internal graph edge (excluding the
  // safety components the augmenter deliberately injected). These matched the
  // goal text but the graph has no relationship tying them to the route — flag
  // them as possible matcher false positives rather than presenting them as proven.
  const augmenterInjected = new Set<string>([
    ...added_gates,
    ...(added_validation ? ["schema_validation"] : []),
    ...(added_audit ? ["audit_log"] : []),
    ...(added_auth_handler ? ["auth_failure_handler"] : []),
    ...added_by_chain,
  ]);
  const edgeTouchedIds = new Set<string>();
  for (const e of internalEdges) {
    edgeTouchedIds.add(e.from);
    edgeTouchedIds.add(e.to);
  }
  const composeNoise: ComposeNoiseFlag[] = finalComponents
    .filter((c) => !edgeTouchedIds.has(c.id) && !augmenterInjected.has(c.id))
    .map((c) => ({
      component_id: c.id,
      reason:
        "Matched the goal text but has no graph edge connecting it to the rest of the route — verify it is not a matcher false positive.",
    }));

  // ── Step 7: Playbook / route overlap ──
  const playbookOverlaps = findOverlappingPlaybooks(finalIds, registry.playbooks, 0.6);
  const routeOverlaps = findOverlappingRoutes(finalIds, registry.routes, 0.6);

  const knownPlaybooksReused = playbookOverlaps.map((p) => p.playbook_id);

  // ── Playbook-first recommendation (MAR-91) ──
  // Threshold: recall >= 0.80 (fixed per AC) and precision >= 0.50 (noise guard).
  // When both pass, the primary recommendation is "use the playbook, not the
  // compose list." This replaces the old 0.9-only warning.
  const PLAYBOOK_RECALL_THRESHOLD = 0.80;
  const PLAYBOOK_PRECISION_THRESHOLD = 0.50;

  let playbookRecommendation: PlaybookRecommendation | null = null;

  if (playbookOverlaps.length > 0) {
    const best = playbookOverlaps[0]!;
    const isPlaybookFirst =
      best.overlap_fraction >= PLAYBOOK_RECALL_THRESHOLD &&
      best.precision >= PLAYBOOK_PRECISION_THRESHOLD;

    playbookRecommendation = {
      recommendation_type: isPlaybookFirst ? "playbook" : "composed",
      playbook_id: best.playbook_id,
      playbook_title: best.playbook_title,
      suggestion: isPlaybookFirst
        ? `Use get_playbook({ id: "${best.playbook_id}" }) as your primary reference. ` +
          `Compose is only needed for adaptation/gaps not covered by the playbook.`
        : `A known playbook partially overlaps (recall ${Math.round(best.overlap_fraction * 100)}%). ` +
          `Review it with get_playbook({ id: "${best.playbook_id}" }) before implementing the composed route.`,
      overlap: {
        recall: best.overlap_fraction,
        precision: best.precision,
        jaccard: best.jaccard,
        extra_components: best.extra_components,
        missing_components: best.missing_components,
      },
    };

    if (isPlaybookFirst) {
      warnings.push(
        `PLAYBOOK-FIRST: this route overlaps \`${best.playbook_id}\` at ${Math.round(best.overlap_fraction * 100)}% recall / ${Math.round(best.precision * 100)}% precision. ` +
          `Use the playbook directly — compose should only fill gaps. ` +
          `Extra components not in playbook: ${best.extra_components.length > 0 ? best.extra_components.join(", ") : "none"}. ` +
          `Playbook components missing from this route: ${best.missing_components.length > 0 ? best.missing_components.join(", ") : "none"}.`,
      );
    }
  }

  // ── Step 8: Score ──
  const requiredGatesPresent = finalIds.has("human_approval_gate");
  const gatesNeeded = finalComponents.some((c) =>
    ["external_publish", "optional_email_send", "calendar_write"].includes(c.id),
  );
  const missingSafetyGates = gatesNeeded && !requiredGatesPresent ? 1 : 0;

  const { route_score, confidence, breakdown } = scoreRoute({
    components: finalComponents,
    internalEdges,
    matchedCapabilities: matches.length,
    requestedCapabilities: Math.max(matches.length, must_have_capabilities.length + 1),
    safetyGatesCovered: !gatesNeeded || requiredGatesPresent,
    missingSafetyGates,
    routeOverlaps,
  });

  // ── Step 9: Build output ──
  const steps: RouteStep[] = finalComponents.map((c, i) => toRouteStep(c, i));

  const modelTierProfile = computeModelTierProfile(finalComponents);
  const credentialAdvisory = computeCredentialAdvisory(finalComponents);

  const requiredApprovalGates = added_gates.length > 0
    ? [...added_gates]
    : finalIds.has("human_approval_gate")
    ? ["human_approval_gate"]
    : [];

  // Evals to add
  const evalsToAdd: string[] = [];
  for (const c of finalComponents) {
    if (c.evals.length > 0) {
      evalsToAdd.push(`[${c.id}] ${c.evals[0]}`);
    }
  }

  // Complexity warning
  if (finalComponents.length > 8) {
    warnings.push(
      `This route has ${finalComponents.length} components. Consider simplifying — a multi-agent swarm is rarely better than a linear pipeline for this type of workflow.`,
    );
  }

  // Missing capabilities warning
  if (missing_capabilities.length > 0) {
    warnings.push(
      `Requested capabilities not covered by any component: ${missing_capabilities.join(", ")}. Consider adding custom components or adjusting the goal.`,
    );
  }

  if (assumptions.length === 0) {
    assumptions.push("All components selected via keyword/capability matching from goal text.");
  }

  const status: ComposedRoute["status"] = hasCriticalViolation
    ? "blocked_candidate"
    : confidence >= 0.7
    ? "ok"
    : confidence >= 0.5
    ? "candidate_route"
    : "low_confidence";

  if (hasCriticalViolation) {
    const critical = avoidViolations.filter((v) => v.severity === "critical");
    warnings.unshift(
      `BLOCKED: this route violates ${critical.length} critical avoid_when edge(s): ` +
        critical.map((v) => `\`${v.from}\` ✗ \`${v.to}\``).join(", ") +
        `. Do not implement as-is — remove the conflicting component or use a validated playbook.`,
    );
  }

  const inlineEdgeSummaries = internalEdges.map(toInlineEdgeSummary);
  const untestedCriticalEdges = inlineEdgeSummaries.filter(
    (e) => !e.tested && e.severity === "critical",
  );

  const routeValidation = computeRouteValidation({
    isPlaybookFirst: playbookRecommendation?.recommendation_type === "playbook",
    playbookId: playbookRecommendation?.playbook_id,
    hasCriticalAvoidViolation: hasCriticalViolation,
    missing_capabilities,
    untestedCriticalEdges,
    compose_noise: composeNoise,
    avoid_when_violations: avoidViolations,
    missingSafetyGates: gatesNeeded && !requiredGatesPresent,
    confidence,
    route_score,
    breakdown,
  });

  // Default stack for recommendation
  const defaultStack = registry.stacks.find(
    (s) => s.id === "default_orchestratekit_stack",
  );
  const recommendedStack = defaultStack
    ? { id: defaultStack.id, name: defaultStack.name, summary: defaultStack.summary }
    : {};

  const summaryMarkdown =
    output_depth === "brief"
      ? `**Route status:** \`${routeValidation.route_status}\` | **Confidence:** ${routeValidation.confidence_label} | score: ${route_score}/100\n\n` +
        steps.map((s) => `${s.step}. \`${s.component_id}\``).join(" → ")
      : buildSummaryMarkdown(
          goal,
          steps,
          warnings,
          knownPlaybooksReused,
          route_score,
          routeValidation,
          breakdown,
          playbookRecommendation,
          inlineEdgeSummaries,
        );

  return {
    status,
    route_status: routeValidation.route_status,
    blocking_gaps: routeValidation.blocking_gaps,
    why_not_validated: routeValidation.why_not_validated,
    confidence_label: routeValidation.confidence_label,
    confidence,
    route_score,
    score_breakdown: breakdown,
    summary_markdown: summaryMarkdown,
    matched_capabilities: matchedCapabilities,
    recommended_route: steps,
    planning_order: planningComponents.map((c) => c.id),
    execution_order: executionComponents.map((c) => c.id),
    edges_used: inlineEdgeSummaries,
    known_playbooks_reused: knownPlaybooksReused,
    untested_edges: untestedEdges,
    avoid_when_violations: avoidViolations,
    compose_noise: composeNoise,
    playbook_recommendation: playbookRecommendation,
    missing_capabilities,
    required_approval_gates: requiredApprovalGates,
    credential_advisory: credentialAdvisory,
    model_tier_profile: modelTierProfile,
    recommended_stack: recommendedStack,
    warnings,
    assumptions,
    evals_to_add: evalsToAdd.slice(0, output_depth === "deep" ? 20 : 5),
    next_recommended_tools: [
      "get_route",
      "get_graph_component",
      "get_stack_recommendation",
    ],
  };
}
