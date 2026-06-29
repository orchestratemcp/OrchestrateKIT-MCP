/**
 * plan_workflow — MAR-100 meta-tool.
 *
 * Single-call planner that replaces the manual 5-tool ritual
 * (list_known_routes → get_route → compose_workflow_route →
 * get_stack_recommendation → review_workflow_design).
 *
 * It runs one composeRoute pass, then:
 *  - decides plan_source: when a validated playbook matches the goal with high
 *    enough recall and PRECISION (recall ≥ 0.60, precision ≥ 0.72 — see the
 *    threshold block below; the precision floor was retuned in MAR-130) it LEADS
 *    WITH THE PLAYBOOK's golden-path route rather than the composed candidate.
 *    This operationalises the MAR-98 finding that for playbook-matched requests
 *    the validated route is the right answer and compose output is noise.
 *  - runs the deterministic review rule set on the chosen route's component set
 *    and inlines the safety findings.
 *  - inlines the stack recommendation and the MAR-116 model-tier profile.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Component } from "../registry/componentSchema.js";
import type { LoopContract } from "../registry/playbookSchema.js";
import { loadRegistry } from "../registry/registryProvider.js";
import {
  composeRoute,
  computeModelTierProfile,
  computeCredentialAdvisory,
  toRouteStep,
  type ComposeInput,
  type CredentialAdvisory,
  type RegistrySnapshot,
  type RouteStep,
  type UntestedEdge,
} from "../graph/routeComposer.js";
import {
  computeExecutionOrder,
  detectAvoidViolations,
  edgesWithinSet,
  type AvoidViolation,
} from "../graph/routeOrdering.js";
import { ALWAYS_REQUIRES_GATE } from "../graph/safetyAugmenter.js";
import { findOverlappingPlaybooks } from "../graph/playbookOverlap.js";
import {
  composeWorkerPipeline,
  type WorkerPipeline,
} from "../graph/workerPipeline.js";
import {
  computeAutomationClearance,
  type AutomationClearance,
} from "../graph/automationClearance.js";
import { buildReviewContext } from "./reviewWorkflowDesign.js";
import { ALL_RULES } from "../review/rules/index.js";
import {
  calculateRiskScore,
  deriveStatus,
  type ReviewFinding,
} from "../review/types.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { PlanWorkflowOutputShape } from "./outputSchemas.js";

// ───────────────────────────── types ─────────────────────────────

export type PlanSource = "playbook" | "composed";

export type BuildTarget = "cowork" | "cursor" | "chatgpt_gpt" | "code";

/** MCP server availability metadata for a concrete product (MAR-124). */
export type McpServerInfo = {
  /** Whether an official (Anthropic/product-vendor) or community MCP server exists. */
  availability: "official" | "community" | "none";
  /** npm package or hosted endpoint — present when availability is not "none". */
  package?: string;
  /** Wire transport for the MCP server. "none" when no server exists. */
  transport: "stdio" | "sse" | "http" | "none";
  /** Short caveat or setup note for this MCP server. */
  note?: string;
};

/** One concrete integration need derived from a route component (MAR-208 / MAR-124). */
export type IntegrationNeed = {
  component_id: string;
  label: string;
  product_examples: string[];
  /** Component-level permission scopes from the registry YAML. */
  scopes: string[];
  /** Auth model for the primary product (e.g. "OAuth2 (user-delegated)", "API key"). */
  auth_model: string;
  /** MCP server availability for the primary product. */
  mcp_server: McpServerInfo;
  /** Least-privilege OAuth / API scopes for the primary product. */
  required_scopes: string[];
  /** Common gotchas for this integration (rate limits, token expiry, etc.). */
  gotchas: string[];
};

export type PlanWorkflowInput = ComposeInput & {
  /** Who will BUILD from this plan? Drives suggested_next_actions (MAR-208). */
  build_target?: BuildTarget;
};

/**
 * plan_workflow's own playbook-routing thresholds (MAR-100, retuned in MAR-130).
 *
 * The MAR-98 split is PRECISION-driven: a genuine playbook match produces a
 * high-precision composed set (almost everything compose picked is in the
 * playbook), whereas a goal whose primary domain is something else only overlaps
 * a playbook because of generic glue (intent_classifier + the auto-added
 * human_approval_gate / audit_log) plus a couple of lexically-injected
 * components — high recall, mediocre precision.
 *
 * MAR-130 regression: the old precision floor of 0.60 let `email_calendar_assistant`
 * lead 5/10 dogfood sessions across CRM / invoice / HR / social, dropping the real
 * primary-domain component (e.g. crm_note_write) for calendar_lookup/calendar_write.
 * compose's MAR-91 guard (recall ≥ 0.80) correctly rejected those, but it is NOT
 * applied here — plan_workflow has this separate, weaker gate.
 *
 * Calibration across the canonical goals cleanly separates the two populations by
 * PRECISION (recall is too low for genuine data/research/codebase to use the 0.80
 * compose floor):
 *   genuine playbook (keep):   research 0.83 · content 0.78 · email 0.73 · codebase 1.00 · data 0.83  (min 0.73)
 *   over-match / composed:     CRM 0.63 · invoice 0.67 · HR 0.70 · social 0.44 · p6 0.50 · p7 0.50    (max 0.70)
 * A precision floor of 0.72 sits in the gap and downgrades every over-match
 * (including HR) to a composed candidate while keeping all genuine matches.
 */
const PLAYBOOK_RECALL_MIN = 0.6;
const PLAYBOOK_PRECISION_MIN = 0.72;

/**
 * MAR-128: playbook coverage guard.
 *
 * Playbook-first routing leads with a validated playbook's golden-path route and
 * DROPS any composed component the playbook omits (`extra_components`). That is
 * right when the extras are generic glue — a domain-agnostic front-door,
 * `schema_validation`, or the safety augmenter's gate/audit/auth injections — but
 * WRONG when an extra is a goal-matched *primary-domain* capability the playbook
 * simply doesn't cover (e.g. `reviewer_notification`, `page_monitor`,
 * `crm_note_write`). Dropping it silently ships a design that no longer does what
 * the user asked.
 *
 * A primary-domain extra has a concrete-capability category
 * (input/output/tool/integration) and is NOT the domain-agnostic
 * `user_goal_intake` front-door. processing-category extras (`intent_classifier`,
 * `schema_validation`) count as glue. When the goal still matches a playbook, we
 * keep leading with the validated playbook but APPEND these extras to its route
 * so the capability is never silently dropped — the acceptance is that the
 * component is included "whether or not it routes via a playbook". (Falling back
 * to composed was rejected: a generic "approve" token matches
 * `reviewer_notification` on genuine playbook goals too, so demoting on its
 * presence would break real matches; appending preserves them.)
 */
const PLAYBOOK_PRIMARY_DOMAIN_CATEGORIES = new Set([
  "input",
  "output",
  "tool",
  "integration",
]);
const PLAYBOOK_GENERIC_GLUE_IDS = new Set(["user_goal_intake"]);

function primaryDomainExtras(
  extraComponentIds: string[],
  registry: RegistrySnapshot,
): string[] {
  return extraComponentIds.filter((id) => {
    if (PLAYBOOK_GENERIC_GLUE_IDS.has(id)) return false;
    const c = registry.components.find((comp) => comp.id === id);
    return !!c && PLAYBOOK_PRIMARY_DOMAIN_CATEGORIES.has(c.category);
  });
}

/**
 * Strong email/calendar signal tokens. At least one must be present in the goal
 * for email_calendar_assistant to fire as a playbook match (MAR-142). Prevents
 * the playbook routing from claiming a Stripe-to-Slack reporting goal (which
 * mentions neither email nor calendar) just because its lexical tokens happen to
 * score above the precision floor.
 */
const STRONG_EMAIL_CALENDAR_TOKENS = [
  "email", "inbox", "mailbox", "reply", "replies", "draft", "calendar",
  "meeting", "invite", "appointment", "send email", "mail",
];

function hasEmailCalendarSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return STRONG_EMAIL_CALENDAR_TOKENS.some((t) => g.includes(t));
}

/**
 * Explicit "read-only / no-write" constraint phrases (MAR-142). When present in
 * a goal that was routed to a playbook containing write components, surface a
 * safety warning — the playbook route's fixed structure cannot adapt its writes
 * to match the constraint (unlike the composed path which has MAR-132 advisory).
 */
const WRITE_CONSTRAINT_SIGNALS = [
  "read-only",
  "read only",
  "never write",
  "no write",
  "no writes",
  "no database update",
  "no emails sent",
  "no email sent",
  "never send",
];

function hasWriteConstraint(goal: string): boolean {
  const g = goal.toLowerCase();
  return WRITE_CONSTRAINT_SIGNALS.some((s) => g.includes(s));
}

export type SafetyReview = {
  status: "pass" | "warnings" | "fail";
  risk_score: number;
  blocking_issues: string[];
  warnings: string[];
  approval_gates_required: string[];
};

export type PlanPlaybook = {
  id: string;
  title: string;
  route_id: string;
  confidence: number;
  recall: number;
  precision: number;
};

/**
 * Surfaced when the goal explicitly opts out of human approval (unattended /
 * no-gate / fully automated) but the route still contains an irreversible
 * external write that warrants a gate (MAR-132). The gate is KEPT in the route
 * as a strong recommendation rather than dropped — never silently removed — and
 * moved out of `enforced_approval_gates` so the output stops contradicting the
 * user's stated constraint.
 */
export type ApprovalGateAdvisory = {
  gate: string;
  write_components: string[];
  reason: string;
};

/**
 * Explicit "no human gate" phrases. Substring-matched on the lowercased goal.
 * Deliberately narrow — only unambiguous opt-outs, never bare "automated".
 */
const UNATTENDED_WAIVER_SIGNALS = [
  "unattended",
  "no human",
  "without human",
  "no approval",
  "without approval",
  "no gate",
  "without a gate",
  "no manual approval",
  "fully automated",
  "fully autonomous",
];

/**
 * Waiver signals whose meaning flips under a preceding negation ("not
 * unattended", "never fully automated"). The "no …" / "without …" signals are
 * already opt-outs and are left as-is. (MAR-229)
 */
const NEGATABLE_WAIVER_SIGNALS = ["unattended", "fully automated", "fully autonomous"];

/**
 * Explicit "I DO want the human gate" phrases. When any is present (and not
 * itself negated) the user is asking for an ENFORCED gate, so it outranks any
 * waiver phrasing — never downgrade to advisory. (MAR-229)
 *
 * Deliberately collision-free: phrases that appear inside waiver phrasings
 * ("no manual approval", "no human in the loop", "no approval required") are
 * excluded so they can't mis-fire. `\battended\b` is handled separately so it
 * matches "attended" but not "unattended".
 */
const APPROVAL_REQUIRED_SIGNALS = [
  "must approve",
  "must be approved",
  "must review",
  "must be reviewed",
  "require approval",
  "requires approval",
  "needs approval",
  "need approval",
  "require human",
  "requires human",
  "human must",
  "approve before",
  "approval before",
  "review before",
];

/**
 * True when `phrase` occurs in `goal` with at least one occurrence NOT preceded
 * by a negation word. `includeNo` adds "no"/"without" to the negation set (used
 * for approval phrases like "no approval before"; the waiver path uses only the
 * not/never family). (MAR-229)
 */
function occursUnnegated(goal: string, phrase: string, includeNo: boolean): boolean {
  const neg = includeNo
    ? /\b(not|never|no longer|isn't|is not|aren't|won't|wont|no|without)\b\W*$/
    : /\b(not|never|no longer|isn't|is not|aren't|won't|wont)\b\W*$/;
  let from = 0;
  for (;;) {
    const idx = goal.indexOf(phrase, from);
    if (idx < 0) return false;
    const before = goal.slice(Math.max(0, idx - 16), idx);
    if (!neg.test(before)) return true; // a clean, non-negated occurrence
    from = idx + phrase.length;
  }
}

/** True when the goal explicitly REQUIRES a human approval gate (MAR-229). */
export function hasExplicitApprovalRequirement(goal: string): boolean {
  const g = goal.toLowerCase();
  // \battended\b matches standalone "attended" but NOT "unattended" (the 'un'
  // prefix removes the leading word boundary).
  if (/\battended\b/.test(g)) return true;
  return APPROVAL_REQUIRED_SIGNALS.some((s) => occursUnnegated(g, s, true));
}

/**
 * True when the goal explicitly waives a human approval gate (MAR-132, hardened
 * in MAR-229). An explicit approval REQUIREMENT outranks any waiver phrase, and
 * negated waiver signals ("not unattended") do not count.
 */
export function hasUnattendedWaiver(goal: string): boolean {
  const g = goal.toLowerCase();
  if (hasExplicitApprovalRequirement(g)) return false;
  return UNATTENDED_WAIVER_SIGNALS.some((s) => {
    if (!g.includes(s)) return false;
    // negatable signals ("not unattended") don't count when negated
    if (NEGATABLE_WAIVER_SIGNALS.includes(s) && !occursUnnegated(g, s, false)) {
      return false;
    }
    return true;
  });
}

/**
 * MAR-206: provenance tags for the three categories of plan_workflow output.
 *
 * OrchestrateMCP never calls an LLM — every field in plan_workflow output is
 * deterministically computed from the registry (component/edge/playbook/route
 * YAMLs). Provenance tags exist to help a READING AGENT (Claude, ChatGPT) avoid
 * hallucinating "elaborations" of registry facts and presenting them as if they
 * were also registry-derived.
 *
 *   grounded = direct registry field value (component id, edge relation, route status)
 *   computed  = deterministic function of registry data (topo-sort, score, clearance)
 *   advisory  = registry-seeded guidance phrased for a human / agent audience
 *
 * All three are checkable against the registry; none are LLM-generated.
 */
/**
 * MAR-225: one bounded, multiple-choice clarifying question. `options` always
 * ends with a "Not sure yet" choice. The reading agent presents these to the
 * user and folds the answers into a re-call's goal — the MCP is stateless.
 */
export type ClarifyingQuestion = {
  id: "run_trigger" | "write_permission" | "outbound_send";
  question: string;
  options: string[];
};

export type ProvenanceTag = "grounded" | "computed" | "advisory";

export type ProvenanceModel = {
  model: "registry-deterministic";
  all_fields_are_registry_derived: true;
  field_tags: Record<string, ProvenanceTag>;
  grounding_note: string;
};

export type PlanWorkflowOutput = {
  plan_source: PlanSource;
  goal: string;
  summary_markdown: string;
  recommended_route: RouteStep[];
  planning_order: string[];
  execution_order: string[];
  model_tier_profile: {
    frontier: string[];
    standard: string[];
    small: string[];
    none: string[];
  };
  /** Present when plan_source === "playbook". */
  playbook: PlanPlaybook | null;
  route_status: string;
  route_score: number;
  confidence_label: string;
  stack: object;
  safety_review: SafetyReview;
  credential_advisory: CredentialAdvisory;
  /** Untested edges within the route, each with its registry severity (MAR-133). */
  untested_edges: UntestedEdge[];
  avoid_when_violations: AvoidViolation[];
  /**
   * Approval gates ACTUALLY PRESENT AND ENFORCED in `recommended_route` (MAR-148).
   *
   * Distinct from `safety_review.approval_gates_required`, which is what the
   * review rules say the route NEEDS. The two used to both be named "required",
   * so a route that needs a gate but doesn't contain one read as a contradiction
   * (Dogfood Round 3 G2: `required_approval_gates: []` next to
   * `approval_gates_required: [human_approval_gate]`). Renamed to `enforced_*`
   * so the pair reads as a legible gap — "needed, but not enforced" — rather than
   * a self-contradiction. Empty when a gate is downgraded to advisory (below).
   */
  enforced_approval_gates: string[];
  /**
   * Non-null when the goal explicitly opted out of a human gate but the route
   * still performs an irreversible external write (MAR-132). The gate stays in
   * `recommended_route` as a strong recommendation; it is just not listed in
   * `enforced_approval_gates`.
   */
  approval_gate_advisory: ApprovalGateAdvisory | null;
  evals_to_add: string[];
  /**
   * Advisory design notes drawn from edge `control_flow_note` annotations (MAR-211).
   * Non-empty only when edges between route components carry architectural guidance
   * (e.g. conditional composition rules, wiring order constraints). Absent when no
   * such notes exist for the current route — the field is not always present.
   */
  design_notes: string[];
  /**
   * Concrete integrations the route's components require (MAR-208).
   * Reframes credential_advisory as a plain-language "products you'll wire up" list
   * so a builder knows up front what they need to connect (Gmail, HubSpot, Slack…).
   * Empty when the route has no external dependencies.
   */
  what_you_need: IntegrationNeed[];
  /**
   * Deterministic, target-aware next steps (MAR-208).
   * Tells the reading agent what to do NEXT so the session doesn't dead-end.
   * Adapts to build_target if provided; offers all options if omitted.
   */
  suggested_next_actions: string[];
  /**
   * Bounded multiple-choice clarifying questions (MAR-225). Up to 3, returned
   * ONLY when the goal omits an architecture-affecting constraint (run trigger /
   * write-permission / outbound-send) that the route makes relevant. Each is
   * multiple-choice with a "Not sure yet" option. Stateless: the MCP stores
   * nothing — the client collects answers and folds them into a re-call's goal.
   * Empty when the goal already states its constraints (no nagging).
   */
  clarifying_questions: ClarifyingQuestion[];
  /**
   * Advisory multi-worker BUILD pipeline (MAR-166): the specialist workers
   * (planner → coder → reviewer → tester) recommended to implement this plan in
   * the user's own runtime, with their handoff contracts. Deterministic and the
   * same build team for every plan; empty when the registry has no workers.
   */
  worker_pipeline: WorkerPipeline;
  /**
   * Advisory bounded-loop guidance (MAR-167). Non-null only when the planned
   * route contains `loop_controller` — i.e. the goal asks for an iterative /
   * looping agent. Surfaces the canonical dynamic_worker_loop contract (max
   * iterations, stop/escalation conditions, the reviewer-independence and
   * no-write-until-final-gate guardrails) as the framework-agnostic spec to
   * export. The graph itself stays DAG-only; this is a control-flow annotation.
   */
  loop_guidance: LoopGuidance | null;
  /**
   * Earned-by-evidence autonomy level (MAR-168). Present on every plan. The
   * level is the highest blast-radius action class across the route; we ADVISE
   * whether it can run unattended and list the controls required to earn it —
   * we never drop the gate ourselves.
   */
  automation_clearance: AutomationClearance;
  next_steps: string[];
  /**
   * MAR-206: provenance model — which parts of this output are registry-derived
   * facts vs synthesised advisory text. Every field in this plan is computed
   * deterministically from the registry (component YAML, edge YAML, playbook YAML,
   * route YAML) with no LLM calls. The tags below document the exact source for
   * each field so a reading agent can verify claims independently.
   *
   * grounded  = value read directly from a registry YAML field
   * computed  = derived by deterministic logic over registry data (scores, ordering)
   * advisory  = registry-seeded but expressed as plain-language guidance
   */
  provenance: ProvenanceModel;
};

export type LoopGuidance = {
  playbook_id: string;
  worker_sequence: string[];
  loop_contract: LoopContract;
  guardrail_checklist: string[];
};

/**
 * When the planned route is loop-shaped (contains `loop_controller`), surface
 * the canonical bounded-loop contract from the dynamic_worker_loop playbook.
 * Sourced from the registry so the contract has a single source of truth, and
 * deliberately decoupled from playbook ROUTING so it never affects precision.
 *
 * MAR-209: only fires for WORKER BUILD LOOP routes (planner→coder→tester→reviewer).
 * When `fan_out_collector` is also present, the route is a DATA FAN-OUT pattern —
 * loop_controller drives parallel item processing and fan_out_collector merges results.
 * The dynamic_worker_loop contract describes software-development iteration and is
 * actively misleading for batch document / data processing goals.
 */
export function buildLoopGuidance(
  routeComponentIds: string[],
  registry: RegistrySnapshot,
): LoopGuidance | null {
  if (!routeComponentIds.includes("loop_controller")) return null;
  if (routeComponentIds.includes("fan_out_collector")) return null; // MAR-209
  const pb = registry.playbooks.find((p) => p.loop_contract);
  if (!pb || !pb.loop_contract) return null;
  return {
    playbook_id: pb.id,
    worker_sequence: pb.worker_sequence ?? [],
    loop_contract: pb.loop_contract,
    guardrail_checklist: pb.guardrails,
  };
}

/**
 * MAR-212: advisory note for routes containing `fan_out_collector`.
 *
 * The sequential DAG step list shows fan_out_collector as one component (the
 * merge/collect point) but hides the N parallel dispatch branches that run
 * simultaneously before the collector merges results. A developer reading the
 * plan could mistake this for a sequential pipeline.
 *
 * Returns a design note explaining the hidden parallelism so the builder sizes
 * concurrency budget and handles partial-failure merge strategies correctly.
 * Prepended to design_notes so it appears before edge-level annotations.
 */
function fanOutDesignNote(componentIds: string[]): string | null {
  if (!componentIds.includes("fan_out_collector")) return null;
  return (
    "[fan_out_collector] The step list shows the merge point only — N parallel " +
    "dispatch branches (one per input item) run simultaneously and are not shown " +
    "in the DAG. Size your concurrency budget before deploying: unbounded lists " +
    "exhaust API rate limits. Choose a merge_strategy (all_success | any_success | " +
    "best_of) and set a per-branch timeout."
  );
}

// ───────────────────────────── core ─────────────────────────────

/** Resolve component IDs to Component objects, preserving order, dropping unknowns. */
function resolveComponents(ids: string[], registry: RegistrySnapshot): Component[] {
  const byId = new Map(registry.components.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is Component => c !== undefined);
}

/** Run the deterministic review rule set over a route's component set. */
function reviewRoute(
  goal: string,
  componentIds: string[],
  riskLevel: string | undefined,
  registry: RegistrySnapshot,
): SafetyReview {
  const ctx = buildReviewContext(
    {
      goal,
      component_ids: componentIds,
      agents: [],
      tools: [],
      integrations: [],
      risk_level: riskLevel as "low" | "medium" | "high" | "critical" | undefined,
    },
    registry,
  );

  const findings: ReviewFinding[] = ALL_RULES.flatMap((rule) => rule(ctx));
  const risk_score = calculateRiskScore(findings);
  const status = deriveStatus(risk_score, findings);

  const blocking_issues = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => f.message);
  const warnings = findings
    .filter((f) => f.severity === "medium" || f.severity === "low")
    .map((f) => f.message);
  const approval_gates_required = findings.some(
    (f) =>
      f.category === "approval_gate" &&
      (f.severity === "critical" || f.severity === "high"),
  )
    ? ["human_approval_gate"]
    : [];

  return { status, risk_score, blocking_issues, warnings, approval_gates_required };
}

/** Untested edges fully within the route's component set, with severity (MAR-133). */
function untestedEdgesWithin(
  componentIds: string[],
  registry: RegistrySnapshot,
): UntestedEdge[] {
  return edgesWithinSet(new Set(componentIds), registry.edges)
    .filter((e) => !e.tested)
    .map((e) => ({ id: e.id, severity: e.severity }));
}

/**
 * Advisory design notes drawn from edge `control_flow_note` annotations (MAR-211).
 *
 * Edges carry a `control_flow_note` field for conditional/architectural guidance
 * that is too specific to belong in the component summary (e.g. "only add
 * saga_compensation when iterations have irreversible external side effects"). These
 * notes were previously stored in the registry but never surfaced in plan output —
 * an LLM reading the plan had no way to discover them without a separate edge lookup.
 *
 * Returns one string per non-empty note on an edge whose both endpoints are in
 * the route, formatted as "[from → to] note text".
 */
function controlFlowNotesWithin(
  componentIds: string[],
  registry: RegistrySnapshot,
): string[] {
  return edgesWithinSet(new Set(componentIds), registry.edges)
    .filter((e) => e.control_flow_note.length > 0)
    .map((e) => `[${e.from} → ${e.to}] ${e.control_flow_note}`);
}

// ────────────────────────── MAR-208 / MAR-124: integration catalog ──────────

type CatalogEntry = {
  label: string;
  product_examples: string[];
  auth_model: string;
  mcp_server: McpServerInfo;
  required_scopes: string[];
  gotchas: string[];
};

/**
 * External app + MCP server catalog (MAR-124 CTX-02).
 *
 * Keyed by component ID. Each entry records the primary product's auth model,
 * MCP server availability, least-privilege scopes, and common gotchas so
 * plan_workflow can surface concrete wiring guidance in `what_you_need`.
 *
 * Coverage: Gmail, Google Calendar, Slack, HubSpot, GitHub, Canva, Airtable,
 * Stripe (no MCP), Firecrawl, Perplexity/Exa, webhooks.
 */
const INTEGRATION_CATALOG: Record<string, CatalogEntry> = {
  email_read: {
    label: "Email provider — read inbox",
    product_examples: ["Gmail", "Outlook", "IMAP"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-gmail",
      transport: "stdio",
      note: "Google OAuth consent screen verification required for production; skip with a test user during dev",
    },
    required_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    gotchas: [
      "Rate limit: 250 quota units / second per user — batch list + fetch calls",
      "Refresh tokens expire after 6 months of non-use; build a token-rotation flow",
      "Gmail API returns a thread list, not individual messages — call messages.get per ID",
    ],
  },

  email_draft: {
    label: "Email provider — draft / send",
    product_examples: ["Gmail", "Outlook", "SMTP"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-gmail",
      transport: "stdio",
    },
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    gotchas: [
      "gmail.send scope is required even when sending a draft — compose alone is not enough",
      "Send-as restrictions apply if the user has multiple identities; validate the From address",
    ],
  },

  optional_email_send: {
    label: "Email sender (transactional)",
    product_examples: ["SendGrid", "Resend", "Gmail SMTP"],
    auth_model: "API key (Authorization: Bearer)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No MCP server; use the REST API directly (SendGrid v3 or Resend SDK)",
    },
    required_scopes: ["Mail Send (SendGrid)"],
    gotchas: [
      "Verify sender domain (SPF, DKIM) before production — unverified domains land in spam",
      "SendGrid free tier: 100 emails / day; Resend free tier: 3 000 emails / month",
      "Store the API key in a secret manager, never in source code",
    ],
  },

  calendar_lookup: {
    label: "Calendar — read events",
    product_examples: ["Google Calendar", "Outlook Calendar"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official MCP server; use a community package such as mcp-google-calendar",
    },
    required_scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    gotchas: [
      "API returns UTC; convert to the user's timezone for display",
      "Free / busy query is cheaper than listing all events — prefer it for availability checks",
    ],
  },

  calendar_write: {
    label: "Calendar — create / update events",
    product_examples: ["Google Calendar", "Outlook Calendar"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official MCP server; use a community package such as mcp-google-calendar",
    },
    required_scopes: ["https://www.googleapis.com/auth/calendar.events"],
    gotchas: [
      "Creating an event with attendees sends email invitations automatically — add sendUpdates=none to suppress",
      "Always specify timeZone in the event body; omitting it defaults to the calendar's timezone, which may differ from the user's",
    ],
  },

  crm_note_write: {
    label: "CRM — write contacts / notes",
    product_examples: ["HubSpot", "Salesforce", "Notion"],
    auth_model: "Private App token (HubSpot) / OAuth2 (Salesforce)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official HubSpot or Salesforce MCP; community implementations available on npm",
    },
    required_scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.notes.write",
    ],
    gotchas: [
      "Upsert contacts by email to avoid duplicates — HubSpot does not deduplicate by default",
      "Notes must be associated to a Contact, Deal, or Company via the associations API after creation",
      "HubSpot rate limit: 100 API requests / 10 seconds per token",
    ],
  },

  slack_notification: {
    label: "Slack — send messages",
    product_examples: ["Slack"],
    auth_model: "OAuth2 (bot token — create a Slack App and install to workspace)",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-slack",
      transport: "stdio",
    },
    required_scopes: ["chat:write", "channels:read"],
    gotchas: [
      "Use the channel ID (e.g. C12345678), not the name — names can change without the ID changing",
      "Bot must be invited to private channels before it can post; joining is not automatic",
      "Rate limit: Tier 3 — ~1 message / second per channel for most apps",
    ],
  },

  discord_notification: {
    label: "Discord — send messages",
    product_examples: ["Discord"],
    auth_model: "Bot token (create an application + bot at discord.com/developers) or a channel webhook URL",
    mcp_server: {
      availability: "community",
      package: "@modelcontextprotocol/server-discord (community) or a webhook adapter",
      transport: "stdio",
      note: "No official Anthropic/Discord MCP as of mid-2026; community servers exist, or post directly via the bot REST API / channel webhook",
    },
    required_scopes: ["bot", "Send Messages", "Read Message History"],
    gotchas: [
      "Use the numeric channel ID (enable Developer Mode → right-click channel → Copy ID), not the channel name",
      "The bot must be invited to the server with the bot scope AND granted Send Messages in the target channel — neither is automatic",
      "A leaked channel webhook URL lets anyone post; treat it like a secret and rotate if exposed",
      "Rate limit: ~5 requests / 2 seconds per channel; 429 responses return a retry_after you must honour",
    ],
  },

  teams_notification: {
    label: "Microsoft Teams — send messages",
    product_examples: ["Microsoft Teams"],
    auth_model: "Incoming webhook URL (per channel) or OAuth2 app token via Microsoft Graph",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No Teams MCP server as of mid-2026; post via an Incoming Webhook connector or the Microsoft Graph API directly",
    },
    required_scopes: ["ChannelMessage.Send (Graph)"],
    gotchas: [
      "Incoming Webhooks are being replaced by Workflows (Power Automate) connectors — confirm which your tenant allows before wiring",
      "Adaptive Card JSON must match the schema Teams accepts or the message renders blank with no error",
      "Graph API posting needs admin consent for application permissions in many tenants — budget for an IT approval step",
    ],
  },

  telegram_notification: {
    label: "Telegram — send messages",
    product_examples: ["Telegram"],
    auth_model: "Bot API token (create a bot via @BotFather)",
    mcp_server: {
      availability: "community",
      package: "community Telegram MCP servers, or the Bot API directly",
      transport: "stdio",
      note: "No official MCP; the Telegram Bot API is simple to call directly with the token from @BotFather",
    },
    required_scopes: ["sendMessage"],
    gotchas: [
      "A user must message the bot first (or the bot must be added to the group) before it can send to that chat — you cannot DM a cold user",
      "chat_id is numeric and differs for users, groups, and channels; resolve it from an incoming update, do not guess",
      "The bot token in the URL path is a full credential — never log request URLs",
    ],
  },

  chat_trigger: {
    label: "Chat platform — receive messages (inbound)",
    product_examples: ["Slack", "Discord", "Microsoft Teams", "Telegram"],
    auth_model: "Platform bot token + a request-signing secret (Slack signing secret / Discord interaction public key / Telegram secret_token)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "Inbound chat events arrive via the platform's Events/Webhook/Interactions API to YOUR endpoint — MCP servers cover outbound posting, not the inbound listener; run a small webhook receiver (Slack Events API / Discord Interactions / Telegram webhook)",
    },
    required_scopes: ["app_mentions:read", "channels:history", "commands"],
    gotchas: [
      "AUTHORIZATION IS THE KEY RISK: verify WHO sent the message (allowed user/role/channel) before running any action — an open bot lets anyone in the channel trigger privileged work",
      "Verify the request signature on every inbound event (Slack signing secret / Discord Ed25519 / Telegram secret_token) and reject anything unsigned",
      "Treat the message body as untrusted input — classify intent before acting; do not let message text expand the agent's allowed tools (prompt injection)",
      "Deduplicate on the platform message/event id — platforms retry delivery and will double-trigger without it",
    ],
  },

  reviewer_notification: {
    label: "Notification channel (review request)",
    product_examples: ["Slack", "email", "webhook"],
    auth_model: "OAuth2 (bot token) or API key depending on channel",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-slack",
      transport: "stdio",
      note: "Official MCP covers Slack; use email/webhook adapter for other channels",
    },
    required_scopes: ["chat:write", "users:read"],
    gotchas: [
      "Include a deep link back to the item under review — reviewers need context without hunting",
      "Set a deadline in the notification; open-ended review requests are often ignored",
    ],
  },

  stripe_data_read: {
    label: "Stripe — read payments / subscriptions",
    product_examples: ["Stripe"],
    auth_model: "Restricted API key (read-only, scoped to required resources)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No official Stripe MCP server as of mid-2025; use the Stripe SDK or REST API directly",
    },
    required_scopes: ["charges:read", "customers:read", "subscriptions:read"],
    gotchas: [
      "Never use the secret key (sk_live_…) in an agent — create a Restricted Key with only the scopes needed",
      "Test mode keys (sk_test_…) and live mode keys are separate; confirm the environment before wiring",
      "Webhook events (not polling) are the correct pattern for real-time payment notifications",
    ],
  },

  external_publish: {
    label: "Publishing platform — post content",
    product_examples: ["Canva", "Buffer", "WordPress"],
    auth_model: "OAuth2 (Canva Connect API / Buffer OAuth2) or API key (WordPress REST API)",
    mcp_server: {
      availability: "official",
      transport: "http",
      note: "Canva provides an official hosted MCP server — register your app at developer.canva.com to get the endpoint URL",
    },
    required_scopes: [
      "design:content:read",
      "design:content:write",
      "asset:read",
      "asset:write",
      "brandtemplate:content:read",
    ],
    gotchas: [
      "Canva MCP requires app registration at developer.canva.com; OAuth consent screen approval takes 1-3 business days",
      "Brand Kit access needs brandtemplate:* scopes — request them at registration time",
      "Canva export (PNG/PDF) triggers an async job; poll the export URL until status === 'succeeded'",
      "Buffer rate limit: 10 posts / hour on free plan; upgrade for production social scheduling",
    ],
  },

  page_monitor: {
    label: "Web monitor / scraper",
    product_examples: ["Firecrawl", "Playwright", "Puppeteer"],
    auth_model: "API key (X-API-Key header)",
    mcp_server: {
      availability: "official",
      package: "npx @firecrawl/mcp",
      transport: "stdio",
    },
    required_scopes: [],
    gotchas: [
      "JavaScript-heavy pages may need the waitFor option to let the DOM fully render before scraping",
      "Check robots.txt and Terms of Service for the target site before production use",
      "Firecrawl free tier: 500 pages / month — upgrade before putting in production",
    ],
  },

  data_scraper: {
    label: "Web scraper",
    product_examples: ["Firecrawl", "Playwright", "BeautifulSoup"],
    auth_model: "API key (X-API-Key header)",
    mcp_server: {
      availability: "official",
      package: "npx @firecrawl/mcp",
      transport: "stdio",
    },
    required_scopes: [],
    gotchas: [
      "Use /crawl for multi-page sites and /scrape for single pages — they have different rate-limit buckets",
      "Anti-bot measures (Cloudflare, Akamai) block headless browsers; use Firecrawl's stealth mode for resilience",
    ],
  },

  github_trigger: {
    label: "GitHub — webhooks / events",
    product_examples: ["GitHub"],
    auth_model: "Fine-grained Personal Access Token (PAT) or GitHub OAuth App",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-github",
      transport: "stdio",
    },
    required_scopes: ["Repository: Contents (read)", "Repository: Pull requests (read/write)", "Repository: Metadata (read)"],
    gotchas: [
      "Webhooks require a publicly reachable HTTPS URL — use a tunnel (ngrok / smee.io) during local dev",
      "Fine-grained PATs expire (max 1 year by org policy); set a calendar reminder to rotate before expiry",
      "Always validate the webhook X-Hub-Signature-256 header to prevent spoofed events",
      "Rate limit: 5 000 requests / hour per authenticated token",
    ],
  },

  webhook_trigger: {
    label: "Webhook endpoint (inbound)",
    product_examples: ["your server", "Vercel Function", "AWS Lambda"],
    auth_model: "Shared secret (HMAC-SHA256 signature validation)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "Self-hosted endpoint — no MCP server; handle via your existing HTTP runtime",
    },
    required_scopes: [],
    gotchas: [
      "Always validate the webhook signature before processing — reject unsigned or malformed payloads",
      "Respond HTTP 200 immediately and process the event asynchronously to avoid sender timeouts",
      "Implement idempotency: webhook senders retry on failure, so duplicate events are expected",
    ],
  },

  airtable_lookup: {
    label: "Airtable — read base",
    product_examples: ["Airtable"],
    auth_model: "Personal Access Token (PAT) — OAuth2 available for marketplace apps",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official Airtable MCP; community packages available — check npm for mcp-airtable",
    },
    required_scopes: ["data.records:read", "schema.bases:read"],
    gotchas: [
      "Records API returns max 100 records per page — use the offset token to paginate large tables",
      "Formula fields are computed server-side; filtering by them on large tables is slow — add a native field index",
      "Rate limit: 5 requests / second per base — add exponential back-off for bulk reads",
    ],
  },

  // MAR-217: knowledge / second-brain components
  vector_store: {
    label: "Vector database — semantic index for owned corpus",
    product_examples: ["pgvector (Supabase / Postgres)", "Pinecone", "Chroma", "LanceDB"],
    auth_model: "API key or connection string (service-specific)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No standard MCP for vector stores as of mid-2025; use provider SDKs (supabase-js, @pinecone-database/pinecone, chromadb, lancedb) directly",
    },
    required_scopes: ["index:read", "index:write"],
    gotchas: [
      "SECURITY: notes may contain credentials, tokens, or PII — scope the index to the owned corpus, strip secrets before embedding, never index raw environment files",
      "Embedding model drift makes old and new vectors incomparable: pin the embedding model version and re-embed when upgrading",
      "Similarity search returns confident neighbours even when no good match exists — enforce a minimum similarity score to avoid hallucination-enabling low-quality results",
      "pgvector on Supabase: enable the pgvector extension in the Supabase dashboard; use HNSW index (not IVFFlat) for production recall",
      "Pinecone free tier has 1 index limit; serverless tier bills per read/write unit — monitor usage before indexing large corpora",
    ],
  },

  source_retrieval: {
    label: "Search / research API",
    product_examples: ["Perplexity", "Exa", "Brave Search"],
    auth_model: "API key (Authorization: Bearer)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No official MCP for Perplexity or Exa as of mid-2025; use their REST SDKs directly",
    },
    required_scopes: [],
    gotchas: [
      "Perplexity results include cited sources — validate source quality for factual claims before downstream use",
      "Exa offers neural and keyword search modes; keyword is faster, neural is higher recall for research tasks",
      "Search APIs have per-query cost; cache results and avoid re-querying the same topic within a session",
    ],
  },
};

/**
 * MAR-208 / MAR-124: derive the concrete "products you'll wire up" list from
 * the route. Looks up each component against the integration catalog and returns
 * enriched entries (auth model, MCP availability, scopes, gotchas) so a builder
 * knows up front what they need to connect and how.
 */
function buildWhatYouNeed(
  componentIds: string[],
  registry: RegistrySnapshot,
): IntegrationNeed[] {
  const byId = new Map(registry.components.map((c) => [c.id, c]));
  return componentIds
    .filter((id) => INTEGRATION_CATALOG[id] !== undefined)
    .map((id) => {
      const entry = INTEGRATION_CATALOG[id];
      const c = byId.get(id);
      const scopes = c ? [...c.permissions.read, ...c.permissions.write] : [];
      return {
        component_id: id,
        label: entry.label,
        product_examples: entry.product_examples,
        scopes,
        auth_model: entry.auth_model,
        mcp_server: entry.mcp_server,
        required_scopes: entry.required_scopes,
        gotchas: entry.gotchas,
      };
    });
}

/**
 * MAR-208: deterministic, target-aware next steps so the session doesn't dead-end.
 *
 * When build_target is provided, leads with the most relevant action for that
 * environment. Without a target, offers all three options (CoWork / code / GPT)
 * so the reading agent can prompt the user to choose.
 */
function buildSuggestedNextActions(
  planSource: PlanSource,
  playbook: PlanPlaybook | null,
  buildTarget: BuildTarget | undefined,
  whatYouNeed: IntegrationNeed[],
): string[] {
  const COWORK = "Ask me to generate the CoWork system prompt for this plan — paste it into a Claude Project to configure an assistant";
  const CURSOR  = "Call `export_build_brief({ handoff_targets: ['prompt'] })` for the full Cursor / Claude Code build spec";
  const GPT     = "Ask me to generate the ChatGPT Custom GPT system prompt and Actions JSON";
  const REVIEW  = "Call `review_workflow_design(...)` after building to validate your implementation against the plan";

  const actions: string[] = [];

  switch (buildTarget) {
    case "cowork":
      actions.push(COWORK);
      actions.push("Ask me which Claude tools to connect for each step in the plan");
      break;
    case "cursor":
    case "code":
      actions.push(CURSOR);
      actions.push("Ask me for the inter-step data contracts (what each step receives and returns)");
      break;
    case "chatgpt_gpt":
      actions.push(GPT);
      actions.push("Add the hosted MCP URL to your GPT Actions (see orchestratemcp.dev for the connection URL)");
      break;
    default:
      // No target — offer all three so the agent can prompt the user to choose
      actions.push(`[a] ${COWORK}`);
      actions.push(`[b] ${CURSOR}`);
      actions.push(`[c] ${GPT}`);
  }

  if (whatYouNeed.length > 0) {
    const top = whatYouNeed.slice(0, 3).map((n) => n.product_examples[0]).join(", ");
    const extra = whatYouNeed.length > 3 ? ` + ${whatYouNeed.length - 3} more (see what_you_need)` : "";
    actions.push(`Wire up the integrations: ${top}${extra}`);
  }

  actions.push(REVIEW);
  return actions;
}

// ─────────────────────────── MAR-225: clarifying questions ───────────────────

/** Outbound external-send components (post/publish/message to people). */
const OUTBOUND_SEND_COMPONENTS = new Set([
  "external_publish",
  "optional_email_send",
  "slack_notification",
  "discord_notification",
  "teams_notification",
  "telegram_notification",
  "reviewer_notification",
]);

/** Goal phrases that STATE write intent (so we don't ask the write question). */
const WRITE_INTENT_SIGNALS = [
  "write", "update", "edit", "modif", "change", "post ", "send", "creat",
  "delete", "remov", "publish", "save", "insert", "draft", "reply", "repli",
  "notif", "alert", "commit", "merge", "deploy", "upsert", "sync",
];
const READONLY_SIGNALS = [
  "read-only", "read only", "don't write", "do not write", "never write",
  "no writes", "without writing", "only read", "just read", "report only",
  "read and report", "read-and-report", "summari", "analyse only", "analyze only",
];

/** Goal phrases that STATE outbound intent / draft-only (skip the send question). */
const OUTBOUND_SIGNALS = [
  "send", "email", "e-mail", "post ", "publish", "notif", "alert", "slack",
  "discord", "teams", "telegram", "message", "externally", "outbound", "tweet",
];
const DRAFT_INTENT_SIGNALS = [
  "draft", "don't send", "do not send", "without sending", "for review",
  "for my approval", "prepare", "internal only", "internal-only",
  "for me to send", "i'll send", "i will send", "review before",
];

/** Goal phrases that imply the workflow should run automatically/recurringly. */
const AUTOMATION_INTENT_SIGNALS = [
  "automatic", "automate", "autonomous", "ongoing", "continuous", "recurring",
  "every time", "whenever", "monitor", "watch for", "on a schedule", "scheduled",
  "periodically", "unattended", "hands-off", "hands off", "keep it running",
];
/** Goal phrases that already NAME a concrete trigger (skip the trigger question). */
const TRIGGER_SPECIFIED_SIGNALS = [
  "hourly", "daily", "weekly", "nightly", "every hour", "every day",
  "each morning", "each day", "cron", "webhook", "on push", "pull request",
  "when an email", "when a new", "on receiving", "on receipt", "manually",
  "on demand", "i run", "button", "in chat", "mention", "arrives", "is received",
  "incoming",
];

function anySignal(goal: string, signals: string[]): boolean {
  return signals.some((s) => goal.includes(s));
}

/**
 * MAR-225: bounded multiple-choice clarifying questions. Returns at most 3,
 * each only when the route makes the axis relevant AND the goal has NOT already
 * stated that constraint — so it never nags a fully-specified goal. Stateless
 * and vocabulary-neutral (never steers "magic" trigger words); each question is
 * a real architecture fork that changes the route / safety / clearance.
 */
export function buildClarifyingQuestions(
  goal: string,
  routeComponentIds: string[],
): ClarifyingQuestion[] {
  const g = goal.toLowerCase();
  const questions: ClarifyingQuestion[] = [];

  // 1. Run trigger — they want automation but didn't say what fires it, and no
  //    trigger component is in the route.
  const hasTriggerComponent = routeComponentIds.some((id) => id.endsWith("_trigger"));
  if (
    anySignal(g, AUTOMATION_INTENT_SIGNALS) &&
    !anySignal(g, TRIGGER_SPECIFIED_SIGNALS) &&
    !hasTriggerComponent
  ) {
    questions.push({
      id: "run_trigger",
      question: "How should this workflow start each time?",
      options: ["On a schedule", "On an event / webhook", "Manually, when I run it", "Not sure yet"],
    });
  }

  // 2. Write-permission — the route makes changes but the goal never authorised
  //    writes (no write verb) and didn't say read-only.
  const hasWrite = routeComponentIds.some((id) => ALWAYS_REQUIRES_GATE.has(id));
  if (
    hasWrite &&
    !anySignal(g, WRITE_INTENT_SIGNALS) &&
    !anySignal(g, READONLY_SIGNALS)
  ) {
    questions.push({
      id: "write_permission",
      question: "Should it be able to make changes (write / update / create), or read-and-report only?",
      options: ["Read & report only", "Write/update — with my approval", "Write/update automatically", "Not sure yet"],
    });
  }

  // 3. Outbound-send — the route sends/posts externally but the goal never asked
  //    for an external send and didn't say draft/internal-only.
  const hasOutbound = routeComponentIds.some((id) => OUTBOUND_SEND_COMPONENTS.has(id));
  if (
    hasOutbound &&
    !anySignal(g, OUTBOUND_SIGNALS) &&
    !anySignal(g, DRAFT_INTENT_SIGNALS)
  ) {
    questions.push({
      id: "outbound_send",
      question: "May it send or post things externally, or only prepare drafts for you?",
      options: ["Send / post externally — with approval", "Prepare drafts only — I'll send", "Keep everything internal", "Not sure yet"],
    });
  }

  return questions.slice(0, 3);
}

/**
 * MAR-225: compact, brevity-safe render of clarifying questions (bullets only;
 * the call site supplies the heading). Each line is one question + its inline
 * options, kept short so Layer-1 stays under the brevity bound.
 */
function renderClarifyingQuestions(questions: ClarifyingQuestion[]): string[] {
  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`- ${q.question} — ${q.options.join(" · ")}`);
  }
  if (lines.length > 0) lines.push(``);
  return lines;
}

/**
 * MAR-101: scannable front-matter status block prepended to every
 * `summary_markdown`, regardless of `output_depth`. It surfaces the four facts
 * that decide whether a plan is safe to build — route_status, safety, blocking
 * issues, approval state, untested-edge count — at the very top so pipeline
 * problems (an unvalidated route, a failed safety review, a write that forfeits
 * its gate) are unmissable instead of buried below the step list.
 *
 * Rendered as a YAML-style front-matter fence: machine-scannable for a client
 * that wants to gate on it, glanceable for a human, with a ✅/⚠️/❌ status icon
 * per line.
 *
 * MAR-148: the `approval` line distinguishes ENFORCED gates (present in the
 * route) from gates the review REQUIRES but the route does not contain — the
 * G2 gap that used to read as a self-contradiction. A required-but-unenforced
 * gate (with no deliberate waiver) is the most dangerous state and renders ❌.
 */
function buildStatusHeader(
  routeStatus: string,
  safety: SafetyReview,
  untestedEdges: UntestedEdge[],
  enforcedGates: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  clearance: AutomationClearance,
): string {
  const routeIcon =
    routeStatus === "validated" ? "✅" : routeStatus === "blocked_candidate" ? "❌" : "⚠️";
  const safetyIcon =
    safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  const blockingCount = safety.blocking_issues.length;
  const blockingIcon = blockingCount === 0 ? "✅" : "❌";

  // enforced (present) → advisory (deliberately waived) → required-but-missing
  // (the G2 gap) → none needed.
  let approval: string;
  if (enforcedGates.length > 0) {
    approval = `✅ enforced — ${enforcedGates.join(", ")}`;
  } else if (approvalAdvisory) {
    approval = `⚠️ advisory — ${approvalAdvisory.gate} kept but not enforced (you waived it)`;
  } else if (safety.approval_gates_required.length > 0) {
    approval = `❌ REQUIRED but NOT enforced — ${safety.approval_gates_required.join(", ")}`;
  } else {
    approval = "✅ none needed";
  }

  const untestedIcon = untestedEdges.length === 0 ? "✅" : "⚠️";

  // MAR-168: autonomy clearance. ✅ may run unattended · ⚠️ human by default
  // (earnable) · ❌ human always required (L4).
  const autoIcon = clearance.autonomous_allowed
    ? "✅"
    : clearance.level === "L4"
    ? "❌"
    : "⚠️";
  const autoText = clearance.autonomous_allowed
    ? "may run unattended"
    : clearance.level === "L4"
    ? "human ALWAYS required"
    : "human by default";

  return [
    `---`,
    `route_status:   ${routeIcon} ${routeStatus}`,
    `safety:         ${safetyIcon} ${safety.status} (risk ${safety.risk_score}/100)`,
    `blocking:       ${blockingIcon} ${blockingCount} issue${blockingCount === 1 ? "" : "s"}`,
    `approval:       ${approval}`,
    `automation:     ${autoIcon} ${clearance.level} — ${autoText}`,
    `untested_edges: ${untestedIcon} ${untestedEdges.length}`,
    `---`,
  ].join("\n");
}

/**
 * MAR-224: brevity bound on the Layer-1 (guided/brief) markdown. The
 * RESPONSE-UX-04 eval (MAR-227) asserts the rendered summary stays under this
 * so "report creep" fails CI instead of silently re-bloating Layer 1.
 */
export const LAYER1_MAX_CHARS = 2400;

/**
 * MAR-224: Layer-1 concise "decision UI" rendering (the default).
 *
 * Shows only what a builder needs to DECIDE: (1) what they asked for, (2) the
 * recommended route as a single line — not 10 step blocks, (3) the integrations
 * to connect (names only, no per-scope gotchas), (4) the key safeguard
 * (approval / irreversible-write boundary), (5) a next-action menu, plus a
 * one-line provenance note. The full step list, model tiers,
 * credentials/gotchas, worker pipeline, evals and the full provenance block move
 * to `output_depth: "technical"`/"deep". The scannable status front-matter
 * (buildStatusHeader) is prepended separately and carries the safety glance.
 */
function buildGuidedPlanMarkdown(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  playbook: PlanPlaybook | null,
  safety: SafetyReview,
  enforcedGates: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  clearance: AutomationClearance,
  whatYouNeed: IntegrationNeed[],
  suggestedNextActions: string[],
  clarifyingQuestions: ClarifyingQuestion[],
  /**
   * MAR-224: when true (`standard` depth) the recommended route is rendered as a
   * full numbered step list with per-step risk instead of the one-line chain —
   * a clean superset of the guided layer that still omits the technical block
   * (model tiers, credentials, worker pipeline, provenance block = Layer 2).
   */
  fullSteps: boolean,
): string {
  const lines: string[] = [];

  // (1) what you want — bound the echo so the brevity cap holds for any goal
  // length (the full goal is always in the JSON `goal` field).
  const shownGoal = goal.length > 240 ? `${goal.slice(0, 240).trimEnd()}…` : goal;
  lines.push(`**You want:** ${shownGoal}`, ``);

  // (2) what we recommend — one line, not 10 step blocks
  const MAX_NODES = 10;
  const names = steps.map((s) => s.component_name ?? s.component_id);
  const chain =
    names.length > MAX_NODES
      ? `${names.slice(0, MAX_NODES).join(" → ")} → … (+${names.length - MAX_NODES})`
      : names.join(" → ");
  if (planSource === "playbook" && playbook) {
    lines.push(
      `**Recommended:** validated playbook \`${playbook.id}\` — ${playbook.title} (${steps.length} steps)`,
    );
  } else {
    lines.push(`**Recommended:** composed candidate route (${steps.length} steps)`);
  }
  if (fullSteps) {
    lines.push(``, `**Steps:**`);
    for (const s of steps) {
      lines.push(
        `${s.step}. **${s.component_name ?? s.component_id}** — ${s.purpose} [${s.risk_level} risk]`,
      );
    }
    lines.push(``);
  } else {
    lines.push(`> ${chain}`, ``);
  }

  // (3) what to connect — integration NAMES only, no scopes / gotchas (those are Layer 2)
  if (whatYouNeed.length > 0) {
    lines.push(`**To connect:** ${whatYouNeed.map((n) => n.label).join(", ")}`, ``);
  } else {
    lines.push(`**To connect:** nothing external — all steps are internal / deterministic`, ``);
  }

  // (4) key safeguard — approval boundary + irreversible-write note, plain language
  let safeguard: string;
  if (enforcedGates.length > 0) {
    safeguard = enforcedGates.includes("human_approval_gate")
      ? `a human approval step is enforced before anything external happens — keep it`
      : `approval is enforced (${enforcedGates.join(", ")}) — keep it`;
  } else if (approvalAdvisory) {
    safeguard = `approval gate kept as advisory (you waived enforcement) — re-enable it to run unattended`;
  } else if (safety.approval_gates_required.length > 0) {
    safeguard = `⚠️ approval is REQUIRED but not in the route — add ${safety.approval_gates_required.join(", ")} before building`;
  } else {
    safeguard = `no approval gate required for this plan`;
  }
  lines.push(`**Key safeguard:** ${safeguard}.`);
  if (steps.some((s) => s.risk_level === "high" || s.risk_level === "critical")) {
    lines.push(`Some steps make irreversible external writes — do not run unattended past the gate.`);
  }
  const autoText = clearance.autonomous_allowed
    ? "may run unattended"
    : clearance.level === "L4"
    ? "human always required"
    : "human in the loop by default";
  lines.push(`**Autonomy:** ${clearance.level} — ${autoText}.`, ``);

  // MAR-225: bounded clarifying questions (only when an architecture-affecting
  // constraint is missing) — placed before the next-action menu.
  if (clarifyingQuestions.length > 0) {
    lines.push(`**Quick checks to pin down the plan** (pick one each, or "Not sure yet"):`);
    lines.push(...renderClarifyingQuestions(clarifyingQuestions));
  }

  // (5) next-action menu (RESPONSE-UX-03)
  if (suggestedNextActions.length > 0) {
    lines.push(`**Next — pick one:**`);
    for (const a of suggestedNextActions) lines.push(`- ${a}`);
    lines.push(``);
  }

  // one-line provenance + depth hint (the full provenance block is Layer 2)
  lines.push(
    `> 🟢 Route, safety and autonomy above are registry-grounded (no LLM). Anything you add is ` +
      `🔵 suggested — don't present it as a registry fact. For the full step-by-step plan, model ` +
      `tiers, credentials and build team, call again with \`output_depth: "technical"\`.`,
  );

  return lines.join("\n");
}

function buildPlanMarkdown(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  playbook: PlanPlaybook | null,
  safety: SafetyReview,
  modelTiers: PlanWorkflowOutput["model_tier_profile"],
  credentials: CredentialAdvisory,
  untestedEdges: UntestedEdge[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  workerPipeline: WorkerPipeline,
  loopGuidance: LoopGuidance | null,
  clearance: AutomationClearance,
  designNotes: string[],
  whatYouNeed: IntegrationNeed[],
  suggestedNextActions: string[],
  clarifyingQuestions: ClarifyingQuestion[],
): string {
  const lines: string[] = [];

  if (planSource === "playbook" && playbook) {
    lines.push(
      `## ✅ Plan: use validated playbook \`${playbook.id}\``,
      ``,
      `**Goal:** ${goal}`,
      ``,
      `> This goal is covered by the validated playbook **${playbook.title}** ` +
        `(\`${playbook.id}\`, route \`${playbook.route_id}\`, recall ${Math.round(playbook.recall * 100)}%, ` +
        `precision ${Math.round(playbook.precision * 100)}%). The plan below is its golden-path route — ` +
        `prefer it over a freshly composed candidate.`,
      ``,
    );
  } else {
    lines.push(
      `## 🧩 Plan: composed candidate route`,
      ``,
      `**Goal:** ${goal}`,
      ``,
      `> No validated playbook strongly matches this goal, so this is a CANDIDATE route ` +
        `composed from the graph. Review the untested edges and safety findings before building.`,
      ``,
    );
  }

  lines.push(`### Steps`, ``);
  for (const s of steps) {
    const tierTag = s.model_tier === "none" ? "deterministic" : `${s.model_tier} LLM`;
    lines.push(
      `${s.step}. **\`${s.component_id}\`** [${tierTag}, risk: \`${s.risk_level}\`] — ${s.purpose}`,
    );
  }
  lines.push(``);

  lines.push(`### Model-tier profile`, ``);
  if (modelTiers.frontier.length > 0)
    lines.push(`- **frontier:** ${modelTiers.frontier.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.standard.length > 0)
    lines.push(`- **standard:** ${modelTiers.standard.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.small.length > 0)
    lines.push(`- **small:** ${modelTiers.small.map((c) => `\`${c}\``).join(", ")}`);
  if (modelTiers.none.length > 0)
    lines.push(`- **deterministic (no LLM):** ${modelTiers.none.map((c) => `\`${c}\``).join(", ")}`);
  lines.push(``);

  // MAR-168: autonomy clearance section.
  const autoMark = clearance.autonomous_allowed ? "✅" : clearance.level === "L4" ? "❌" : "⚠️";
  lines.push(
    `### Automation clearance: ${autoMark} ${clearance.level}`,
    ``,
    `**Autonomous allowed:** ${clearance.autonomous_allowed ? "yes" : "no — human in the loop"}`,
    ``,
    `> ${clearance.reason}`,
    ``,
  );
  if (clearance.highest_action_components.length > 0) {
    lines.push(
      `Driven by: ${clearance.highest_action_components.map((c) => `\`${c}\``).join(", ")}`,
      ``,
    );
  }
  if (clearance.required_controls.length > 0) {
    lines.push(`**Required controls to run unattended:**`);
    for (const ctrl of clearance.required_controls) lines.push(`- ${ctrl}`);
    lines.push(``);
  }

  const safetyEmoji =
    safety.status === "pass" ? "✅" : safety.status === "warnings" ? "⚠️" : "❌";
  lines.push(
    `### Safety review`,
    ``,
    `**Status:** ${safetyEmoji} ${safety.status.toUpperCase()} | **Risk score:** ${safety.risk_score}/100`,
    ``,
  );
  if (safety.blocking_issues.length > 0) {
    lines.push(`**Blocking issues (${safety.blocking_issues.length}):**`);
    for (const b of safety.blocking_issues) lines.push(`- ${b}`);
    lines.push(``);
  }
  if (approvalAdvisory) {
    lines.push(
      `**⚠️ Approval gate (advisory, not enforced):** ${approvalAdvisory.reason}`,
      ``,
    );
  }
  if (safety.approval_gates_required.length > 0) {
    lines.push(
      `**Approval gates required:** ${safety.approval_gates_required.map((g) => `\`${g}\``).join(", ")}`,
      ``,
    );
  }

  if (credentials.components_requiring_credentials.length > 0) {
    lines.push(`### Credentials & permissions`, ``);
    for (const c of credentials.components_requiring_credentials) {
      const scopes = c.required_scopes.length > 0 ? c.required_scopes.join("; ") : "see component docs";
      lines.push(`- **\`${c.component_id}\`** needs: ${scopes}`);
    }
    if (credentials.secret_manager_recommendation) {
      lines.push(``, `> ${credentials.secret_manager_recommendation}`);
    }
    lines.push(``);
  }

  if (untestedEdges.length > 0) {
    lines.push(
      `### Untested edges (${untestedEdges.length})`,
      ``,
      `${untestedEdges.slice(0, 8).map((e) => `\`${e.id}\` (${e.severity})`).join(", ")}${untestedEdges.length > 8 ? " …" : ""}`,
      ``,
    );
  }

  // MAR-166: advisory build team for implementing this plan in your runtime.
  if (workerPipeline.workers.length > 0) {
    lines.push(
      `### Build team (worker pipeline)`,
      ``,
      `> Specialist workers with safe contracts to BUILD this plan — handed off ` +
        `in order. OrchestrateMCP recommends the team; you run it in your own runtime.`,
      ``,
    );
    const chain = workerPipeline.workers.map((w) => `\`${w.worker_id}\``).join(" → ");
    lines.push(`**Pipeline:** ${chain}`, ``);
    for (const w of workerPipeline.workers) {
      const tier = w.model_tier === "none" ? "deterministic" : `${w.model_tier} tier`;
      lines.push(
        `${w.step}. **${w.title}** (\`${w.role}\`, ${tier}) — ` +
          `consumes: ${w.inputs.join("; ") || "—"} → produces: ${w.outputs.join("; ") || "—"}`,
      );
    }
    if (workerPipeline.feedback_loops.length > 0) {
      lines.push(
        ``,
        `**Fix loops:** ${workerPipeline.feedback_loops
          .map((h) => `\`${h.from}\` → \`${h.to}\``)
          .join(", ")}`,
      );
    }
    lines.push(``);
  }

  // MAR-211: design notes from edge control_flow_note annotations.
  if (designNotes.length > 0) {
    lines.push(`### Design notes`, ``);
    for (const n of designNotes) lines.push(`- ${n}`);
    lines.push(``);
  }

  // MAR-167: bounded-loop contract when the route is loop-shaped.
  if (loopGuidance) {
    const lc = loopGuidance.loop_contract;
    lines.push(
      `### Loop contract & guardrails`,
      ``,
      `> This plan loops. It MUST be bounded and reviewer-independent. Export ` +
        `this contract to your runtime (Cowork / LangGraph / CrewAI) — the graph ` +
        `stays DAG-only; the loop bound lives in the contract.`,
      ``,
      `- **Worker loop:** ${loopGuidance.worker_sequence.map((w) => `\`${w}\``).join(" → ")}`,
      `- **max_iterations:** ${lc.max_iterations}`,
      `- **Stop when:** ${lc.stop_condition}`,
      `- **Escalate when:** ${lc.escalation_condition}`,
      `- **Human gate required for:** ${lc.human_gate_required_for.join(", ")}`,
      `- **State persisted:** ${lc.state_required ? "yes" : "no"} · **Audited:** ${lc.audit_required ? "yes" : "no"}`,
      `- **Reviewer independent of planner/coder:** ${lc.reviewer_independent ? "yes" : "no"}`,
      `- **No external write/deploy/send until final gate:** ${lc.no_write_until_final_gate ? "yes" : "no"}`,
      ``,
      `**Guardrail checklist:**`,
    );
    for (const g of loopGuidance.guardrail_checklist) lines.push(`- [ ] ${g}`);
    lines.push(``);
  }

  // MAR-208 / MAR-124: "What you'll need" — concrete integrations to wire up.
  if (whatYouNeed.length > 0) {
    lines.push(`### What you'll need`, ``);
    for (const n of whatYouNeed) {
      const examples = n.product_examples.slice(0, 2).join(" / ");
      const authStr = n.auth_model ? ` | auth: ${n.auth_model}` : "";
      const mcpStr = n.mcp_server
        ? ` | MCP: ${n.mcp_server.availability}${n.mcp_server.package ? ` (\`${n.mcp_server.package}\`)` : ""}`
        : "";
      const scopeStr = n.required_scopes.length > 0
        ? ` | scopes: ${n.required_scopes.slice(0, 2).join(", ")}`
        : n.scopes.length > 0 ? ` | scopes: ${n.scopes.slice(0, 2).join(", ")}` : "";
      lines.push(`- **\`${n.component_id}\`** → ${n.label} — e.g. ${examples}${authStr}${mcpStr}${scopeStr}`);
    }
    lines.push(``);
  }

  // MAR-225: bounded clarifying questions (architecture-affecting only).
  if (clarifyingQuestions.length > 0) {
    lines.push(`### Quick checks to pin down the plan`, ``);
    lines.push(...renderClarifyingQuestions(clarifyingQuestions));
  }

  // MAR-208: "Suggested next actions" — target-aware, prevents dead-ending.
  if (suggestedNextActions.length > 0) {
    lines.push(`### Suggested next actions`, ``);
    for (const a of suggestedNextActions) lines.push(`- ${a}`);
    lines.push(``);
  }

  // MAR-206: provenance footer — makes the grounded/advisory distinction visible
  // in the human-readable plan so a reading agent doesn't launder its own
  // elaborations as registry facts.
  lines.push(
    `---`,
    ``,
    `> **Provenance:** All component IDs, edge relations, route status, safety findings, ` +
      `and clearance levels above are 🟢 **registry-grounded** — deterministically computed ` +
      `from the component/edge YAML files with no LLM calls. Purpose descriptions come from ` +
      `\`component.summary\` fields in the registry. Any elaboration you add as an agent is ` +
      `🔵 **suggested** — do not present it as a registry fact.`,
    ``,
  );

  return lines.join("\n");
}

// ─────────────────────────── MAR-206: provenance model ───────────────────────

/**
 * Build the provenance model for a plan_workflow result. All fields are tagged
 * with how they are derived from the registry — grounded / computed / advisory.
 * This model is appended to every plan so a reading agent (Claude, ChatGPT) can
 * verify each claim independently and avoid presenting its own elaborations as
 * registry-derived facts.
 */
function buildProvenance(planSource: PlanSource): ProvenanceModel {
  return {
    model: "registry-deterministic",
    all_fields_are_registry_derived: true,
    field_tags: {
      // direct registry values
      recommended_route: "grounded",
      planning_order: "grounded",
      execution_order: "computed",  // topo-sort of registry edges
      model_tier_profile: "grounded",
      playbook: "grounded",
      route_status: planSource === "playbook" ? "grounded" : "computed",
      route_score: "computed",
      confidence_label: "computed",
      stack: "grounded",
      safety_review: "computed",
      credential_advisory: "computed",
      untested_edges: "grounded",
      avoid_when_violations: "computed",
      enforced_approval_gates: "computed",
      approval_gate_advisory: "advisory",
      automation_clearance: "computed",
      worker_pipeline: "grounded",
      loop_guidance: "grounded",
      design_notes: "grounded",     // edge control_flow_note + component pattern
      what_you_need: "computed",    // derived from component permission scopes
      suggested_next_actions: "advisory",
      clarifying_questions: "advisory", // MAR-225: bounded constraint questions
      next_steps: "advisory",
    },
    grounding_note:
      "OrchestrateMCP makes no LLM calls. Every field above is computed " +
      "deterministically from component/edge/playbook/route YAML files in the registry. " +
      "The reading agent MUST NOT present its own elaborations as if they were " +
      "registry-derived — those are 🔵 suggested; registry fields are 🟢 grounded.",
  };
}

export function planWorkflow(
  input: PlanWorkflowInput,
  registry: RegistrySnapshot,
): PlanWorkflowOutput {
  // ── Step 1: one compose pass does most of the work ──
  const composed = composeRoute(input, registry);

  // ── Step 2: plan_workflow's own precision-aware playbook routing (MAR-98) ──
  const composedIds = new Set(composed.recommended_route.map((s) => s.component_id));
  const bestOverlap = findOverlappingPlaybooks(composedIds, registry.playbooks, 0.3)[0];
  // MAR-142: also require at least one strong email/calendar token in the goal
  // before accepting email_calendar_assistant as a playbook match — the precision
  // floor alone (0.72) is not sufficient when generic tokens like "read" happen
  // to score above it on a non-email goal (e.g. Stripe→Slack read-only report).
  const emailCalendarGatePassed =
    !bestOverlap ||
    bestOverlap.playbook_id !== "email_calendar_assistant" ||
    hasEmailCalendarSignal(input.goal);

  const playbookMatch =
    bestOverlap &&
    bestOverlap.overlap_fraction >= PLAYBOOK_RECALL_MIN &&
    bestOverlap.precision >= PLAYBOOK_PRECISION_MIN &&
    emailCalendarGatePassed
      ? bestOverlap
      : null;
  const planSource: PlanSource = playbookMatch ? "playbook" : "composed";

  // ── Step 3: build the route depending on plan_source ──
  let steps: RouteStep[];
  let planningOrder: string[];
  let executionOrder: string[];
  let playbook: PlanPlaybook | null = null;
  let routeComponentIds: string[];

  if (planSource === "playbook" && playbookMatch) {
    // Lead with the validated playbook's golden-path route (MAR-98).
    const pb = registry.playbooks.find((p) => p.id === playbookMatch.playbook_id);
    const route = pb
      ? registry.routes.find((r) => r.id === pb.golden_path_route_id)
      : undefined;
    const baseIds = route?.components ?? pb?.components ?? [];
    // MAR-128: append goal-matched primary-domain components the playbook omits
    // (e.g. reviewer_notification, page_monitor, crm_note_write) so leading with
    // the playbook never silently drops a capability the user explicitly asked
    // for. Glue extras (front-door, schema_validation, safety injections) are not
    // appended.
    const extraIds = primaryDomainExtras(playbookMatch.extra_components, registry)
      .filter((id) => !baseIds.includes(id));
    const ids = [...baseIds, ...extraIds];
    const components = resolveComponents(ids, registry);
    const ordered = computeExecutionOrder(components, registry.edges);

    steps = ordered.map((c, i) => toRouteStep(c, i));
    planningOrder = components.map((c) => c.id);
    executionOrder = ordered.map((c) => c.id);
    routeComponentIds = ordered.map((c) => c.id);
    playbook = pb
      ? {
          id: pb.id,
          title: pb.title,
          route_id: pb.golden_path_route_id,
          confidence: route?.confidence ?? 0,
          recall: playbookMatch.overlap_fraction,
          precision: playbookMatch.precision,
        }
      : null;
  } else {
    // Composed candidate — reuse compose output directly.
    steps = composed.recommended_route;
    planningOrder = composed.planning_order;
    executionOrder = composed.execution_order;
    routeComponentIds = composed.recommended_route.map((s) => s.component_id);
  }

  // ── Step 4: review the chosen route's component set ──
  const safety_review = reviewRoute(
    input.goal,
    routeComponentIds,
    input.risk_level,
    registry,
  );

  // ── Step 5: derived facts on the chosen route ──
  const routeComponents = resolveComponents(routeComponentIds, registry);
  const model_tier_profile = computeModelTierProfile(routeComponents);
  const credential_advisory = computeCredentialAdvisory(routeComponents);
  const untested_edges = untestedEdgesWithin(routeComponentIds, registry);
  const fanOutNote = fanOutDesignNote(routeComponentIds); // MAR-212
  const design_notes = fanOutNote
    ? [fanOutNote, ...controlFlowNotesWithin(routeComponentIds, registry)]
    : controlFlowNotesWithin(routeComponentIds, registry);
  const avoid_when_violations = detectAvoidViolations(
    new Set(routeComponentIds),
    registry.edges,
  );
  const hasGate = routeComponentIds.includes("human_approval_gate");
  const gatedWrites = routeComponentIds.filter((id) => ALWAYS_REQUIRES_GATE.has(id));

  // ── MAR-132: reconcile an explicit "unattended / no-gate" constraint ──
  // When the user opts out but an irreversible external write is present, keep
  // the gate in the route (never silently dropped) but downgrade it from a hard
  // requirement to an advisory so the output stops contradicting the prompt.
  let enforced_approval_gates: string[];
  let approval_gate_advisory: ApprovalGateAdvisory | null = null;

  if (hasGate && gatedWrites.length > 0 && hasUnattendedWaiver(input.goal)) {
    enforced_approval_gates = [];
    approval_gate_advisory = {
      gate: "human_approval_gate",
      write_components: gatedWrites,
      reason:
        `You asked for an unattended / no-gate flow, but this route performs an ` +
        `irreversible external write (${gatedWrites.join(", ")}). \`human_approval_gate\` ` +
        `is kept as a STRONG RECOMMENDATION, not an enforced requirement — remove it ` +
        `deliberately only if you accept unattended external writes with no human review.`,
    };
  } else {
    enforced_approval_gates = hasGate
      ? ["human_approval_gate"]
      : composed.required_approval_gates;
  }

  // ── MAR-142: warn when a playbook route contains writes the goal explicitly forbade ──
  // The composed path has MAR-132's advisory; the playbook path serves a fixed
  // route structure and cannot adapt its write steps to a read-only constraint.
  // Surface a warning instead of silently contradicting the goal's constraint.
  if (planSource === "playbook" && hasWriteConstraint(input.goal)) {
    const writeComponents = routeComponentIds.filter((id) => ALWAYS_REQUIRES_GATE.has(id));
    if (writeComponents.length > 0) {
      safety_review.warnings.push(
        `Read-only / no-write constraint in goal conflicts with write step(s) in this ` +
        `playbook route (${writeComponents.join(", ")}). Consider switching to a composed ` +
        `candidate or removing the write components manually.`,
      );
    }
  }

  // ── route_status consistent with plan_workflow's OWN plan_source (MAR-133) ──
  // composeRoute sets route_status="validated" only via its internal
  // playbook-first flag (recall ≥ 0.80 / precision ≥ 0.50). plan_workflow applies
  // a STRICTER gate (recall ≥ 0.60 / precision ≥ 0.72 + email/calendar signal),
  // so passing compose's status through verbatim produced `route_status:
  // "validated"` alongside `plan_source: "composed"` / `playbook: null` — a
  // self-contradicting, trust-overclaiming output (Dogfood Round 3 G4). Derive
  // the status from the route plan_workflow actually returns: a validated playbook
  // golden-path → "validated"; a composed candidate can never be "validated".
  const hasCriticalAvoid = avoid_when_violations.some((v) => v.severity === "critical");
  const route_status: string = hasCriticalAvoid
    ? "blocked_candidate"
    : planSource === "playbook"
    ? "validated"
    : composed.route_status === "validated"
    ? "candidate"
    : composed.route_status;

  // ── MAR-166: advisory build pipeline (planner → coder → reviewer → tester) ──
  // Same deterministic build team for every plan; the registry supplies the
  // workers and their handoff contracts.
  const worker_pipeline = composeWorkerPipeline(registry.workers ?? []);

  // ── MAR-167: bounded-loop contract when the route is loop-shaped ──
  const loop_guidance = buildLoopGuidance(routeComponentIds, registry);

  // ── MAR-168: earned-by-evidence autonomy clearance (every plan) ──
  const automation_clearance = computeAutomationClearance(
    routeComponentIds,
    registry,
    untested_edges,
  );

  // ── MAR-208: what you'll need + target-aware next actions ──
  const what_you_need = buildWhatYouNeed(routeComponentIds, registry);
  const suggested_next_actions = buildSuggestedNextActions(
    planSource,
    playbook,
    input.build_target,
    what_you_need,
  );

  // ── MAR-225: bounded clarifying questions for missing architecture constraints ──
  const clarifying_questions = buildClarifyingQuestions(input.goal, routeComponentIds);

  // ── Step 6: fused markdown ──
  // MAR-101: every depth leads with the same scannable status front-matter so
  // route_status / safety / blocking / approval / untested-edge count are
  // unmissable regardless of how much detail follows.
  // MAR-224: layered depth. guided/brief = Layer-1 concise decision UI (default);
  // standard = step list + safety, no technical block; technical/deep = full plan.
  const outputDepth = input.output_depth ?? "brief";
  const statusHeader = buildStatusHeader(
    route_status,
    safety_review,
    untested_edges,
    enforced_approval_gates,
    approval_gate_advisory,
    automation_clearance,
  );
  let body: string;
  if (outputDepth === "guided" || outputDepth === "brief" || outputDepth === "standard") {
    body = buildGuidedPlanMarkdown(
      input.goal,
      planSource,
      steps,
      playbook,
      safety_review,
      enforced_approval_gates,
      approval_gate_advisory,
      automation_clearance,
      what_you_need,
      suggested_next_actions,
      clarifying_questions,
      outputDepth === "standard", // fullSteps: standard is the superset layer
    );
  } else {
    body = buildPlanMarkdown(
      input.goal,
      planSource,
      steps,
      playbook,
      safety_review,
      model_tier_profile,
      credential_advisory,
      untested_edges,
      approval_gate_advisory,
      worker_pipeline,
      loop_guidance,
      automation_clearance,
      design_notes,
      what_you_need,
      suggested_next_actions,
      clarifying_questions,
    );
  }
  const summary_markdown = `${statusHeader}\n\n${body}`;

  return {
    plan_source: planSource,
    goal: input.goal,
    summary_markdown,
    recommended_route: steps,
    planning_order: planningOrder,
    execution_order: executionOrder,
    model_tier_profile,
    playbook,
    route_status,
    route_score: composed.route_score,
    confidence_label: composed.confidence_label,
    stack: composed.recommended_stack,
    safety_review,
    credential_advisory,
    untested_edges,
    avoid_when_violations,
    enforced_approval_gates,
    approval_gate_advisory,
    evals_to_add: composed.evals_to_add,
    design_notes,
    what_you_need,
    suggested_next_actions,
    clarifying_questions,
    worker_pipeline,
    loop_guidance,
    automation_clearance,
    next_steps:
      planSource === "playbook"
        ? [
            `get_playbook({ id: "${playbook?.id ?? ""}" })`,
            `get_route({ id: "${playbook?.route_id ?? ""}", include_component_details: true })`,
            "get_graph_component",
          ]
        : ["list_known_routes", "compose_workflow_route", "get_graph_component"],
    provenance: buildProvenance(planSource),
  };
}

// ─────────────────────────── goal guard (MAR-162) ───────────────────────────

/**
 * Deterministic goal-guard (MAR-162). ChatGPT — especially in plain chat —
 * fabricates a "goal" from the server preamble / its own system instructions and
 * calls plan_workflow before the user has stated a real workflow. Planning that
 * produces confident garbage and breaks the honest-planner promise. This guard is
 * the tool-side backstop to MAR-147's instruction-side elicitation.
 *
 * It is HIGH-PRECISION on purpose: a false positive (blocking a real goal) is
 * worse than a false negative, so it only fires on UNMISTAKABLE non-goals —
 * echoed instruction/preamble text, tool names, or content-free "plan a workflow"
 * asks. Anything that reads like a real plain-English workflow passes through.
 * No LLM; pure string checks.
 */

/**
 * Phrases that appear in the server instructions / a model's own meta-narration
 * but NEVER in a real user workflow goal. If the goal contains one, it is almost
 * certainly echoed preamble, not a thing to build.
 */
const PREAMBLE_MARKERS = [
  // product / tool identity
  "orchestratemcp",
  "orchestratekit",
  "workflow-design advisor",
  "plan_workflow",
  "compose_workflow",
  "list_known_routes",
  "explain_component",
  // instruction-text fragments (from SERVER_INSTRUCTIONS / MAR-147)
  "gather the user's constraints",
  "before you plan",
  "before the first",
  "ask the user",
  "ask for the goal",
  "read-only vs",
  "attended vs",
  "outbound sends",
  "plain english goal",
  "plain-english goal",
  // model self-narration / persona echoes
  "you are an ai",
  "you are a workflow",
  "as an ai assistant",
  "i am an ai",
  "language model",
  "help the user",
  "assist the user",
];

/**
 * Whole-goal patterns for a content-free "just plan something" ask — a planning
 * verb on a generic noun with nothing actually described. Anchored (`^…$`) so a
 * real goal that merely STARTS this way ("build an agent that reads emails…")
 * is never caught.
 */
const TRIVIAL_GOAL_PATTERNS: RegExp[] = [
  /^(please\s+)?(can you\s+|could you\s+)?(help me\s+)?(to\s+)?(plan|design|build|create|make|set\s?up|architect)\s+(me\s+)?(a|an|my|the|some)?\s*(?:(?:workflow|agent|automation|pipeline|process|orchestration|flow)\s*)+(for me|for us|for my team|for my business|for my company|please|now|today|asap|thanks|thank you)?\.?$/,
  /^(what can you do|what do you do|how does this work|what is this|help|hi|hii|hello|hey|test|testing)\.?!?$/,
  /^(i\s+(need|want)|i'?d\s+like)\s+(a|an|some)?\s*(workflow|agent|automation|help|plan)\.?$/,
];

export type GoalAssessment = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether `goal` is a real workflow goal or echoed preamble / a content-
 * free ask. Exported for unit testing (golden good vs bad cases).
 */
export function assessGoalInput(goal: string): GoalAssessment {
  const g = goal.trim().toLowerCase();

  for (const marker of PREAMBLE_MARKERS) {
    if (g.includes(marker)) {
      return { ok: false, reason: `looks like instructions/preamble (matched "${marker}")` };
    }
  }

  for (const re of TRIVIAL_GOAL_PATTERNS) {
    if (re.test(g)) {
      return { ok: false, reason: "no workflow is described — just a generic 'plan something' ask" };
    }
  }

  // A single token (after the schema's 5-char floor) cannot describe a workflow.
  if (g.split(/\s+/).filter(Boolean).length < 2) {
    return { ok: false, reason: "too short to describe a workflow" };
  }

  return { ok: true };
}

/** The example goal shown to a client that tripped the guard. */
const NEEDS_GOAL_EXAMPLE =
  "read emails, detect sales leads, research the company, and draft a reply for my approval";

export type NeedsGoalResult = {
  status: "needs_goal";
  reason: string;
  example: string;
  summary_markdown: string;
};

/**
 * Build the `needs_goal` payload returned instead of a fabricated plan (MAR-162).
 * `diagnosis` is the one-line reason shown to the user; it defaults to the
 * echoed-preamble case and is overridden for the too-vague / empty-route case
 * (MAR-145 ChatGPT-dogfood finding) — both render the same headline + nudge.
 */
export function buildNeedsGoalResult(
  reason: string,
  diagnosis = "That input reads like setup/instructions text, not a workflow to plan",
): NeedsGoalResult {
  return {
    status: "needs_goal",
    reason,
    example: NEEDS_GOAL_EXAMPLE,
    summary_markdown:
      `## ⚠️ I need the actual workflow goal first\n\n` +
      `${diagnosis}, so I haven't planned anything ` +
      `(planning a guessed goal would produce confident-but-wrong output).\n\n` +
      `**Tell me, in one plain-English sentence, what you want the agent to DO** — the steps, the data, and the tools.\n\n` +
      `**Example:** _"${NEEDS_GOAL_EXAMPLE}."_\n\n` +
      `Then call \`plan_workflow\` again with that as the \`goal\`.`,
  };
}

// ─────────────────────────── registration ───────────────────────────

const InputShape = {
  goal: z.string().min(5).describe(
    "Describe the workflow you want to build in plain language. " +
    "Example: 'read emails, detect leads, research the company and draft a reply.'",
  ),
  must_have_capabilities: z.array(z.string()).default([]).describe(
    "Capabilities the plan must include. Missing capabilities are flagged.",
  ),
  must_avoid: z.array(z.string()).default([]).describe(
    "Component IDs to exclude from the plan.",
  ),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional().describe(
    "Maximum acceptable risk level for components.",
  ),
  local_or_hosted: z.enum(["local", "hosted", "either"]).default("either").describe(
    "Local tool vs hosted product — affects the stack recommendation.",
  ),
  output_depth: z.enum(["guided", "brief", "standard", "technical", "deep"]).default("brief").describe(
    "Layered output (MAR-224). guided/brief = concise Layer-1 decision UI: the goal, the " +
    "recommended route as one line, integrations to connect (names only), the key safeguard, " +
    "and a next-action menu. standard = adds the full step list + safety detail. " +
    "technical/deep = the full plan — model tiers, credentials & gotchas, worker pipeline, " +
    "untested edges, evals and the provenance block. Default brief.",
  ),
  build_target: z.enum(["cowork", "cursor", "chatgpt_gpt", "code"]).optional().describe(
    "Who will BUILD from this plan? " +
    "cowork = Claude Project / CoWork (configure an assistant, no code); " +
    "cursor = Cursor / Claude Code / VS Code (write implementation code); " +
    "chatgpt_gpt = ChatGPT Custom GPT (system prompt + Actions); " +
    "code = raw code (Codex or similar). " +
    "Drives suggested_next_actions and what_you_need. Omit to get all options.",
  ),
};

export function registerPlanWorkflow(server: McpServer): void {
  server.registerTool(
    "plan_workflow",
    {
      title: "Plan Workflow",
      description:
        "One-call workflow planner. Give it a goal and it returns a complete plan: " +
        "the recommended route (validated playbook when one strongly matches the goal, " +
        "otherwise a composed candidate), per-step model-tier guidance, an inlined safety review, " +
        "the recommended stack, and untested-edge warnings. " +
        "Replaces the manual sequence of list_known_routes → get_route → compose_workflow_route → " +
        "get_stack_recommendation → review_workflow_design. " +
        "Prefer this as the entry point for designing a new AI workflow.",
      inputSchema: InputShape,
      outputSchema: PlanWorkflowOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        // MAR-162: refuse to plan echoed preamble / a content-free ask. Returns
        // a needs_goal nudge instead of a confident plan for a fabricated goal.
        const assessment = assessGoalInput(input.goal);
        if (!assessment.ok) {
          logger.debug(`plan_workflow → needs_goal (${assessment.reason})`);
          const needsGoal = buildNeedsGoalResult(assessment.reason);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(needsGoal) }],
            structuredContent: needsGoal,
          };
        }

        const registry = loadRegistry({ includeBeta: false });
        const result = planWorkflow(
          {
            goal: input.goal,
            must_have_capabilities: input.must_have_capabilities,
            must_avoid: input.must_avoid,
            risk_level: input.risk_level,
            local_or_hosted: input.local_or_hosted,
            output_depth: input.output_depth,
          },
          registry,
        );

        // MAR-145 (ChatGPT dogfood): a goal vague enough to match no components
        // yields an empty route — a useless plan. Backstop the assessGoalInput
        // guard by returning needs_goal instead of an empty plan ("set up an
        // agent workflow for me" and similar slip past the phrase guard).
        if (result.recommended_route.length === 0) {
          logger.debug("plan_workflow → needs_goal (empty route — goal too vague)");
          const needsGoal = buildNeedsGoalResult(
            "no workflow steps matched the goal — it is too vague",
            "I couldn't identify any workflow steps from that goal — it is too vague",
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(needsGoal) }],
            structuredContent: needsGoal,
          };
        }

        logger.debug(
          `plan_workflow → source=${result.plan_source} steps=${result.recommended_route.length} ` +
          `safety=${result.safety_review.status}`,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        logger.error("plan_workflow failed", err);
        return toErrorResult(err);
      }
    },
  );
}
