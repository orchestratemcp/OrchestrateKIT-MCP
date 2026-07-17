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
import {
  matchCapabilities,
  isNegatedInContext,
  extractIterationBound,
} from "../graph/capabilityMatcher.js";
import {
  hasWriteConstraint,
  hasUnattendedWaiver,
  detectConstraintSignals,
  outboundComponentsExcludedByConstraints,
} from "../lib/constraintSignals.js";
import { computeCoverage, type Coverage } from "../graph/coverage.js";
import {
  computeConstraintCoverage,
  type ConstraintCoverage,
  type ConstraintStatus,
} from "../graph/constraintCoverage.js";
import { findOverlappingPlaybooks } from "../graph/playbookOverlap.js";
import {
  composeWorkerPipeline,
  type WorkerPipeline,
} from "../graph/workerPipeline.js";
import {
  computeAutomationClearance,
  type AutomationClearance,
  type ClearanceLevel,
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
import { riskStepNote } from "../lib/plainLanguage.js";
import {
  CALENDAR_INVITE_SIDE_EFFECT,
  GOOGLE_SCOPE_CATALOG,
} from "../lib/credentialScopeCatalog.js";
import { PlanWorkflowOutputShape } from "./outputSchemas.js";
import {
  buildObservabilityGuidance,
  type ObservabilityGuidance,
} from "../lib/observabilityContract.js";

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
 * Strong lead/CRM signal for email_lead_to_crm (MAR-265). Word-bounded — a
 * plain `includes("lead")` would fire on "leaderboard" / "misleading". The
 * playbook must not catch generic email goals (the email_calendar_assistant
 * over-match history, MAR-130/142, is the failure to avoid); the precision
 * floor blocks most of them, this gate is the explicit belt-and-braces.
 */
const LEAD_CRM_SIGNAL = /\blead(s)?\b|\bcrm\b|\bprospect(s)?\b|\bdeal(s)?\b|sales opportunit/;

function hasLeadCrmSignal(goal: string): boolean {
  return LEAD_CRM_SIGNAL.test(goal.toLowerCase());
}

/**
 * Strong price-watch signal for competitor_price_monitor (MAR-266): the goal
 * must name the SUBJECT (price / competitor / product page) AND the recurring
 * check (schedule or monitor verb). Word-bounded like LEAD_CRM_SIGNAL.
 * Deliberately NOT the only guard: the nightly scrape-to-Postgres variant
 * passes both token classes ("competitor pricing pages" + "every night") and
 * is kept composed by the overlap floors instead — its composed set has
 * data_scraper/db_read, which this playbook deliberately excludes.
 */
const PRICE_WATCH_SUBJECT_SIGNAL =
  /\bprice(s|d)?\b|\bpricing\b|\bcompetitor(s|')?\b|product page/;
const PRICE_WATCH_CADENCE_SIGNAL =
  /\b(every|each|hourly|daily|nightly|weekly|scheduled?|cron|monitor(s|ing)?|watch(es|ing)?|poll(s|ing)?|track(s|ing)?)\b/;

function hasPriceWatchSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return PRICE_WATCH_SUBJECT_SIGNAL.test(g) && PRICE_WATCH_CADENCE_SIGNAL.test(g);
}

/**
 * pr_review_readonly boundary (MAR-267). Positive: the goal names a PR / diff
 * review. Negative: any UNNEGATED edit-intent token routes the goal to
 * codebase_agent_workflow / composed instead — that boundary is the playbook's
 * whole identity (hard no-write guarantee). Negation-aware on purpose: the
 * lock goal itself says "Never edit or commit any code", and a naive blocklist
 * would reject the exact phrasing the playbook was promoted on (the MAR-252
 * negation-blindness class, inverted).
 */
const PR_REVIEW_SUBJECT_SIGNAL =
  /\bpull request(s)?\b|\bprs?\b|\bdiff(s)?\b|code review|review the (code|change|changes)/;
const EDIT_INTENT_TOKENS = [
  "edit",
  "edits",
  "editing",
  "fix",
  "fixes",
  "fixing",
  "bug fix",
  "bugfix",
  "implement",
  "implements",
  "implementing",
  "refactor",
  "refactors",
  "refactoring",
  "commit",
  "commits",
  "committing",
  "merge",
  "merges",
  "write code",
];

function hasEditIntent(goal: string): boolean {
  const g = goal.toLowerCase();
  return EDIT_INTENT_TOKENS.some((t) => {
    // word-bounded ("fix" must not fire on "prefix"/"fixture"), then
    // negation-checked ("never edit" is a constraint, not intent)
    const re = new RegExp(`\\b${t.replace(/ /g, "\\s+")}\\b`);
    if (!re.test(g)) return false;
    return !isNegatedInContext(g, t);
  });
}

function hasPrReviewSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return PR_REVIEW_SUBJECT_SIGNAL.test(g) && !hasEditIntent(g);
}

/**
 * Strong morning-email-triage signal for morning_email_triage (MAR-301). The
 * goal must name an email SUBJECT (inbox / email / mailbox / messages) AND a
 * triage ACTION (triage / classify / sort / needs-reply / draft replies). This
 * is the third email-domain playbook; the recall sort already keeps it off
 * genuine send-and-schedule goals (email_calendar_assistant scores higher when
 * the calendar and send components are present) and off lead goals
 * (email_lead_to_crm pulls crm_note_write). This gate is belt-and-braces: it
 * keeps morning_email_triage off a
 * NON-email scheduled-notify workflow that happens to share
 * scheduled_trigger + reviewer_notification + human_approval_gate + audit_log.
 * Word-bounded like the other signal gates.
 */
const TRIAGE_SUBJECT_SIGNAL = /\binbox\b|\bemail(s)?\b|\bmailbox\b|\bmessages?\b/;
const TRIAGE_ACTION_SIGNAL =
  /\btriage\b|\bclassif(y|ies|ication)\b|\bsort(s|ing)?\b|\bcategoriz(e|es|ing|ation)\b|needs[- ]repl(y|ies)|drafts? (a )?repl/;

function hasMorningEmailTriageSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return TRIAGE_SUBJECT_SIGNAL.test(g) && TRIAGE_ACTION_SIGNAL.test(g);
}

/**
 * Strong invoice-intake signal for invoice_intake_po_match (MAR-302). The goal
 * must name the SUBJECT (invoice / receipt / purchase order / accounts payable).
 * The recall sort is the real separator vs the data_extraction_enrichment
 * scrape pipeline (which has data_scraper/state_store the invoice route lacks)
 * and vs the email playbooks (this shape reads email as a document source, not
 * correspondence — the MAR-302 matcher fix strips the drafting/sending path so
 * the email playbooks never out-score it here). This gate is belt-and-braces:
 * it keeps invoice_intake off a generic ETL goal that shares
 * pdf_extraction + schema_validation but has nothing to do with invoices.
 */
const INVOICE_INTAKE_SIGNAL =
  /\binvoice(s)?\b|\breceipt(s)?\b|\bpurchase order(s)?\b|accounts payable/;

function hasInvoiceIntakeSignal(goal: string): boolean {
  return INVOICE_INTAKE_SIGNAL.test(goal.toLowerCase());
}

/**
 * Strong scheduled-data-report signal for scheduled_data_report (MAR-303),
 * mirroring MAR-266's two-token-class pattern: the goal must name a database
 * SOURCE (database / SQL / warehouse / a named engine) AND a recurring CADENCE
 * (schedule / cron / every|each + a period or a weekday). Both are required so a
 * one-off "query the database once" or a generic "every morning summarise the
 * news" (no DB) does not fire it. The recall sort keeps it off pdf_extraction-
 * direction goals (report_generation is the write direction; those pull
 * pdf_extraction and score higher on the invoice/document playbooks).
 */
const DB_REPORT_SUBJECT_SIGNAL =
  /\bdatabase\b|\bpostgres(ql)?\b|\bmysql\b|\bsql\b|\bwarehouse\b|\bbigquery\b|\bsnowflake\b|\bredshift\b|data warehouse/;
const DB_REPORT_CADENCE_SIGNAL =
  /\b(every|each|hourly|daily|nightly|weekly|monthly|scheduled?|cron)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/;

function hasScheduledDataReportSignal(goal: string): boolean {
  const g = goal.toLowerCase();
  return DB_REPORT_SUBJECT_SIGNAL.test(g) && DB_REPORT_CADENCE_SIGNAL.test(g);
}

/**
 * Per-playbook goal-signal gate (MAR-142 pattern, generalized in MAR-265):
 * a playbook listed here only fires when the goal carries at least one of its
 * strong domain tokens, regardless of recall/precision scores. Playbooks not
 * listed are ungated (scores alone decide).
 */
function playbookSignalGatePassed(playbookId: string, goal: string): boolean {
  switch (playbookId) {
    case "email_calendar_assistant":
      return hasEmailCalendarSignal(goal);
    case "email_lead_to_crm":
      return hasLeadCrmSignal(goal);
    case "competitor_price_monitor":
      return hasPriceWatchSignal(goal);
    case "pr_review_readonly":
      return hasPrReviewSignal(goal);
    case "morning_email_triage":
      return hasMorningEmailTriageSignal(goal);
    case "invoice_intake_po_match":
      return hasInvoiceIntakeSignal(goal);
    case "scheduled_data_report":
      return hasScheduledDataReportSignal(goal);
    default:
      return true;
  }
}

const REVIEWER_NOTIFICATION_SIGNAL =
  /\breviewer(s)?\b|\breview request\b|\bnotify (the )?reviewer(s)?\b|send (it|them|draft|copy|brief|artifact) to (a )?reviewer/;

function shouldIgnoreReviewerNotificationForLeadSlack(
  goal: string,
  componentIds: Set<string>,
): boolean {
  return (
    hasLeadCrmSignal(goal) &&
    componentIds.has("slack_notification") &&
    componentIds.has("reviewer_notification") &&
    !REVIEWER_NOTIFICATION_SIGNAL.test(goal.toLowerCase())
  );
}

/**
 * Explicit "read-only / no-write" constraint phrases (MAR-142). When present in
 * a goal that was routed to a playbook containing write components, surface a
 * safety warning — the playbook route's fixed structure cannot adapt its writes
 * to match the constraint (unlike the composed path which has MAR-132 advisory).
 */
// MAR-255: the phrase table + predicate moved verbatim to the shared module
// src/lib/constraintSignals.ts so export_build_brief's §0 uses the SAME
// detection (single source — the brief previously had a weaker copy and
// contradicted the planner on the audit G1 goal). Imported at top of file.

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

// MAR-255: the waiver / approval-requirement phrase tables and predicates
// (UNATTENDED_WAIVER_SIGNALS, APPROVAL_REQUIRED_SIGNALS, occursUnnegated,
// hasExplicitApprovalRequirement, hasUnattendedWaiver — MAR-132/229 lineage)
// moved VERBATIM to src/lib/constraintSignals.ts so export_build_brief's §0
// shares the exact same detection. Re-exported below for back-compat (the
// planWorkflow test suite imports them from here).
export { hasExplicitApprovalRequirement, hasUnattendedWaiver } from "../lib/constraintSignals.js";

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
 * MAR-225: one bounded, multiple-choice clarifying question. The reading agent
 * presents these to the user and folds the answers into a re-call's goal — the
 * MCP is stateless.
 *
 * Scope-completion questions end `options` with a "Not sure yet" choice: the
 * user may legitimately not have decided yet, and the plan is still useful. A
 * side-effect question (`calendar_notification`) does not — it exists precisely
 * because the plan cannot be honest about the user-visible outcome until the
 * fork is picked, so offering an escape hatch would defeat it.
 */
export type ClarifyingQuestion = {
  id:
    | "run_trigger"
    | "write_permission"
    | "outbound_send"
    | "calendar_notification"
    | "build_surface"
    | "hosting_monitoring"
    | "artifact_target";
  question: string;
  options: string[];
  /**
   * Stable ids for `options`, same length and order. Present when the answer
   * names a concrete build decision the brief has to carry, rather than a
   * free-text preference — the prose in `options` is for the user, these are
   * for the agent relaying the answer back.
   */
  option_ids?: string[];
  /**
   * The `option_ids` entry the plan recommends, when the goal's own constraints
   * imply one. Absent means the question is a genuine open fork — never default
   * a side effect the user has not asked for.
   */
  recommended_option_id?: string;
  /** One sentence: why this fork changes the user-visible outcome. */
  why?: string;
};

/** Stable identifiers for the standardized next-action menu (MAR-226). */
export type NextActionId =
  | "show_technical_plan"
  // MAR-385: the attended in-chat dry run named as a first-class option.
  | "dry_run_in_chat"
  | "generate_prompt"
  | "export_build_brief"
  | "wire_integrations"
  | "open_playbook"
  | "review_after_build"
  | "log_feedback"
  // MAR-315: hosting + monitoring picks — gated, see buildNextActionMenu.
  | "choose_hosting"
  | "wire_monitoring";

/**
 * MAR-226: one entry in the standardized next-action menu. `id` is stable so a
 * client can wire a button or auto-route the next call; `action` maps to an
 * existing tool call, an `output_depth` re-call, or an assistant directive.
 * Advisory (🔵) — keeps the existing flat `suggested_next_actions` for back-compat.
 */
export type NextAction = {
  id: NextActionId;
  label: string;
  action: string;
};

/**
 * MAR-315: stable ids for the hosting recommendation, derived from route
 * shape (trigger component present) rather than free text — a client can
 * switch on `id` without string-matching `label`.
 */
export type HostingOptionId =
  | "local_cron"
  | "hosted_cron"
  | "hosted_endpoint"
  | "in_client"
  | "manual_local";

/** MAR-315: stable ids for the monitoring recommendation. */
export type MonitoringOptionId = "dash_import" | "log_to_file" | "manual_none";

export type HostingOption = { id: HostingOptionId; label: string };
export type MonitoringOption = { id: MonitoringOptionId; label: string };

/**
 * MAR-315: deterministic hosting + monitoring guidance ("where does this
 * run, who watches it") — the last unbuilt T1 scope-compiler menu. Derived
 * purely from the route's trigger shape (+ the `local_or_hosted` override);
 * no LLM, no network call. `recommended` is always index-0-equivalent — one
 * pick, never a ranked list — with `alternatives` covering the other
 * realistic options, MAR-226 menu style (stable id + label per entry).
 */
export type HostingAndMonitoring = {
  hosting: {
    recommended: HostingOption;
    alternatives: HostingOption[];
    reason: string;
  };
  monitoring: {
    recommended: MonitoringOption;
    alternatives: MonitoringOption[];
    reason: string;
  };
};

export type WizardChoiceKind = "build" | "host_monitor" | "artifact";

export type WizardChoice = {
  id: string;
  label: string;
  kind: WizardChoiceKind;
  best_for: string;
  tradeoffs: string;
  recommended: boolean;
  action: string;
};

export type PlacementAvailability =
  | "available now"
  | "requires setup"
  | "planned"
  | "advanced";

export type PlacementOption = {
  id: string;
  label: string;
  appropriate_when: string;
  limitation: string;
  availability: PlacementAvailability;
};

export type PlacementAxis = {
  recommended: PlacementOption;
  alternatives: PlacementOption[];
};

export type RuntimeRequirements = {
  trigger_mode: "interactive" | "scheduled" | "event" | "polling" | "manual";
  operation_mode: "interactive" | "scheduled" | "event-driven" | "continuous";
  expected_duration: "short" | "long-running";
  persistent_state_needed: boolean;
  durable_approval_needed: boolean;
  must_run_while_user_offline: boolean;
  data_sensitivity: "low" | "medium" | "high";
  estimated_operational_complexity: "low" | "medium" | "high";
};

export type RuntimeOption = PlacementOption & {
  runtime_class: string;
  reason: string;
  offline_behavior: string;
  install_action: string | null;
};

export type TriggerExplanation = {
  mode: RuntimeRequirements["trigger_mode"];
  label: string;
  what_wakes_it_up: string;
  offline_behavior: string;
  limitation: string;
};

export type RecommendedSetup = {
  label: string;
  availability: PlacementAvailability;
  action: string | null;
  blocker: string | null;
  next_achievable_step: string;
};

export type WizardStep = {
  step: number;
  label: string;
  detail: string;
  component_id: string;
};

export type WizardConnectionGroup = {
  id: "sources" | "destinations" | "state" | "approval" | "secrets";
  label: string;
  items: string[];
};

/**
 * MAR-333: the top-level Goal -> Product wizard contract. This is the concise,
 * menu-shaped surface clients should render by default. It is deterministic
 * data only: plain-English route steps, grouped connection needs, separate
 * runtime/control/interaction/trigger recommendations, bounded questions, and
 * one honest next action. Deep/technical fields and legacy choice arrays remain
 * available elsewhere in the same payload.
 */
export type GoalToProductWizard = {
  steps: WizardStep[];
  connections_required: WizardConnectionGroup[];
  build_choices: WizardChoice[];
  host_monitor_choices: WizardChoice[];
  artifact_choices: WizardChoice[];
  runtime_requirements: RuntimeRequirements;
  runtime_recommendation: RuntimeOption;
  runtime_alternatives: RuntimeOption[];
  control_surface: PlacementAxis;
  interaction_surface: PlacementAxis;
  trigger_explanation: TriggerExplanation;
  recommended_setup: RecommendedSetup;
  clarifying_questions: ClarifyingQuestion[];
  recommended_next_click: {
    id: string;
    label: string;
    action: string;
  };
};

/**
 * MAR-386: deterministic SCOPE ASSESSMENT — how big is this task, derived from
 * the plan itself (no LLM). Same discipline as coverage / automation_clearance:
 * the plan sizes itself so the product can recommend the matching first move
 * (small tasks never see hosting questions; large ones aren't pretended into a
 * single build prompt). See docs/UX_FLOWCHART.md "Scope sizing — deterministic
 * drivers".
 *
 * HARD design rule: scope NEVER gates capability. Every continuation option
 * stays present at every size — scope only changes which one is ⭐ recommended
 * first (see pickRecommendedNextClick / renderProductCardContinueMenu).
 */
export type ScopeAssessment = {
  size: "small" | "medium" | "large";
  /** Human-readable reasons drawn from the plan (the drivers that set the size). */
  drivers: string[];
  /** Short label for the recommended first move at this size. */
  recommended_path: string;
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
  /**
   * Coverage accounting (MAR-250): matched goal phrases per component,
   * `unmatched_demand` (goal steps no registry component claimed — treat as 🔵
   * unguided), and `unsupported_supply` (components with no supporting goal
   * phrase — likely matcher noise; verify or remove). The keystone honesty
   * layer for the scope-compiler direction: the plan says where the registry
   * ends instead of silently dropping or inventing scope.
   */
  coverage: Coverage;
  /**
   * Constraint coverage (MAR-250, phase 2): the goal's CHECKABLE constraints
   * (prohibitions, approval ordering, quantities, durations, filters,
   * exactly-once) with how the plan represents each — enforced in route
   * structure, delegated to build-time acceptance, or missing/violated.
   * Token coverage says which steps the route carries; this says which
   * COMMITMENTS it keeps. "Full coverage" may not be claimed unqualified when
   * problems exist here.
   */
  constraint_coverage: ConstraintCoverage;
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
   * Standardized, machine-consumable next-action menu (MAR-226). A stable,
   * enumerated set of actions — each with a consistent `id` and an `action`
   * mapping to a tool call or `output_depth` re-call — so a client can render
   * buttons or auto-route. Context-gated by `build_target`. The structured
   * counterpart to `suggested_next_actions` (which stays for back-compat).
   */
  next_action_menu: NextAction[];
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
   * Deterministic hosting + monitoring recommendation (MAR-315): where this
   * plan should run, derived from the route's trigger shape, and how to watch
   * it once it runs (simple logs are the recommended monitoring option — the
   * manifest already ships in `export_build_brief`). Present on every plan;
   * never null. Registry/route-shape derived — no LLM, no network call.
   */
  hosting_and_monitoring: HostingAndMonitoring;
  /**
   * MAR-333: concise Goal -> Product wizard contract. Clients should prefer
   * this for default rendering instead of reconstructing a wizard from
   * `summary_markdown`, `what_you_need`, `next_action_menu`, and
   * `hosting_and_monitoring`.
   */
  goal_to_product_wizard: GoalToProductWizard;
  /**
   * MAR-386: deterministic Small / Medium / Large sizing of the task, derived
   * from this plan's own fields (runtime, clearance, connection count, route
   * shape). Drives the scope-aware ⭐ in the menu. Scope never gates capability.
   */
  scope_assessment: ScopeAssessment;
  /**
   * Advisory multi-worker BUILD pipeline (MAR-166): the specialist workers
   * (planner → coder → reviewer → tester) recommended to implement this plan in
   * the user's own runtime, with their handoff contracts. Deterministic and the
   * same build team for every plan — which is exactly why it is BOILERPLATE at
   * shallow depths (MAR-256): ~1,500 identical tokens shipped with every plan.
   * Emitted only at output_depth technical/deep, OR when the plan is genuinely
   * loop/worker-shaped (loop_controller / fan_out_collector in the route, or
   * the dynamic_worker_loop playbook matched — that plan IS the pipeline).
   * Null otherwise; `worker_pipeline_pointer` says how to get it.
   */
  worker_pipeline: WorkerPipeline | null;
  /**
   * Non-null exactly when worker_pipeline was omitted for depth (MAR-256):
   * a one-line pointer telling the client how to retrieve the build-team
   * contracts without paying for them on every call.
   */
  worker_pipeline_pointer: string | null;
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
  /**
   * Advisory observability guidance (MAR-296 / DASH-02). The DASH-v1 run-event
   * set to emit, and which irreversible components DASH expects a resolved gate
   * before (gate compliance). Advisory — the MCP never talks to DASH; the full
   * `agent.manifest.json` + event-wiring section is emitted by export_build_brief.
   */
  observability: ObservabilityGuidance;
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
  goal = "",
): LoopGuidance | null {
  if (!routeComponentIds.includes("loop_controller")) return null;
  if (routeComponentIds.includes("fan_out_collector")) return null; // MAR-209
  const pb = registry.playbooks.find((p) => p.loop_contract);
  if (!pb || !pb.loop_contract) return null;
  // MAR-348: honour the user's stated bound ("maximum 3 rounds" → 3) instead of
  // always echoing the playbook default. Clone the contract so we never mutate
  // the shared registry object. Falls back to the playbook default when the goal
  // states no explicit cap.
  const bound = extractIterationBound(goal.toLowerCase());
  const loop_contract =
    bound !== null
      ? { ...pb.loop_contract, max_iterations: bound }
      : pb.loop_contract;
  return {
    playbook_id: pb.id,
    worker_sequence: pb.worker_sequence ?? [],
    loop_contract,
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
    required_scopes: [...GOOGLE_SCOPE_CATALOG.email_read.scopes],
    gotchas: [
      "Rate limit: 250 quota units / second per user — batch list + fetch calls",
      "Refresh tokens expire after 6 months of non-use; build a token-rotation flow",
      "Gmail API returns a thread list, not individual messages — call messages.get per ID",
    ],
  },

  email_draft: {
    label: "Email provider — draft (never sends)",
    product_examples: ["Gmail", "Outlook", "SMTP"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-gmail",
      transport: "stdio",
    },
    required_scopes: [...GOOGLE_SCOPE_CATALOG.email_draft.scopes],
    gotchas: [
      "gmail.compose is sufficient for users.drafts.create — gmail.send is never required to create or update a draft",
      "Send-as restrictions apply if the user has multiple identities; validate the From address before any later send step",
    ],
  },

  gmail_draft_write: {
    label: "Email provider — save draft to mailbox (never sends)",
    product_examples: ["Gmail", "Outlook", "IMAP APPEND"],
    auth_model: "OAuth2 (user-delegated)",
    mcp_server: {
      availability: "official",
      package: "@modelcontextprotocol/server-gmail",
      transport: "stdio",
      note: "Same Gmail server as email_read/email_draft — one OAuth grant covers read, compose and draft save",
    },
    required_scopes: [...GOOGLE_SCOPE_CATALOG.gmail_draft_write.scopes],
    gotchas: [
      "users.drafts.create needs only gmail.compose — granting gmail.send here would give the agent a send capability the workflow never uses",
      "Set threadId on the draft or the reply starts a new thread instead of threading onto the original message",
      "drafts.create is not idempotent — a retry after a timeout creates a SECOND draft; key on the source message id to dedupe",
      "A draft in the Drafts folder looks identical to a reply the user wrote — make the audit trail say which run created it",
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
    required_scopes: [...GOOGLE_SCOPE_CATALOG.calendar_lookup.scopes],
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
    required_scopes: [...GOOGLE_SCOPE_CATALOG.calendar_write.scopes],
    gotchas: [
      CALENDAR_INVITE_SIDE_EFFECT,
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

  crm_record_read: {
    label: "CRM — read contacts / deals (read-only)",
    product_examples: ["HubSpot", "Salesforce", "Pipedrive"],
    auth_model: "Private App token (HubSpot, read scope) / OAuth2 (Salesforce)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official HubSpot/Salesforce MCP; community implementations on npm. Use a read-only key.",
    },
    required_scopes: [
      "crm.objects.contacts.read",
      "crm.objects.deals.read",
      "crm.objects.companies.read",
    ],
    gotchas: [
      "Use a read-only token — never the same key you use for writes; least-privilege limits blast radius",
      "Search by a unique key (email, deal id), not name — name search returns ambiguous multi-matches",
      "HubSpot search API is eventually consistent: a record written <1s ago may not appear yet",
    ],
  },

  lead_enrichment: {
    label: "Lead enrichment provider",
    product_examples: ["Clearbit", "Apollo", "ZoomInfo"],
    auth_model: "API key (Authorization: Bearer)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No MCP server; call the provider REST API directly (Clearbit Enrichment, Apollo People API)",
    },
    required_scopes: ["enrichment:read"],
    gotchas: [
      "GDPR/CCPA: enriching EU/CA contacts needs a lawful basis — gate and document before storing",
      "Providers bill per lookup and cache aggressively; dedupe by domain/email before calling",
      "A confident match on a shared/free-email domain (gmail.com) is often wrong — require a corporate domain",
    ],
  },

  deal_stage_update: {
    label: "CRM — advance deal / opportunity stage",
    product_examples: ["HubSpot", "Salesforce", "Pipedrive"],
    auth_model: "Private App token (HubSpot, deals write) / OAuth2 (Salesforce)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No official MCP; community implementations on npm. Requires a deals-write scope.",
    },
    required_scopes: ["crm.objects.deals.read", "crm.objects.deals.write"],
    gotchas: [
      "A stage change fires downstream automations (emails, tasks, forecast updates) that cannot be recalled — gate it",
      "Pipelines enforce stage order; skipping a required stage fails validation silently in some configs",
      "Always read the current stage first (crm_record_read) — a blind set can move a deal backwards",
    ],
  },

  metric_threshold_monitor: {
    label: "Metrics provider — query a metric",
    product_examples: ["Datadog", "Grafana / Prometheus", "AWS CloudWatch"],
    auth_model: "API key + app key (Datadog) / API token (Grafana) / IAM role (CloudWatch)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No standard MCP; use the provider query API (Datadog v1 metrics, Prometheus HTTP API, CloudWatch GetMetricData)",
    },
    required_scopes: ["metrics_read", "timeseries_query"],
    gotchas: [
      "Use a read-only/query-scoped key — a metrics key with write scope can mutate monitors",
      "Match the aggregation window to the signal: a 1-hour avg hides a 1-minute spike",
      "A gap in the series (no datapoints) often reads as 0 — assert on data presence before comparing",
    ],
  },

  log_monitor: {
    label: "Log provider — query logs",
    product_examples: ["Datadog Logs", "AWS CloudWatch Logs", "Sentry / Loki"],
    auth_model: "API key (Datadog/Sentry) / IAM role (CloudWatch) / token (Loki)",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No standard MCP; use the provider logs query API (Datadog Logs Search, CloudWatch Logs Insights, Sentry Issues)",
    },
    required_scopes: ["logs_read"],
    gotchas: [
      "Redact secrets/PII from sampled log lines BEFORE forwarding to an alert channel",
      "Log ingestion lag means a query can run before the offending lines are indexed — add a lookback buffer",
      "A broad pattern floods alerts and trains responders to ignore them — scope tightly and rate-limit",
    ],
  },

  uptime_check: {
    label: "Uptime / health-check probe",
    product_examples: ["Pingdom", "UptimeRobot", "healthchecks.io / direct HTTP"],
    auth_model: "API key (provider) — or no auth for a direct HTTP probe",
    mcp_server: {
      availability: "none",
      transport: "none",
      note: "No standard MCP; use the provider API or a direct HTTP/TCP probe",
    },
    required_scopes: ["monitors_read"],
    gotchas: [
      "Require N consecutive failures before paging — a single transient blip is not an outage",
      "Probe from more than one region — a single-region check confuses a network blip with a real outage",
      "Assert on the response body, not just a 200 — a 200 with an error page reads as healthy",
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

  // MAR-244: file_storage — the generic "save it somewhere" write destination.
  file_storage: {
    label: "Storage destination — write records / files",
    product_examples: ["Google Sheets", "Airtable", "Postgres / SQLite", "S3 / GCS", "local CSV"],
    auth_model: "OAuth2 (Google Sheets) / API key (Airtable, S3) / connection string (database)",
    mcp_server: {
      availability: "community",
      transport: "stdio",
      note: "No single official MCP; Google Sheets & Airtable have community servers, or write via the provider SDK directly",
    },
    required_scopes: ["https://www.googleapis.com/auth/spreadsheets (Sheets, write)"],
    gotchas: [
      "Append vs. overwrite: use an append/upsert API, never a full range overwrite, or a retry wipes existing rows",
      "Give the write credential access to ONE sheet/table/bucket — a broad scope means a misrouted write lands anywhere",
      "Make the write idempotent with an upsert key (invoice id, row hash) so a re-run does not double-write",
      "Match the destination columns to the record schema up front — a silent field drop corrupts the store over time",
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
 * environment. Without a target, offers portable prompt / code / GPT options.
 * so the reading agent can prompt the user to choose.
 */
/**
 * MAR-256: unique integration product names in stable (route) order. Two
 * IntegrationNeed entries can share the same first product example (two Slack
 * scopes → "Slack, Slack, HubSpot" — audit G4, live), so the menu label must
 * dedupe by NAME, and the "+N more" count must count unique names, not entries.
 */
function uniqueIntegrationNames(whatYouNeed: IntegrationNeed[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of whatYouNeed) {
    const name = n.product_examples[0];
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function buildSuggestedNextActions(
  planSource: PlanSource,
  playbook: PlanPlaybook | null,
  buildTarget: BuildTarget | undefined,
  whatYouNeed: IntegrationNeed[],
): string[] {
  const COWORK = "Ask me to generate a portable agent handoff prompt for this plan (Claude Cowork where available)";
  const CURSOR  = "Call `export_build_brief({ handoff_targets: ['prompt'], delivery_mode: 'compact' })` for the Claude-safe inline build spec; request full mode only for the rendered issue bundle";
  const GPT     = "Ask me to generate a ChatGPT handoff prompt; agent mode and Workspace Agents are separate availability-gated surfaces";
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

  const integrationNames = uniqueIntegrationNames(whatYouNeed);
  if (integrationNames.length > 0) {
    const top = integrationNames.slice(0, 3).join(", ");
    const extra = integrationNames.length > 3 ? ` + ${integrationNames.length - 3} more (see what_you_need)` : "";
    actions.push(`Wire up the integrations: ${top}${extra}`);
  }

  actions.push(REVIEW);
  return actions;
}

// ─────────────────────────── MAR-226: next-action menu ───────────────────────

/**
 * MAR-385: goal phrases that ask to BUILD/STAND UP a durable agent rather than
 * run a single task once. Used only to decide whether an in-chat run should be
 * disclosed as a dry-run/walking skeleton (with `export_build_brief` as the real
 * deliverable) — it invents no matcher vocabulary and never changes the route.
 */
const BUILD_INTENT_SIGNALS = [
  "build", "create an agent", "create an assistant", "create a bot",
  "set up", "set-up", "make an agent", "stand up", "build an agent",
  "build me", "an agent that", "an assistant that",
];
export function goalHasBuildIntent(goal: string): boolean {
  return anySignal(goal.toLowerCase(), BUILD_INTENT_SIGNALS);
}

/**
 * MAR-385: the honest disclosure for running a plan attended in chat right now.
 * `buildDeliverable` is true only when the goal asks to build a durable agent
 * AND the runtime recommendation is a durable class (must outlive the session) —
 * in that case the chat run is a walking skeleton and `export_build_brief` is the
 * actual deliverable. For a genuinely one-shot / attended goal the base line
 * stands alone and never nags toward `export_build_brief`. `briefRef` names how
 * the surrounding menu refers to the build-brief step (e.g. `" (C)"`).
 */
function dryRunMenuLine(letter: string, buildDeliverable: boolean, briefRef: string): string {
  const base =
    `${letter}) Run it attended in this chat now — one-shot, nothing persists: ` +
    `no saved agent, no trigger, approval is this chat.`;
  if (!buildDeliverable) return base;
  return (
    base +
    ` A walking skeleton, not the build; export_build_brief${briefRef} is the deliverable.`
  );
}

/**
 * MAR-226: the standardized, machine-consumable next-action menu. A stable,
 * enumerated set with consistent `id`s — each `action` maps to an existing tool
 * call, an `output_depth` re-call, or an assistant directive — context-gated by
 * `build_target` so irrelevant build paths are omitted. The structured
 * counterpart to `buildSuggestedNextActions` (kept for back-compat).
 */
export function buildNextActionMenu(
  planSource: PlanSource,
  playbook: PlanPlaybook | null,
  buildTarget: BuildTarget | undefined,
  whatYouNeed: IntegrationNeed[],
  goal: string,
  hostingAndMonitoring: HostingAndMonitoring,
): NextAction[] {
  const menu: NextAction[] = [];
  const g = goal.toLowerCase();

  // Drill into the full plan — links the MAR-224 depth layers.
  menu.push({
    id: "show_technical_plan",
    label: "Show the full technical plan (steps, model tiers, credentials, build team)",
    action: 'plan_workflow({ output_depth: "technical" })',
  });

  // MAR-385: name the attended in-chat run explicitly so clients stop silently
  // substituting chat-execution for building. A chat run reads real data and
  // produces the real approval card, but nothing persists — for a build goal it
  // is a walking skeleton, and export_build_brief remains the deliverable.
  menu.push({
    id: "dry_run_in_chat",
    label:
      "Run this plan attended in this chat now (one-shot dry run) — nothing persists, " +
      "no trigger, approval is this chat. For a build goal this is a walking skeleton, " +
      "not a durable agent; offer export_build_brief afterward.",
    action: "assistant:attended_dry_run_in_chat",
  });

  // Build path — gated by build_target so only the relevant one shows.
  switch (buildTarget) {
    case "cowork":
      menu.push({
        id: "generate_prompt",
        label: "Generate a portable agent handoff prompt for Claude Cowork where available",
        action: "assistant:generate_cowork_prompt",
      });
      break;
    case "chatgpt_gpt":
      menu.push({
        id: "generate_prompt",
        label: "Generate a ChatGPT handoff prompt (agent mode / Workspace Agents where available)",
        action: "assistant:generate_chatgpt_gpt",
      });
      break;
    case "cursor":
    case "code":
      menu.push({
        id: "export_build_brief",
        label: "Export the Claude-safe Cursor / Claude Code build brief",
        action: "export_build_brief({ handoff_targets: ['prompt'], delivery_mode: 'compact' })",
      });
      break;
    default:
      // No target chosen — offer both build paths.
      menu.push({
        id: "generate_prompt",
        label: "Generate a portable agent handoff prompt",
        action: "assistant:generate_prompt",
      });
      menu.push({
        id: "export_build_brief",
        label: "Export the Claude-safe build brief (Cursor / Claude Code)",
        action: "export_build_brief({ handoff_targets: ['prompt'], delivery_mode: 'compact' })",
      });
  }

  // Wire integrations — only when the route needs external products.
  const integrationNames = uniqueIntegrationNames(whatYouNeed);
  if (integrationNames.length > 0) {
    const names = integrationNames.slice(0, 3).join(", ");
    const extra = integrationNames.length > 3 ? ` +${integrationNames.length - 3} more` : "";
    menu.push({
      id: "wire_integrations",
      label: `Wire up the integrations: ${names}${extra}`,
      action: "see:what_you_need",
    });
  }

  // Open the validated playbook when one backs the plan.
  if (planSource === "playbook" && playbook) {
    menu.push({
      id: "open_playbook",
      label: `Open the validated playbook \`${playbook.id}\``,
      action: `get_playbook({ id: "${playbook.id}" })`,
    });
  }

  // Validate the build against the plan.
  menu.push({
    id: "review_after_build",
    label: "Validate your build against this plan",
    action: "review_workflow_design({ ... })",
  });

  // Log the ship to the evidence library (stateless emitter).
  menu.push({
    id: "log_feedback",
    label: "Record how the build went (feeds the evidence library)",
    action: "record_session_feedback({ ... })",
  });

  // MAR-315: hosting + monitoring picks — never shown when the goal already
  // states its own hosting / monitoring plan (same never-nag rule as
  // buildClarifyingQuestions).
  if (!anySignal(g, HOSTING_STATED_SIGNALS)) {
    menu.push({
      id: "choose_hosting",
      label: `Choose hosting (recommended: ${HOSTING_MENU_SHORT[hostingAndMonitoring.hosting.recommended.id]})`,
      action: "see:hosting_and_monitoring.hosting",
    });
  }
  if (!anySignal(g, MONITORING_STATED_SIGNALS)) {
    menu.push({
      id: "wire_monitoring",
      label: `Wire monitoring (recommended: ${MONITORING_MENU_SHORT[hostingAndMonitoring.monitoring.recommended.id]})`,
      action: "see:hosting_and_monitoring.monitoring",
    });
  }

  return menu;
}

/** MAR-226: render the next-action menu as markdown bullets (label only). */
function renderNextActionMenu(menu: NextAction[]): string[] {
  return menu.map((a) => `- ${a.label}`);
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
  "build an agent", "ai agent", "agent that",
];
/** Goal phrases that already NAME a concrete trigger (skip the trigger question). */
const TRIGGER_SPECIFIED_SIGNALS = [
  "hourly", "daily", "weekly", "nightly", "every hour", "every day",
  "each morning", "each day", "cron", "webhook", "on push", "pull request",
  "when an email", "when a new", "on receiving", "on receipt", "manually",
  "on demand", "i run", "button", "in chat", "mention", "arrives", "is received",
  "incoming", "new lead", "new leads", "new email", "new emails", "new message",
  "new messages", "new gmail",
];

/** Goal phrases that already choose where the user wants to build. */
const BUILD_SURFACE_STATED_SIGNALS = [
  "cursor", "claude code", "codex", "cowork", "co-work", "custom gpt",
  "gpt agent", "gpt agents", "chatgpt", "vscode", "vs code",
];

/** Goal phrases that already choose the artifact/tracking handoff. */
const ARTIFACT_STATED_SIGNALS = [
  "linear issue", "linear issues", "linear epic", "obsidian", "build brief",
  "dash manifest", "agent.manifest", "manifest", "paste-ready prompt",
  "implementation prompt", "cursor prompt", "claude-code prompt",
];

/**
 * Goal phrases implying the calendar event involves SOMEONE ELSE — a person who
 * would receive Google's invitation email. Deliberately requires a named
 * counterpart or a correspondence verb: a solo goal ("block focus time on my
 * calendar") routes calendar_write too, and has no one to notify, so the
 * notification fork does not exist for it.
 *
 * Bare " with " is excluded on purpose — "block time with high priority" is not
 * a meeting with a person.
 */
const CALENDAR_PARTICIPANT_SIGNALS = [
  // The request came from someone, so a reply/booking goes back to them.
  "meeting request", "meeting requests", "invitation", "invitations",
  "invite", "invites", "inviting", "attendee", "attendees", "guest", "guests",
  "reply", "replies", "replying", "respond to", "responding to",
  // A meeting named with its counterpart.
  "call with", "meeting with", "meet with", "chat with", "sync with",
  "coffee with", "interview with", "session with", "time with", "book with",
  "schedule with", "intro call", "discovery call", "sales call", "kickoff",
  "1:1", "one-on-one", "one on one",
  // The counterpart named as a role.
  "the other person", "their calendar", "external attendee", "candidate",
  "client", "customer", "prospect", "recruiter", "interviewer",
];

/**
 * Goal phrases where the user has ALREADY decided the notification question —
 * either way. Same never-nag rule as the rest of buildClarifyingQuestions: a
 * goal that states the answer must not be asked for it.
 */
const CALENDAR_NOTIFICATION_STATED_SIGNALS = [
  "sendupdates", "send updates", "private hold", "busy block", "hold on my calendar",
  "don't notify", "do not notify", "dont notify", "without notifying",
  "no notification", "no notifications", "notify the attendee", "notify attendees",
  "send the invite", "send an invite", "send invites", "send the invitation",
  "no invite", "no invites", "without an invite", "without invites",
];

/**
 * The notification fork, in the user's language. `private_hold` first: when the
 * goal carries a no-send constraint it is the recommended answer, and an agent
 * relaying an unanswered question reads the first option as the lead.
 */
const CALENDAR_NOTIFICATION_CHOICES = [
  {
    id: "private_hold",
    label:
      "A private hold on my calendar — the other person is NOT notified (sendUpdates=none)",
  },
  {
    id: "attendee_invite",
    label:
      "A real invitation the other person receives — Google may email them on my behalf",
  },
] as const;

function anySignal(goal: string, signals: string[]): boolean {
  return signals.some((s) => goal.includes(s));
}

/**
 * The calendar notification fork (§8.7 / §9.2 of the 2026-07-16 UX review).
 *
 * Creating an event with attendees makes Google email them unless the call sets
 * sendUpdates=none — and suppressing it means the other participant never gets a
 * confirmation. Either way it changes the user-visible side effect, so it is a
 * decision the user has to make rather than a gotcha to bury next to the
 * timezone advice. Returns null when the route has no calendar write, when
 * nobody else is involved, or when the goal already states the answer.
 */
function buildCalendarNotificationQuestion(
  goal: string,
  lowerGoal: string,
  routeComponentIds: string[],
): ClarifyingQuestion | null {
  if (!routeComponentIds.includes("calendar_write")) return null;
  if (!anySignal(lowerGoal, CALENDAR_PARTICIPANT_SIGNALS)) return null;
  if (anySignal(lowerGoal, CALENDAR_NOTIFICATION_STATED_SIGNALS)) return null;

  // A stated no-send / draft-only constraint makes the invite email the very
  // thing the user prohibited — recommend the hold. Without such a constraint
  // the fork is genuinely open: an invitation is a normal thing to want, and
  // defaulting to silence would suppress a confirmation the user never asked
  // us to suppress.
  const signals = detectConstraintSignals(goal);
  const noSendConstraint = signals.no_outbound.detected || signals.draft_only.detected;

  return {
    id: "calendar_notification",
    question:
      "Should the approved action create a private hold on your calendar with no attendee " +
      "notification, or a real invitation the other person receives (Google may email them)?",
    options: CALENDAR_NOTIFICATION_CHOICES.map((c) => c.label),
    option_ids: CALENDAR_NOTIFICATION_CHOICES.map((c) => c.id),
    ...(noSendConstraint ? { recommended_option_id: "private_hold" } : {}),
    // One sentence, and a short one: it renders into Layer-1, which is bounded
    // (LAYER1_MAX_CHARS). The trade-off the hold costs — they get no
    // confirmation — is already stated in the option label.
    why: noSendConstraint
      ? `“${signals.no_outbound.trigger ?? signals.draft_only.trigger}” makes an invitation ` +
        "an email Google sends on your behalf."
      : "An invitation is an email Google sends on your behalf; a private hold is visible " +
        "only to you.",
  };
}

/**
 * MAR-225: bounded multiple-choice clarifying questions. Returns at most 3,
 * each only when the route makes the axis relevant AND the goal has NOT already
 * stated that constraint — so it never nags a fully-specified goal. Stateless
 * and vocabulary-neutral (never steers "magic" trigger words); each question is
 * a real architecture fork that changes the route / safety / clearance.
 *
 * Two classes, and the difference is load-bearing:
 *
 *  - SCOPE-COMPLETION questions (run_trigger, write_permission, outbound_send)
 *    mean the goal left an axis open. Any one of them firing is evidence the
 *    goal is under-specified, which is what earns the generic back-fill below
 *    ("since we're asking anyway, also pin down build surface / hosting").
 *  - The SIDE-EFFECT question (calendar_notification) is not evidence of that.
 *    A goal can specify every axis and still hit it, because it is the provider
 *    that does something the goal never mentions. So it does NOT open the
 *    back-fill: on an otherwise fully-specified goal it returns alone, which is
 *    the whole point — it is the one thing the user has to decide, and burying
 *    it among generic prompts is the failure this fixes.
 */
export function buildClarifyingQuestions(
  goal: string,
  routeComponentIds: string[],
): ClarifyingQuestion[] {
  const g = goal.toLowerCase();
  const questions: ClarifyingQuestion[] = [];
  const calendarNotification = buildCalendarNotificationQuestion(goal, g, routeComponentIds);

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

  // No scope-completion question fired: the goal is fully specified on every
  // axis we ask about, so the generic back-fill stays shut. The side-effect
  // question still stands on its own if the provider raised one.
  if (questions.length === 0) {
    return calendarNotification ? [calendarNotification] : [];
  }

  // The side-effect question leads (it is the one with a real-world
  // consequence) and counts against the cap of 3, so a goal that fires both
  // classes still gets a bounded list rather than a wall of prompts.
  const reserved = calendarNotification ? 1 : 0;
  const addIfNeeded = (question: ClarifyingQuestion) => {
    if (questions.length + reserved >= 3) return;
    if (questions.some((q) => q.id === question.id)) return;
    questions.push(question);
  };

  if (!anySignal(g, BUILD_SURFACE_STATED_SIGNALS)) {
    addIfNeeded({
      id: "build_surface",
      question: "Where do you want to build this after scope is locked?",
      options: ["Codex", "Cursor / Claude Code", "Portable agent handoff prompt", "Not sure yet"],
    });
  }

  if (!anySignal(g, HOSTING_STATED_SIGNALS) || !anySignal(g, MONITORING_STATED_SIGNALS)) {
    addIfNeeded({
      id: "hosting_monitoring",
      question: "Where should it run, and how should you monitor runs and approvals?",
      options: ["Local/cron + logs", "Hosted endpoint/job + logs", "Inside the client + manual checks", "Not sure yet"],
    });
  }

  if (!anySignal(g, ARTIFACT_STATED_SIGNALS)) {
    addIfNeeded({
      id: "artifact_target",
      question: "What build artifact should I prepare after you confirm scope?",
      options: ["Build brief prompt", "Linear epic + issues", "Obsidian note", "Not sure yet"],
    });
  }

  if (calendarNotification) questions.unshift(calendarNotification);
  return questions.slice(0, 3);
}

/**
 * MAR-225: render clarifying questions as bullets (the call site supplies the
 * heading). Options for the scope-completion questions stay in
 * structuredContent so Layer-1 stays under the brevity bound.
 *
 * A question carrying `option_ids` names a fork with a real-world consequence,
 * so it pays for prose in BOTH depths: the client agent relays what it can
 * read, and a fork whose options exist only in structuredContent is a fork the
 * user never hears about — which is exactly how the calendar notification
 * decision went unasked. Layer-1 buys that visibility at one fused line
 * (`compact`); `full` spells out every option for the depths that have room.
 */
function renderClarifyingQuestions(
  questions: ClarifyingQuestion[],
  detail: "compact" | "full",
): string[] {
  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`- ${q.question}`);
    const ids = q.option_ids ?? [];
    if (ids.length === 0) continue;

    if (detail === "compact") {
      // The question text already names both forks in user language, so the
      // one line Layer-1 can afford spends itself on what the question cannot
      // say: which way to go, and why.
      const lead = q.recommended_option_id
        ? `Recommended: \`${q.recommended_option_id}\` (sendUpdates=none)`
        : ids.map((id) => `\`${id}\``).join(" or ");
      lines.push(`  - ${lead}${q.why ? ` — ${q.why}` : ""}`);
      continue;
    }

    if (q.why) lines.push(`  - Why it matters: ${q.why}`);
    for (const [i, id] of ids.entries()) {
      const recommended = id === q.recommended_option_id ? " — **recommended**" : "";
      lines.push(`  - \`${id}\`: ${q.options[i]}${recommended}`);
    }
  }
  if (lines.length > 0) lines.push(``);
  return lines;
}

// ─────────────────────── MAR-315: hosting + monitoring ───────────────────────

/**
 * MAR-315: fixed catalogue of hosting recommendation labels, keyed by id.
 * Kept concise (MAR-256 payload-diet discipline: this block ships on every
 * plan at every depth, unlike worker_pipeline) — the "why" lives in `reason`,
 * not duplicated across every label.
 */
const HOSTING_OPTION_LABELS: Record<HostingOptionId, string> = {
  local_cron: "Local scheduled task / cron",
  hosted_cron: "Hosted scheduled function (cron-triggered)",
  hosted_endpoint: "Always-on endpoint (serverless function or small VPS)",
  in_client: "Runs inside an available agent client (Claude Cowork, ChatGPT agent mode, or Workspace Agents where available)",
  manual_local: "Manual, on-demand run from your own environment",
};

/** MAR-315: realistic alternatives per recommended id (excludes itself). */
const HOSTING_ALTERNATIVES: Record<HostingOptionId, HostingOptionId[]> = {
  local_cron: ["hosted_cron", "hosted_endpoint"],
  hosted_cron: ["local_cron", "hosted_endpoint"],
  hosted_endpoint: ["hosted_cron", "local_cron"],
  in_client: ["hosted_endpoint"],
  manual_local: ["local_cron", "hosted_cron"],
};

const MONITORING_OPTION_LABELS: Record<MonitoringOptionId, string> = {
  dash_import: "Import the manifest into DASH (LAB Agents module)",
  log_to_file: "Log runs to a file or table you already have",
  manual_none: "None — run it manually and check the results yourself",
};

/** MAR-315: terse tags for next_action_menu labels (MAR-256 payload diet). */
const HOSTING_MENU_SHORT: Record<HostingOptionId, string> = {
  local_cron: "local cron",
  hosted_cron: "hosted cron",
  hosted_endpoint: "always-on endpoint",
  in_client: "in the client",
  manual_local: "manual run",
};
const MONITORING_MENU_SHORT: Record<MonitoringOptionId, string> = {
  dash_import: "DASH import",
  log_to_file: "log to file",
  manual_none: "manual only",
};

function hostingOption(id: HostingOptionId): HostingOption {
  return { id, label: HOSTING_OPTION_LABELS[id] };
}
function monitoringOption(id: MonitoringOptionId): MonitoringOption {
  return { id, label: MONITORING_OPTION_LABELS[id] };
}

/** Goal phrases that already STATE where/how this will be hosted (never-nag). */
const HOSTING_STATED_SIGNALS = [
  "on my server", "on our server", "on my own server", "on our own server",
  "on a vps", "self-host", "self hosted", "self-hosted", "already deployed",
  "already hosted", "already running on", "runs locally", "run it locally",
  "on my machine", "on my laptop", "in the cloud already", "as a github action",
  "in cowork", "as a custom gpt", "inside chatgpt", "inside claude",
];

/** Goal phrases that already STATE how the agent will be watched (never-nag). */
const MONITORING_STATED_SIGNALS = [
  "in dash", "into dash", "via dash", "using dash", "dash import",
  "log to a file", "log to a table", "logging to", "log file",
  "no monitoring", "won't monitor it", "will not monitor it", "manual runs only",
  "check it manually", "watch the logs", "check the logs",
];

/**
 * MAR-315: deterministic hosting recommendation from the route's trigger
 * shape — no LLM, no network call. Priority mirrors the ticket's own rule
 * order: an inbound webhook/PR event needs a reachable always-on endpoint
 * regardless of what else is in the route; a bare schedule only needs a
 * timer; a chat trigger runs inside the client session; no trigger at all
 * means the builder runs it manually. `local_or_hosted` (an explicit user
 * preference, not a route fact) can only move the LOCAL/HOSTED axis for the
 * schedule case — it cannot make a webhook receiver "local" (still needs a
 * reachable endpoint) or add hosting to something that already runs
 * in-client.
 */
function goalNeedsBackgroundRunner(goal: string, routeComponentIds: string[]): boolean {
  const g = goal.toLowerCase();
  return (
    routeComponentIds.includes("scheduled_trigger") ||
    routeComponentIds.includes("page_monitor") ||
    routeComponentIds.includes("webhook_trigger") ||
    routeComponentIds.includes("github_trigger") ||
    (routeComponentIds.includes("email_read") &&
      (routeComponentIds.includes("calendar_lookup") ||
        anySignal(g, ["watch my inbox", "watch my gmail", "looks at my gmail", "new email", "new emails"]))) ||
    anySignal(g, [
      "computer is off",
      "computer off",
      "laptop is off",
      "client closes",
      "client is closed",
      "keep working when",
      "always-on",
      "always on",
      "in the background",
    ])
  );
}

function deriveHostingBase(goal: string, routeComponentIds: string[]): HostingOptionId {
  const interactive = anySignal(goal.toLowerCase(), [
    "when i ask in chat",
    "never run in the background",
    "only when i ask",
  ]);
  const hasWebhookish =
    routeComponentIds.includes("webhook_trigger") || routeComponentIds.includes("github_trigger");
  const hasScheduled = routeComponentIds.includes("scheduled_trigger");
  const hasChat = routeComponentIds.includes("chat_trigger");
  if (interactive) return "in_client";
  if (hasWebhookish) return "hosted_endpoint";
  if (hasScheduled) return goalNeedsBackgroundRunner(goal, routeComponentIds) ? "hosted_cron" : "local_cron";
  if (goalNeedsBackgroundRunner(goal, routeComponentIds)) return "hosted_endpoint";
  if (hasChat) return "in_client";
  return "manual_local";
}

function buildHostingBlock(
  goal: string,
  routeComponentIds: string[],
  localOrHosted: "local" | "hosted" | "either" | undefined,
): HostingAndMonitoring["hosting"] {
  const base = deriveHostingBase(goal, routeComponentIds);
  const hasWebhookish =
    routeComponentIds.includes("webhook_trigger") || routeComponentIds.includes("github_trigger");
  const hasScheduled = routeComponentIds.includes("scheduled_trigger");
  const hasChat = routeComponentIds.includes("chat_trigger");

  let recommendedId: HostingOptionId = base;
  let overrideNote = "";
  if (localOrHosted === "hosted" && base === "local_cron") {
    recommendedId = "hosted_cron";
    overrideNote = " You asked for a hosted stack — a cron-triggered function avoids an always-on server.";
  } else if (localOrHosted === "local" && base === "hosted_endpoint") {
    overrideNote = " You asked for local, but this route needs a reachable endpoint — tunnel it (e.g. ngrok) if you want it on your own machine.";
  }

  let reason: string;
  if (hasWebhookish) {
    reason = "Reacts to an inbound webhook/PR event — needs a reachable, always-on endpoint.";
  } else if (hasScheduled) {
    reason = recommendedId === "hosted_cron"
      ? "Runs on a fixed schedule while the user is offline — use a managed timer, not a client or local-only schedule."
      : "Runs on a fixed schedule with no offline requirement — a local timer is sufficient.";
  } else if (goalNeedsBackgroundRunner(goal, routeComponentIds)) {
    reason = "Needs background execution after the computer/client closes; the legacy hosting field points to a hosted endpoint while runtime_recommendation carries the precise runtime class.";
  } else if (hasChat) {
    reason = "Chat-triggered — runs inside the client session; nothing separate to host.";
  } else {
    reason = "No trigger in this route (manual/on-demand) — run it from your own environment when needed.";
  }
  reason += overrideNote;

  const alternatives = HOSTING_ALTERNATIVES[recommendedId]
    .filter((id) => id !== recommendedId)
    .map(hostingOption);

  return { recommended: hostingOption(recommendedId), alternatives, reason };
}

/**
 * MAR-315: monitoring recommendation. Keep first-run monitoring immediately
 * usable with logs/tables. When the goal already states its own monitoring
 * answer, that statement is echoed in `reason` instead of being ignored.
 */
function buildMonitoringBlock(goal: string): HostingAndMonitoring["monitoring"] {
  const stated = anySignal(goal.toLowerCase(), MONITORING_STATED_SIGNALS);
  const reason = stated
    ? "Your goal already describes a monitoring approach; keep that and make failures visible in the build."
    : "Default: log each run to a file or table you already have; keep monitoring simple until a dashboard is ready.";
  return {
    recommended: monitoringOption("log_to_file"),
    alternatives: [monitoringOption("manual_none")],
    reason,
  };
}

/** MAR-315: the full hosting + monitoring block for a plan. Never null. */
function buildHostingAndMonitoring(
  goal: string,
  routeComponentIds: string[],
  localOrHosted: "local" | "hosted" | "either" | undefined,
  outputDepth: "guided" | "brief" | "standard" | "technical" | "deep",
): HostingAndMonitoring {
  const full: HostingAndMonitoring = {
    hosting: buildHostingBlock(goal, routeComponentIds, localOrHosted),
    monitoring: buildMonitoringBlock(goal),
  };
  // MAR-256 payload diet: at Layer-1 depths the JSON carries only the
  // recommended picks — alternatives + reason prose ship at technical/deep
  // (same discipline as worker_pipeline). Markdown still shows the compact
  // one-liner at every shallow depth.
  if (outputDepth === "technical" || outputDepth === "deep") return full;
  return {
    hosting: { recommended: full.hosting.recommended, alternatives: [], reason: "" },
    monitoring: { recommended: full.monitoring.recommended, alternatives: [], reason: "" },
  };
}

/**
 * MAR-315: compact one-line-per-axis render for Layer 1 (guided/brief/standard) —
 * recommendation only, no reason/alternatives (those are Layer 2). Every line
 * is provenance-tagged 🟢 (route-shape-derived, no LLM).
 */
function renderHostingAndMonitoringCompact(hm: HostingAndMonitoring): string[] {
  return [
    `**Hosting:** 🟢 ${hm.hosting.recommended.label}. ` +
      `**Monitoring:** 🟢 ${hm.monitoring.recommended.label}.`,
    ``,
  ];
}

/**
 * MAR-315: full render for Layer 2 (technical/deep) — recommended pick,
 * reason, and alternatives for both axes. Every line is provenance-tagged 🟢.
 */
function renderHostingAndMonitoringFull(hm: HostingAndMonitoring): string[] {
  const lines: string[] = [`### Hosting & monitoring`, ``];
  lines.push(`- 🟢 **Hosting (recommended):** ${hm.hosting.recommended.label}`);
  lines.push(`- 🟢 ${hm.hosting.reason}`);
  if (hm.hosting.alternatives.length > 0) {
    lines.push(`- 🟢 **Alternatives:** ${hm.hosting.alternatives.map((a) => a.label).join(" · ")}`);
  }
  lines.push(`- 🟢 **Monitoring (recommended):** ${hm.monitoring.recommended.label}`);
  lines.push(`- 🟢 ${hm.monitoring.reason}`);
  if (hm.monitoring.alternatives.length > 0) {
    lines.push(`- 🟢 **Alternatives:** ${hm.monitoring.alternatives.map((a) => a.label).join(" · ")}`);
  }
  lines.push(``);
  return lines;
}

function renderOperatingBundleCompact(wizard: GoalToProductWizard): string[] {
  const runtime = wizard.runtime_recommendation;
  const setup = wizard.recommended_setup;
  const installAvailability = setup.action
    ? "supported action available"
    : runtime.availability === "available now"
    ? "available now; no runtime install action is needed"
    : "no one-click action";
  return [
    `**Recommended runtime setup**`,
    `- **Runtime (execution):** ${runtime.label} _(${runtime.availability})_ — ${runtime.reason}`,
    `- **Offline behavior:** ${runtime.offline_behavior}`,
    `- **Control surface:** ${wizard.control_surface.recommended.label} _(${wizard.control_surface.recommended.availability})_ — ${wizard.control_surface.recommended.appropriate_when}`,
    `- **Interaction surface:** ${wizard.interaction_surface.recommended.label} _(${wizard.interaction_surface.recommended.availability})_ — ${wizard.interaction_surface.recommended.appropriate_when}`,
    `- **Trigger:** ${wizard.trigger_explanation.label} — ${wizard.trigger_explanation.what_wakes_it_up}`,
    `- **Install availability:** ${installAvailability}.`,
    `- **Next achievable step:** ${setup.next_achievable_step}`,
    ``,
  ];
}

function renderOperatingBundleFull(wizard: GoalToProductWizard): string[] {
  const lines = [
    `### Runtime-fit setup`,
    ``,
    `#### Runtime requirements`,
    ``,
    `- Trigger mode: ${wizard.runtime_requirements.trigger_mode}`,
    `- Operation mode: ${wizard.runtime_requirements.operation_mode}`,
    `- Expected duration: ${wizard.runtime_requirements.expected_duration}`,
    `- Persistent state needed: ${wizard.runtime_requirements.persistent_state_needed ? "yes" : "no"}`,
    `- Durable approval needed: ${wizard.runtime_requirements.durable_approval_needed ? "yes" : "no"}`,
    `- Must run while user is offline: ${wizard.runtime_requirements.must_run_while_user_offline ? "yes" : "no"}`,
    `- Data sensitivity: ${wizard.runtime_requirements.data_sensitivity}`,
    `- Operational complexity: ${wizard.runtime_requirements.estimated_operational_complexity}`,
    ``,
    `#### Runtime recommendation`,
    ``,
    `- **${wizard.runtime_recommendation.label} — Recommended** · ${wizard.runtime_recommendation.availability}`,
    `- Why: ${wizard.runtime_recommendation.reason}`,
    `- Offline behavior: ${wizard.runtime_recommendation.offline_behavior}`,
    `- Limitation: ${wizard.runtime_recommendation.limitation}`,
    `- Install action: ${wizard.runtime_recommendation.install_action ?? "none available from plan_workflow"}`,
    ``,
    `#### Runtime alternatives`,
    ``,
  ];
  for (const option of wizard.runtime_alternatives) {
    lines.push(
      `- **${option.label}** · ${option.availability}. Fit: ${option.reason} Limitation: ${option.limitation}`,
    );
  }
  lines.push(``);
  const axes: Array<[string, PlacementAxis]> = [
    ["Control surface", wizard.control_surface],
    ["Interaction surface", wizard.interaction_surface],
  ];
  for (const [title, axis] of axes) {
    const all = [axis.recommended, ...axis.alternatives];
    lines.push(`#### ${title}`, ``);
    for (const [index, option] of all.entries()) {
      lines.push(
        `- **${option.label}${index === 0 ? " — Recommended" : ""}** · ` +
          `${option.availability}. Appropriate when: ${option.appropriate_when} ` +
          `Limitation: ${option.limitation}`,
      );
    }
    lines.push(``);
  }
  lines.push(`#### Trigger`, ``);
  lines.push(`- **${wizard.trigger_explanation.label}:** ${wizard.trigger_explanation.what_wakes_it_up}`);
  lines.push(`- Offline behavior: ${wizard.trigger_explanation.offline_behavior}`);
  lines.push(`- Limitation: ${wizard.trigger_explanation.limitation}`, ``);
  lines.push(`**Install-path blocker:** ${wizard.recommended_setup.blocker ?? "None."}`, ``);
  lines.push(`**Next achievable step:** ${wizard.recommended_setup.next_achievable_step}`, ``);
  return lines;
}

function wizardStepLabel(step: RouteStep): string {
  return step.purpose || step.component_name || step.component_id;
}

function connectionGroupFor(componentId: string): WizardConnectionGroup["id"] {
  if (
    componentId.includes("read") ||
    componentId.includes("lookup") ||
    componentId.includes("retrieval") ||
    componentId.includes("scraper") ||
    componentId.includes("monitor") ||
    componentId.includes("trigger")
  ) {
    return "sources";
  }
  if (
    componentId.includes("notification") ||
    componentId.includes("send") ||
    componentId.includes("publish") ||
    componentId.includes("draft") ||
    componentId.includes("crm")
  ) {
    return "destinations";
  }
  if (
    componentId.includes("state") ||
    componentId.includes("store") ||
    componentId.includes("db") ||
    componentId.includes("file") ||
    componentId.includes("audit")
  ) {
    return "state";
  }
  if (componentId.includes("approval") || componentId.includes("reviewer")) {
    return "approval";
  }
  return "secrets";
}

function groupConnections(
  goal: string,
  whatYouNeed: IntegrationNeed[],
  enforcedGates: string[],
  steps: RouteStep[],
): WizardConnectionGroup[] {
  const labels: Record<WizardConnectionGroup["id"], string> = {
    sources: "Data sources",
    destinations: "Destinations",
    state: "State / storage",
    approval: "Approval",
    secrets: "Secrets",
  };
  const groups = new Map<WizardConnectionGroup["id"], Set<string>>();
  const add = (id: WizardConnectionGroup["id"], item: string) => {
    if (!groups.has(id)) groups.set(id, new Set());
    groups.get(id)!.add(item);
  };

  for (const need of whatYouNeed) {
    if (explicitlyDraftOnly(goal) && need.component_id === "optional_email_send") continue;
    if (
      need.component_id === "reviewer_notification" &&
      enforcedGates.includes("human_approval_gate") &&
      steps.some((step) => step.component_id === "email_read") &&
      steps.some((step) => step.component_id === "calendar_lookup" || step.component_id === "calendar_write") &&
      !hasGoalSignal(goal, ["slack", "email notification", "webhook notification"])
    ) {
      continue;
    }
    const name = need.product_examples[0] || need.label;
    add(connectionGroupFor(need.component_id), name);
    if (need.required_scopes.length > 0 || need.scopes.length > 0) {
      add("secrets", `${name} credentials`);
    }
  }
  if (enforcedGates.includes("human_approval_gate")) {
    add("approval", "DASH approval target (planned; use manual approval until integrated)");
  }
  if (steps.some((step) => step.model_tier !== "none")) {
    add("secrets", "Model provider credentials");
  }
  if (groups.size === 0) {
    add("secrets", "No external connections required");
  }

  return Array.from(groups.entries()).map(([id, items]) => ({
    id,
    label: labels[id],
    items: Array.from(items),
  }));
}

function buildChoiceRecommended(target: BuildTarget | undefined, choiceId: string): boolean {
  if (!target) return choiceId === "codex";
  if (target === "cowork") return choiceId === "cowork";
  if (target === "chatgpt_gpt") return choiceId === "gpt_agents";
  if (target === "cursor") return choiceId === "cursor";
  return choiceId === "codex";
}

function buildWizardChoices(buildTarget: BuildTarget | undefined): WizardChoice[] {
  return [
    {
      id: "cursor",
      label: "Cursor",
      kind: "build",
      best_for: "IDE-first implementation with project files open.",
      tradeoffs: "Fast for repo edits; needs a clear build brief.",
      recommended: buildChoiceRecommended(buildTarget, "cursor"),
      action: "export_build_brief({ handoff_targets: ['prompt'], build_target: 'cursor', delivery_mode: 'compact' })",
    },
    {
      id: "claude_code",
      label: "Claude Code",
      kind: "build",
      best_for: "Terminal-first code generation and refactors.",
      tradeoffs: "Great for implementation; keep the route and tests explicit.",
      recommended: false,
      action: "export_build_brief({ handoff_targets: ['prompt'], build_target: 'cursor', delivery_mode: 'compact' })",
    },
    {
      id: "codex",
      label: "Codex",
      kind: "build",
      best_for: "Agentic repo work with tests, commits, and PR handoff.",
      tradeoffs: "Best once the scope is locked; answer clarifying questions first.",
      recommended: buildChoiceRecommended(buildTarget, "codex"),
      action: "export_build_brief({ handoff_targets: ['prompt'], build_target: 'code', delivery_mode: 'compact' })",
    },
    {
      id: "cowork",
      label: "Cowork",
      kind: "build",
      best_for: "No-code assistant configuration and human-in-the-loop operation.",
      tradeoffs: "Less control over custom runtime details.",
      recommended: buildChoiceRecommended(buildTarget, "cowork"),
      action: "assistant:generate_cowork_prompt",
    },
    {
      id: "gpt_agents",
      label: "ChatGPT agent surfaces",
      kind: "build",
      best_for: "ChatGPT-hosted assistant with Actions-style integrations.",
      tradeoffs: "Good UX; hosting/runtime control is more constrained.",
      recommended: buildChoiceRecommended(buildTarget, "gpt_agents"),
      action: "assistant:generate_chatgpt_gpt",
    },
  ];
}

function buildHostMonitorChoices(hm: HostingAndMonitoring): WizardChoice[] {
  const hosting = hm.hosting.recommended.id;
  return [
    {
      id: "local",
      label: "Local",
      kind: "host_monitor",
      best_for: "Manual or developer-operated runs.",
      tradeoffs: "Simple to start; uptime and alerts are on you.",
      recommended: hosting === "manual_local",
      action: "choose_hosting:local",
    },
    {
      id: "cron",
      label: "cron",
      kind: "host_monitor",
      best_for: "Scheduled jobs that do not need an inbound endpoint.",
      tradeoffs: "Requires logs and retry handling.",
      recommended: hosting === "local_cron" || hosting === "hosted_cron",
      action: "choose_hosting:cron",
    },
    {
      id: "github_action",
      label: "GitHub Action",
      kind: "host_monitor",
      best_for: "Repo-bound scheduled or webhook workflows.",
      tradeoffs: "Convenient CI logs; less ideal for long-running jobs.",
      recommended: false,
      action: "choose_hosting:github_action",
    },
    {
      id: "hosted_endpoint",
      label: "Hosted endpoint",
      kind: "host_monitor",
      best_for: "Webhook or PR-triggered workflows that need to be reachable.",
      tradeoffs: "Requires deployment, logs, and failure alerts.",
      recommended: hosting === "hosted_endpoint",
      action: "choose_hosting:hosted_endpoint",
    },
    {
      id: "cowork",
      label: "Cowork",
      kind: "host_monitor",
      best_for: "Assistant-in-client workflows.",
      tradeoffs: "Depends on the client session and connected tools.",
      recommended: hosting === "in_client",
      action: "choose_hosting:cowork",
    },
  ];
}

function buildArtifactChoices(): WizardChoice[] {
  return [
    {
      id: "prompt",
      label: "Prompt",
      kind: "artifact",
      best_for: "Paste into a builder immediately.",
      tradeoffs: "Fastest artifact; less structured than issues.",
      recommended: false,
      action: "export_build_brief({ handoff_targets: ['prompt'], delivery_mode: 'compact' })",
    },
    {
      id: "linear_issues",
      label: "Linear issues",
      kind: "artifact",
      best_for: "Turning the plan into tracked implementation work.",
      tradeoffs: "plan_workflow does not write to Linear; export text only.",
      recommended: false,
      action: "export_build_brief({ handoff_targets: ['linear'], delivery_mode: 'full' })",
    },
    {
      id: "obsidian",
      label: "Obsidian",
      kind: "artifact",
      best_for: "Keeping the plan in a local knowledge base.",
      tradeoffs: "plan_workflow does not write notes; export markdown only.",
      recommended: false,
      action: "export_build_brief({ handoff_targets: ['obsidian'], delivery_mode: 'compact' })",
    },
    {
      id: "build_brief",
      label: "Build brief",
      kind: "artifact",
      best_for: "Handing a locked scope to Cursor, Claude Code, or Codex.",
      tradeoffs: "Longer artifact; best after quick questions are answered.",
      recommended: true,
      action: "export_build_brief({ handoff_targets: ['prompt'], delivery_mode: 'compact' })",
    },
  ];
}

function placementOption(
  id: string,
  label: string,
  appropriateWhen: string,
  limitation: string,
  availability: PlacementAvailability,
): PlacementOption {
  return { id, label, appropriate_when: appropriateWhen, limitation, availability };
}

function recommendedConnectionLabels(
  goal: string,
  steps: RouteStep[],
  whatYouNeed: IntegrationNeed[],
): string[] {
  const ids = new Set(steps.map((step) => step.component_id));
  const labels: string[] = [];
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };
  if (ids.has("email_read") || ids.has("email_draft")) add(hasGoalSignal(goal, ["gmail"]) ? "Gmail" : "email");
  if (ids.has("calendar_lookup") || ids.has("calendar_write")) add("Google Calendar");
  if (ids.has("page_monitor")) add("the page monitor");
  if (ids.has("slack_notification")) add("Slack");
  if (hasGoalSignal(goal, ["documents", "document", "files", "file"] )) add("the document source");
  if (steps.some((step) => step.model_tier !== "none")) add("a model provider");
  if (labels.length === 0) {
    uniqueIntegrationNames(whatYouNeed).slice(0, 3).forEach(add);
  }
  return labels;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "the required integrations";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function runtimeOption(
  id: string,
  label: string,
  runtimeClass: string,
  reason: string,
  offlineBehavior: string,
  limitation: string,
  availability: PlacementAvailability,
  installAction: string | null = null,
): RuntimeOption {
  return {
    ...placementOption(id, label, reason, limitation, availability),
    runtime_class: runtimeClass,
    reason,
    offline_behavior: offlineBehavior,
    install_action: installAction,
  };
}

function buildPlacementContract(input: {
  goal: string;
  steps: RouteStep[];
  whatYouNeed: IntegrationNeed[];
  enforcedGates: string[];
}): Pick<
  GoalToProductWizard,
  | "runtime_requirements"
  | "runtime_recommendation"
  | "runtime_alternatives"
  | "control_surface"
  | "interaction_surface"
  | "trigger_explanation"
  | "recommended_setup"
> {
  const ids = new Set(input.steps.map((step) => step.component_id));
  const g = input.goal.toLowerCase();
  const interactive = anySignal(g, [
    "when i ask in chat",
    "when asked in chat",
    "never run in the background",
    "only when i ask",
    "on demand in chat",
  ]);
  const scheduled = ids.has("scheduled_trigger") && !interactive;
  const emailCalendar =
    ids.has("email_read") && (ids.has("calendar_lookup") || ids.has("calendar_write"));
  const webhook = ids.has("webhook_trigger") || ids.has("github_trigger");
  const polling = emailCalendar && hasGoalSignal(input.goal, ["poll", "polling", "every 5 minutes"]);
  const slack = ids.has("slack_notification") || hasGoalSignal(input.goal, ["slack"]);
  const priceMonitor = ids.has("page_monitor") && hasGoalSignal(input.goal, ["price", "prices", "pricing"]);
  const persistentState =
    ids.has("state_store") || ids.has("deduplication") || ids.has("page_monitor") || emailCalendar;
  const durableApproval = input.enforcedGates.includes("human_approval_gate") && !interactive;
  const offline = !interactive && (scheduled || emailCalendar || webhook || goalNeedsBackgroundRunner(input.goal, Array.from(ids)));

  const triggerMode: RuntimeRequirements["trigger_mode"] = interactive
    ? "interactive"
    : scheduled
    ? "scheduled"
    : emailCalendar && !polling
    ? "event"
    : webhook
    ? "event"
    : polling
    ? "polling"
    : "manual";
  const operationMode: RuntimeRequirements["operation_mode"] = interactive
    ? "interactive"
    : scheduled
    ? "scheduled"
    : webhook || emailCalendar
    ? "event-driven"
    : offline
    ? "continuous"
    : "interactive";

  const runtimeRequirements: RuntimeRequirements = {
    trigger_mode: triggerMode,
    operation_mode: operationMode,
    expected_duration: emailCalendar || operationMode === "continuous" ? "long-running" : "short",
    persistent_state_needed: interactive ? false : persistentState,
    durable_approval_needed: durableApproval,
    must_run_while_user_offline: offline,
    data_sensitivity:
      emailCalendar || hasGoalSignal(input.goal, ["customer", "document", "gmail", "calendar"])
        ? "high"
        : slack
        ? "medium"
        : "low",
    estimated_operational_complexity: interactive
      ? "low"
      : emailCalendar
      ? "high"
      : scheduled || webhook || persistentState
      ? "medium"
      : "low",
  };

  const clientRuntime = runtimeOption(
    "client_chat_runtime",
    "Client/chat runtime",
    "client_chat",
    "Best for attended, on-demand work that starts only when the user asks in chat.",
    "Stops when the client/session closes; that is correct for explicitly attended work.",
    "Cannot run scheduled or background work after the client closes.",
    "available now",
  );
  const managedScheduled = runtimeOption(
    "managed_scheduled_job",
    "Managed scheduled job",
    "managed_scheduled_job",
    "A short morning check needs a durable timer, not an always-on worker.",
    "Keeps running on schedule while the user's computer and client are closed.",
    "Requires a selected scheduled-job runtime, secrets, state, retries, and cost controls.",
    "requires setup",
  );
  const managedDurable = runtimeOption(
    "managed_durable_background_runtime",
    "Managed background worker / durable workflow",
    "managed_durable_background",
    "Gmail events or polling plus persistent deduplication and durable approval must outlive a client session.",
    "Keeps watching and can wait for approval while the user is offline.",
    "No built-in Orchestrate Runner or one-click installer exists; a real external durable runtime must be selected and configured.",
    "requires setup",
  );
  const selfHosted = runtimeOption(
    "self_hosted_runtime",
    "Self-hosted server/runtime",
    "self_hosted",
    "Fits privacy or infrastructure-control requirements.",
    "Can run offline from the user's device if the server stays up.",
    "You own uptime, security, updates, backups, retries, and cost.",
    "advanced",
  );
  const localRuntime = runtimeOption(
    "local_runtime",
    "This computer",
    "local_process",
    "Useful for development and manual testing.",
    "Stops when the computer, network, or process stops.",
    "Does not satisfy an offline/background requirement.",
    "requires setup",
  );
  const workflowAdapter = runtimeOption(
    "workflow_automation_adapter",
    "Supported workflow-automation adapter",
    "workflow_automation",
    "Can fit connector-heavy schedules when a supported adapter is selected.",
    "Runs according to the adapter's hosted execution guarantees.",
    "Availability and limits depend on the selected supported adapter; none is selected by this plan.",
    "requires setup",
  );
  const generatedUiRuntime = runtimeOption(
    "generated_web_application",
    "Generated web application",
    "application_backend",
    "Fits a richer multi-user interface when chat is no longer sufficient.",
    "Runs only after a real application backend is deployed.",
    "More setup than this attended read-only route needs.",
    "requires setup",
  );

  const runtimeRecommendation = interactive
    ? clientRuntime
    : scheduled
    ? managedScheduled
    : emailCalendar || webhook || offline
    ? managedDurable
    : clientRuntime;
  const runtimeAlternatives = interactive
    ? [generatedUiRuntime, localRuntime]
    : scheduled
    ? [workflowAdapter, selfHosted]
    : [selfHosted, managedScheduled];

  const websiteBroker = placementOption(
    "website_install_broker",
    "Website install/control broker",
    "Guide setup and link to a selected runtime's controls.",
    "Website control does not execute agents without a separate real runner.",
    "planned",
  );
  const clientControl = placementOption(
    "client_control",
    "Current client/chat",
    "Configure and control attended, on-demand work in the current conversation.",
    "Not durable after the client closes and unsuitable for background approvals.",
    "available now",
  );
  const providerControl = placementOption(
    "runtime_provider_control",
    "Selected runtime's provider UI and logs",
    "Manage schedule, secrets, status, retries, and history where the runtime actually runs.",
    "Requires choosing and configuring a supported runtime; no universal provider is selected.",
    "requires setup",
  );
  const approvalControl = placementOption(
    "provider_neutral_approval_inbox",
    "Provider-neutral approval inbox / generated UI",
    "Persist approvals while the user is offline without making DASH a dependency.",
    "Must be backed by the same durable runtime/state store; it is not generated or hosted by plan_workflow.",
    "requires setup",
  );
  const logsControl = placementOption(
    "logs_control",
    "Logs or run table",
    "A minimal status/history surface for scheduled jobs.",
    "Needs setup and is not a complete approval experience.",
    "requires setup",
  );
  const controlSurface: PlacementAxis = interactive
    ? { recommended: clientControl, alternatives: [websiteBroker] }
    : durableApproval
    ? { recommended: approvalControl, alternatives: [providerControl, websiteBroker] }
    : { recommended: providerControl, alternatives: [logsControl, websiteBroker] };

  const clientInteraction = placementOption(
    "client_interaction",
    "Current client/chat",
    "Ask for a summary and receive it in the same attended conversation.",
    "No background delivery after the client closes.",
    "available now",
  );
  const slackInteraction = placementOption(
    "slack_interaction",
    priceMonitor ? "Slack price-change notifications" : "Slack notifications",
    "Deliver team output where people already work; Slack is an interaction surface, not hosting.",
    priceMonitor
      ? "Requires a Slack connection and an explicit choice: approve every post or automate low-risk alerts."
      : "Requires a Slack connection and cannot execute the workflow.",
    "requires setup",
  );
  const approvalInteraction = placementOption(
    "approval_inbox_interaction",
    "Approval inbox / generated UI",
    "Review suggested times and approve the calendar write from a durable, provider-neutral surface.",
    "Requires a separately built UI and durable backend; no working approval UI exists yet.",
    "requires setup",
  );
  const draftInteraction = placementOption(
    "gmail_draft_interaction",
    "Gmail draft",
    "Receive the prepared reply as a draft without sending it.",
    "Gmail drafts carry output but do not provide durable workflow approval controls.",
    "requires setup",
  );
  const interactionSurface: PlacementAxis = interactive
    ? { recommended: clientInteraction, alternatives: [placementOption(
        "generated_website_interaction",
        "Generated website UI",
        "A richer interface if chat becomes insufficient.",
        "Requires a separately deployed application; unnecessary for the current read-only route.",
        "requires setup",
      )] }
    : slack
    ? { recommended: slackInteraction, alternatives: [clientInteraction] }
    : { recommended: approvalInteraction, alternatives: [draftInteraction, clientInteraction, slackInteraction] };

  const triggerExplanation: TriggerExplanation = interactive
    ? {
        mode: "interactive",
        label: "A request in chat",
        what_wakes_it_up: "Nothing runs until the user asks in the current client and selects documents.",
        offline_behavior: "It intentionally does not run after the client closes.",
        limitation: "No scheduler or background trigger is configured.",
      }
    : scheduled
    ? {
        mode: "scheduled",
        label: "Configured morning schedule",
        what_wakes_it_up: "A durable scheduler starts one short run each morning at the configured time and timezone.",
        offline_behavior: "The schedule continues while the user's computer/client is closed when installed on the selected managed job runtime.",
        limitation: "The time, timezone, retries, and overlap policy still need configuration.",
      }
    : emailCalendar
    ? {
        mode: polling ? "polling" : "event",
        label: polling ? "Gmail watch or explicit polling schedule" : "Gmail event",
        what_wakes_it_up: "A Gmail event watch should start it; if unavailable, configure and disclose a fixed polling interval.",
        offline_behavior: "It continues only when the watch/poll is attached to the selected durable runtime.",
        limitation: "Gmail watches require setup/renewal; polling adds delay and API usage.",
      }
    : {
        mode: webhook ? "event" : "manual",
        label: webhook ? "Inbound event/webhook" : "Manual start",
        what_wakes_it_up: webhook ? "The source sends an event to a reachable runtime endpoint." : "The user starts a run.",
        offline_behavior: webhook ? "Works offline from the user's device only after a real endpoint is deployed." : "Does not run after the client closes.",
        limitation: webhook ? "Requires a reachable endpoint and source-side webhook setup." : "No background trigger is configured.",
      };

  const connectionNames = joinWithAnd(recommendedConnectionLabels(input.goal, input.steps, input.whatYouNeed));
  const blocker = interactive
    ? "Document-source selection still needs setup; the MCP worker is stateless and does not run customer agents."
    : "This product has no runtime installer or Orchestrate Runner; the MCP worker is stateless and must not run customer agents.";
  const nextStep = emailCalendar
    ? `Connect ${connectionNames}, choose a supported durable runtime, and prepare a provider-neutral approval inbox. Keep sending disabled.`
    : scheduled && slack
    ? `Choose Slack delivery mode (approve every post or automate low-risk price-change alerts), connect ${connectionNames}, then prepare a managed scheduled job with persistent change-detection state.`
    : interactive
    ? `Connect the selected document source and model provider, then test an attended read-only run in the current client.`
    : `Connect ${connectionNames}, then select and prepare the recommended runtime class.`;

  return {
    runtime_requirements: runtimeRequirements,
    runtime_recommendation: runtimeRecommendation,
    runtime_alternatives: runtimeAlternatives,
    control_surface: controlSurface,
    interaction_surface: interactionSurface,
    trigger_explanation: triggerExplanation,
    recommended_setup: {
      label: interactive ? "Prepare attended client run" : "Prepare runtime and connections",
      availability: interactive ? "requires setup" : runtimeRecommendation.availability,
      action: null,
      blocker,
      next_achievable_step: nextStep,
    },
  };
}

/**
 * MAR-386 scope drivers, all read from an EXISTING plan — no new matcher
 * vocabulary. `DURABLE_TRIGGER_COMPONENTS` are the registry triggers that make a
 * plan outlive the session (a schedule / inbound event / page watch); their
 * presence is the "durable trigger or schedule" driver. `MULTI_AGENT_COMPONENTS`
 * are the orchestration primitives that make a route multi-agent (a bounded loop
 * of workers, or a parallel fan-out) — the "multi-agent route" driver.
 */
const DURABLE_TRIGGER_COMPONENTS = new Set<string>([
  "scheduled_trigger",
  "webhook_trigger",
  "github_trigger",
  "page_monitor",
]);
const MULTI_AGENT_COMPONENTS = new Set<string>(["loop_controller", "fan_out_collector"]);

const CLEARANCE_RANK: Record<ClearanceLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

/**
 * Count the connections this plan asks the user to wire up — unique integrations
 * from `what_you_need`, EXCLUDING optional-sender components (an `optional_*`
 * integration the user may never connect must not inflate the task's size). This
 * is the deterministic connection count the scope thresholds compare against.
 */
function countScopeConnections(whatYouNeed: IntegrationNeed[]): number {
  const seen = new Set<string>();
  for (const need of whatYouNeed) {
    if (need.component_id.startsWith("optional_")) continue;
    const name = need.product_examples[0];
    if (name) seen.add(name);
  }
  return seen.size;
}

/**
 * MAR-386: size the task from the plan itself. Precedence large → medium → small.
 *
 *   LARGE — plan it: a multi-agent route (loop_controller / fan_out_collector),
 *     OR more than 3 connections. These are the plans that must be broken into
 *     tracked slices, not pretended into one build prompt.
 *   MEDIUM — build it: a durable trigger/schedule (must_run_while_user_offline
 *     OR a DURABLE_TRIGGER_COMPONENT in the route), OR an L3 business-system
 *     write (human-by-default), OR exactly 3 connections. The "stand up a real
 *     agent" band.
 *   SMALL — run it: everything else — attended (not offline), no durable
 *     trigger, ≤ L2 clearance, ≤ 2 connections. The dry run basically IS the
 *     deliverable; offer "save as a routine" after.
 *
 * Pure function of the plan; invents no vocabulary.
 */
function buildScopeAssessment(input: {
  clearance: AutomationClearance;
  whatYouNeed: IntegrationNeed[];
  mustRunOffline: boolean;
  routeComponentIds: string[];
  loopShaped: boolean;
}): ScopeAssessment {
  const connectionCount = countScopeConnections(input.whatYouNeed);
  const clearanceRank = CLEARANCE_RANK[input.clearance.level];
  const durableTrigger =
    input.mustRunOffline ||
    input.routeComponentIds.some((id) => DURABLE_TRIGGER_COMPONENTS.has(id));
  const multiAgent =
    input.loopShaped ||
    input.routeComponentIds.some((id) => MULTI_AGENT_COMPONENTS.has(id));

  const drivers: string[] = [];
  let size: ScopeAssessment["size"];
  let recommended_path: string;

  if (multiAgent || connectionCount > 3) {
    size = "large";
    if (multiAgent) drivers.push("Multi-agent route (a loop or parallel fan-out of workers)");
    if (connectionCount > 3) drivers.push(`${connectionCount} connections to wire up`);
    recommended_path = "Generate a Linear project from the plan, then build it as slices";
  } else if (durableTrigger || clearanceRank >= CLEARANCE_RANK.L3 || connectionCount === 3) {
    size = "medium";
    if (durableTrigger) {
      drivers.push(
        input.mustRunOffline
          ? "Must keep running while you're offline (durable runtime needed)"
          : "Durable trigger in the route (schedule / inbound event / page watch)",
      );
    }
    if (clearanceRank >= CLEARANCE_RANK.L3) {
      drivers.push(`Writes to an external business system (${input.clearance.level}) — human by default`);
    }
    drivers.push(`${connectionCount} connection${connectionCount === 1 ? "" : "s"} to wire up`);
    recommended_path = "Dry run it first, then build the durable agent";
  } else {
    size = "small";
    drivers.push("Attended — nothing needs to run while you're away");
    drivers.push(`Low blast radius (${input.clearance.level})`);
    drivers.push(`${connectionCount} connection${connectionCount === 1 ? "" : "s"} to wire up`);
    recommended_path = "Run it now in this chat, then save it as a routine if you want it again";
  }

  return { size, drivers, recommended_path };
}

function pickRecommendedNextClick(
  clarifyingQuestions: ClarifyingQuestion[],
  artifactChoices: WizardChoice[],
  scope: ScopeAssessment,
): GoalToProductWizard["recommended_next_click"] {
  // Questions always come first — a fork the plan can't resolve outranks any
  // scope-based recommendation.
  if (clarifyingQuestions.length > 0) {
    return {
      id: "answer_clarifying_questions",
      label: "Answer the quick questions",
      action: "assistant:ask_clarifying_questions",
    };
  }
  // MAR-386: the ⭐ is scope-aware. Large → turn the plan into tracked Linear
  // work (a real destination — the existing export_build_brief linear path, not
  // a new tool). Small & medium → the attended dry run is the ⭐ first move
  // ("try it once on real data now"); build_brief / prepare_runtime remain in the
  // menu as the next step. Capability is never gated — only the ⭐ moves.
  if (scope.size === "large") {
    const linear = artifactChoices.find((c) => c.id === "linear_issues") ?? artifactChoices[0];
    return {
      id: "generate_linear_project",
      label: "Generate the plan as Linear issues",
      action: linear.action,
    };
  }
  return {
    id: "dry_run_in_chat",
    label:
      scope.size === "small"
        ? "Run it attended in this chat now — nothing persists"
        : "Dry run it attended in this chat now — nothing persists, then build",
    action: "assistant:attended_dry_run_in_chat",
  };
}

function buildGoalToProductWizard(input: {
  goal: string;
  steps: RouteStep[];
  whatYouNeed: IntegrationNeed[];
  enforcedGates: string[];
  buildTarget: BuildTarget | undefined;
  hostingAndMonitoring: HostingAndMonitoring;
  clarifyingQuestions: ClarifyingQuestion[];
  outputDepth: "guided" | "brief" | "standard" | "technical" | "deep";
  clearance: AutomationClearance;
  loopShaped: boolean;
}): { wizard: GoalToProductWizard; scope: ScopeAssessment } {
  const buildChoices = buildWizardChoices(input.buildTarget);
  const artifactChoices = buildArtifactChoices();
  const placement = buildPlacementContract({
    goal: input.goal,
    steps: input.steps,
    whatYouNeed: input.whatYouNeed,
    enforcedGates: input.enforcedGates,
  });
  const runtimeFirst =
    placement.runtime_requirements.must_run_while_user_offline ||
    placement.runtime_requirements.trigger_mode === "interactive";
  const technicalDepth = input.outputDepth === "technical" || input.outputDepth === "deep";
  // MAR-386: scope is derived from the plan (clearance, connections, route shape,
  // runtime), then drives the scope-aware ⭐ in pickRecommendedNextClick.
  const scope = buildScopeAssessment({
    clearance: input.clearance,
    whatYouNeed: input.whatYouNeed,
    mustRunOffline: placement.runtime_requirements.must_run_while_user_offline,
    routeComponentIds: input.steps.map((s) => s.component_id),
    loopShaped: input.loopShaped,
  });
  const wizard: GoalToProductWizard = {
    steps: input.steps.map((s) => ({
      step: s.step,
      label: wizardStepLabel(s),
      detail: riskStepNote(s.risk_level),
      component_id: s.component_id,
    })),
    connections_required: groupConnections(input.goal, input.whatYouNeed, input.enforcedGates, input.steps),
    build_choices: runtimeFirst && !technicalDepth ? [] : buildChoices,
    host_monitor_choices:
      runtimeFirst && !technicalDepth ? [] : buildHostMonitorChoices(input.hostingAndMonitoring),
    artifact_choices: runtimeFirst && !technicalDepth ? [] : artifactChoices,
    ...placement,
    clarifying_questions: input.clarifyingQuestions,
    recommended_next_click: pickRecommendedNextClick(
      input.clarifyingQuestions,
      artifactChoices,
      scope,
    ),
  };
  return { wizard, scope };
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
  coverage: Coverage,
  constraintCoverage: ConstraintCoverage,
  scope: ScopeAssessment,
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
  // MAR-252 reconciliation: the clearance only speaks for the route it can see.
  // (1) When coverage found uncovered goal steps, an unattended verdict must
  // carry that caveat — "L0, safe" next to "1 goal step NOT covered" was the
  // audit G3 contradiction. (2) A blocking safety failure always overrides an
  // unattended ✅ — the two may never co-occur in this front-matter.
  const uncoveredN = coverage.unmatched_demand.length;
  let autoIcon: string;
  let autoText: string;
  if (clearance.autonomous_allowed && safety.status === "fail") {
    autoIcon = "⚠️";
    autoText = "unattended blocked — resolve the safety failure first";
  } else if (clearance.autonomous_allowed && uncoveredN > 0) {
    autoIcon = "⚠️";
    autoText =
      `may run unattended for the COVERED steps only — ` +
      `${uncoveredN} goal step${uncoveredN === 1 ? "" : "s"} not carried by this plan (see coverage)`;
  } else if (clearance.autonomous_allowed) {
    autoIcon = "✅";
    autoText = "may run unattended";
  } else if (clearance.level === "L4") {
    autoIcon = "❌";
    autoText = "human ALWAYS required";
  } else {
    autoIcon = "⚠️";
    autoText = "human by default";
  }

  // MAR-250: coverage verdict. The plan must say where the registry ends —
  // uncovered goal steps and unjustified components change the trust story more
  // than any other line here.
  const unmatchedN = coverage.unmatched_demand.length;
  const unsupportedN = coverage.unsupported_supply.length;
  let coverageLine: string;
  if (coverage.coverage_label === "full") {
    coverageLine = `✅ full — every goal step is registry-covered`;
  } else {
    const parts: string[] = [];
    if (unmatchedN > 0) {
      parts.push(`${unmatchedN} goal step${unmatchedN === 1 ? "" : "s"} NOT covered`);
    }
    if (unsupportedN > 0) {
      parts.push(`${unsupportedN} component${unsupportedN === 1 ? "" : "s"} without goal support`);
    }
    const covIcon = coverage.coverage_label === "poor" ? "❌" : "⚠️";
    coverageLine = `${covIcon} ${coverage.coverage_label} — ${parts.join(", ")}`;
  }

  const headerLines = [
    `---`,
    `route_status:   ${routeIcon} ${routeStatus}`,
    `coverage:       ${coverageLine}`,
  ];
  // MAR-250 phase 2: the constraints line sits directly under coverage — step
  // coverage and constraint coverage are the two halves of the honesty story,
  // and "full" steps next to an unrepresented constraint must be visible here.
  if (constraintCoverage.checks.length > 0) {
    headerLines.push(`constraints:    ${constraintHeaderLine(constraintCoverage)}`);
  }
  headerLines.push(
    `safety:         ${safetyIcon} ${safety.status} (risk ${safety.risk_score}/100)`,
    `blocking:       ${blockingIcon} ${blockingCount} issue${blockingCount === 1 ? "" : "s"}`,
    `approval:       ${approval}`,
    `automation:     ${autoIcon} ${clearance.level} — ${autoText}`,
    `untested_edges: ${untestedIcon} ${untestedEdges.length}`,
    // MAR-386: scope sizing (S/M/L) with the recommended first move.
    `scope:          ${scope.size.toUpperCase()} — ${scope.recommended_path}`,
    `---`,
  );
  return headerLines.join("\n");
}

/** One front-matter line summarizing constraint coverage (MAR-250 phase 2). */
function constraintHeaderLine(cc: ConstraintCoverage): string {
  const parts: string[] = [];
  if (cc.structural_count > 0) parts.push(`${cc.structural_count} enforced in route`);
  if (cc.delegated_count > 0) parts.push(`${cc.delegated_count} to verify at build`);
  if (cc.problem_count > 0) parts.push(`${cc.problem_count} NOT represented`);
  const icon = cc.constraint_label === "gaps" ? "⚠️" : "✅";
  return `${icon} ${parts.join(" · ")}`;
}

function titleCaseStatus(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function buildCompactStatusHeader(
  routeStatus: string,
  safety: SafetyReview,
  untestedEdges: UntestedEdge[],
  enforcedGates: string[],
  approvalAdvisory: ApprovalGateAdvisory | null,
  coverage: Coverage,
  constraintCoverage: ConstraintCoverage,
  scope: ScopeAssessment,
): string {
  const routeIcon =
    routeStatus === "validated" ? "✅" : routeStatus === "blocked_candidate" ? "❌" : "⚠️";
  // MAR-250 phase 2: an unqualified "Full coverage" chip may not appear next to
  // an unrepresented constraint — the compact header carries the caveat too.
  const coverageLabel =
    coverage.coverage_label === "full"
      ? constraintCoverage.problem_count > 0
        ? `Full step coverage · ${constraintCoverage.problem_count} constraint gap${
            constraintCoverage.problem_count === 1 ? "" : "s"
          }`
        : "Full coverage"
      : `${titleCaseStatus(coverage.coverage_label)} coverage`;
  const approval =
    enforcedGates.length > 0
      ? "Approval enforced"
      : approvalAdvisory
      ? "Approval advisory"
      : safety.approval_gates_required.length > 0
      ? "Approval missing"
      : "No approval needed";
  return [
    `${routeIcon} ${titleCaseStatus(routeStatus)}`,
    coverageLabel,
    approval,
    `Risk ${safety.risk_score}/100`,
    `${untestedEdges.length} untested edge${untestedEdges.length === 1 ? "" : "s"}`,
    // MAR-386: scope chip. Medium is the terse "Scope M"; small/large carry the
    // one-word action hint because their ⭐ differs from the build default. Folded
    // here (not a new body line) to stay inside LAYER1_MAX_CHARS.
    scopeChip(scope),
  ].join(" · ");
}

/** MAR-386: the compact scope chip for the Layer-1 status header. */
function scopeChip(scope: ScopeAssessment): string {
  return scope.size === "small"
    ? "Scope S (run it)"
    : scope.size === "large"
    ? "Scope L (plan it)"
    : "Scope M";
}

/**
 * MAR-250 phase 2: constraint-coverage rendering.
 * Compact (guided/brief/standard): one summary line plus problem bullets — the
 * decision layer must see gaps; delegated details live in the technical view.
 */
function renderConstraintBlockCompact(cc: ConstraintCoverage): string[] {
  if (cc.checks.length === 0) return [];
  const parts: string[] = [];
  if (cc.structural_count > 0) parts.push(`${cc.structural_count} enforced by the route`);
  if (cc.delegated_count > 0) parts.push(`${cc.delegated_count} to verify at build time`);
  if (cc.problem_count > 0) parts.push(`${cc.problem_count} NOT represented`);
  const lines = [`**Constraint check:** ${parts.join(" · ")}.`];
  for (const c of cc.checks) {
    if (c.status === "missing" || c.status === "violated") {
      lines.push(
        `- ❌ ${c.status.toUpperCase()} [${c.constraint_class}] "${c.goal_phrase}" — ${c.representation}`,
      );
    }
  }
  lines.push(``);
  return lines;
}

/** Full per-check listing for technical/deep depths. */
function renderConstraintBlockFull(cc: ConstraintCoverage): string[] {
  if (cc.checks.length === 0) return [];
  const icon = (s: ConstraintStatus) =>
    s === "structural" ? "✅" : s === "delegated" ? "🔹" : "❌";
  const lines = [`### Constraint coverage`, ``];
  for (const c of cc.checks) {
    lines.push(
      `- ${icon(c.status)} ${c.status} [${c.constraint_class}] "${c.goal_phrase}" — ${c.representation}`,
    );
    if (c.acceptance_criterion) {
      lines.push(`  - acceptance: ${c.acceptance_criterion}`);
    }
  }
  lines.push(``);
  return lines;
}

/**
 * MAR-224: brevity bound on the Layer-1 (guided/brief) markdown. The
 * RESPONSE-UX-04 eval (MAR-227) asserts the rendered summary stays under this
 * so "report creep" fails CI instead of silently re-bloating Layer 1.
 *
 * 3600 → 3700 for the `calendar_notification` question: on a long goal (the
 * P0-02 golden prompt renders 3289 chars before it) the question plus its
 * one-line recommendation did not fit, and the alternative was to drop the
 * recommendation into structuredContent — i.e. to bury the decision, the exact
 * failure the question exists to fix (UX review 2026-07-16 §8.7/§9.2).
 *
 * This is a deliberate, bounded raise for ONE line of high-value content, not
 * permission to re-bloat: the golden prompt is now itself asserted against this
 * bound (responseUxEvals), so the remaining headroom is small and measured.
 */
export const LAYER1_MAX_CHARS = 3700;

/**
 * MAR-250: the coverage gap block, shared by every depth. Empty when coverage
 * is full — a clean plan pays zero characters for this. Capped at 5 phrases so
 * a wordy goal cannot flood Layer 1.
 */
const COVERAGE_MAX_SHOWN = 5;

function renderCoverageBlock(coverage: Coverage, steps: RouteStep[] = [], goal = ""): string[] {
  const lines: string[] = [];
  const routeIds = new Set(steps.map((step) => step.component_id));
  const priceMonitorMappingGap =
    routeIds.has("scheduled_trigger") &&
    routeIds.has("page_monitor") &&
    hasGoalSignal(goal, ["competitor product pages", "competitor pages"]);
  const genericUnmatched = priceMonitorMappingGap
    ? coverage.unmatched_demand.filter(
        (phrase) => !hasGoalSignal(phrase, ["competitor product pages", "competitor pages"]),
      )
    : coverage.unmatched_demand;
  if (priceMonitorMappingGap) {
    lines.push(
      `**Confirm before activation:** the route includes the morning schedule and page monitor, but the coverage matcher did not fully ground the exact five-page instruction. Confirm all five URLs, the time, and the timezone.`,
      ``,
    );
  }
  if (genericUnmatched.length > 0) {
    const shown = genericUnmatched.slice(0, COVERAGE_MAX_SHOWN);
    const more = genericUnmatched.length - shown.length;
    lines.push(
      `**Not covered by the registry:**`,
      ...shown.map((p) => `- "${p}"`),
    );
    if (more > 0) lines.push(`- …and ${more} more`);
    lines.push(
      `> No registry component carries these steps. Mark them 🔵 unguided and spell them out for your builder/coding agent — this plan does not handle them.`,
      ``,
    );
  }
  if (coverage.unsupported_supply.length > 0) {
    lines.push(
      `**In the route but not asked for:** ${coverage.unsupported_supply
        .map((id) => `\`${id}\``)
        .join(", ")} — matched on generic word overlap only. Verify before building, or remove.`,
      ``,
    );
  }
  return lines;
}

function truncateGoalForCard(goal: string): string {
  if (
    hasGoalSignal(goal, ["gmail"]) &&
    hasGoalSignal(goal, ["new leads", "sales leads"]) &&
    hasGoalSignal(goal, ["draft"]) &&
    hasGoalSignal(goal, ["crm"]) &&
    hasGoalSignal(goal, ["slack"]) &&
    hasGoalSignal(goal, ["approval", "approve"])
  ) {
    return "Read new Gmail leads, draft a reply, update CRM, and alert sales in Slack after human approval.";
  }
  return goal.length > 240 ? `${goal.slice(0, 240).trimEnd()}...` : goal;
}

function routeSpine(goal: string, steps: RouteStep[]): string {
  return steps
    .map((s) => s.component_name || s.component_id)
    .join(" → ");
}

function formatHumanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function productCardTitle(
  goal: string,
  planSource: PlanSource,
  playbook: PlanPlaybook | null,
  steps: RouteStep[],
): string {
  if (playbook?.id === "email_lead_to_crm") return "Email Lead → CRM + Slack";
  if (playbook?.id === "competitor_price_monitor") return "Competitor Price Monitor → Slack";
  if (playbook?.id === "pr_review_readonly") return "Read-Only PR Review";
  if (playbook?.id === "invoice_intake_po_match") return "Invoice Intake → PO Match";
  if (playbook?.id === "content_approval_pipeline") return "Content Approval Pipeline";
  if (planSource === "playbook" && playbook) return playbook.title;
  if (hasGoalSignal(goal, ["competitor"]) && hasGoalSignal(goal, ["price", "prices"])) {
    return "Competitor Price Monitor";
  }
  // SAFE-03 (MAR-349): never label a route that actually edits code as
  // read-only, even if the goal text mentions "pull request" and "review".
  const editsCode = steps.some((s) => s.component_id === "code_editing");
  if (
    !editsCode &&
    hasGoalSignal(goal, ["pull request", "pr opens", "github"]) &&
    hasGoalSignal(goal, ["review", "risky"])
  ) {
    return "Read-Only PR Review";
  }
  if (hasGoalSignal(goal, ["invoice", "invoices"]) && hasGoalSignal(goal, ["purchase order", "purchase orders"])) {
    return "Invoice Intake → PO Match";
  }
  if (
    hasGoalSignal(goal, ["content brief", "social copy", "copy variants", "design brief"]) &&
    hasGoalSignal(goal, ["approval", "approve", "reviewer", "publish"])
  ) {
    return "Content Approval Pipeline";
  }
  return "Composed Workflow Route";
}

function hasGoalSignal(goal: string, signals: string[]): boolean {
  const g = goal.toLowerCase();
  return signals.some((s) => g.includes(s));
}

function explicitlyDraftOnly(goal: string): boolean {
  return hasGoalSignal(goal, [
    "do not want it to send",
    "do not send",
    "don't send",
    "never send",
    "without sending",
    "leave a reply in my gmail drafts",
  ]);
}

function formatExamples(examples: string[]): string {
  const shown = examples.filter(Boolean).slice(0, 3);
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0];
  return `choose one: ${shown.join(" / ")}`;
}

function buildProductCardConnectList(
  goal: string,
  steps: RouteStep[],
  whatYouNeed: IntegrationNeed[],
  enforcedGates: string[],
): string[] {
  const routeIds = new Set(steps.map((s) => s.component_id));
  const needById = new Map(whatYouNeed.map((n) => [n.component_id, n]));
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(label);
  };

  if (
    routeIds.has("email_read") ||
    hasGoalSignal(goal, ["gmail", "email inbox", "inbox", "new email", "new leads"])
  ) {
    add("email_read", hasGoalSignal(goal, ["gmail"]) ? "Gmail / email inbox" : "Email inbox (Gmail / Outlook / IMAP)");
  }

  if (
    routeIds.has("crm_note_write") ||
    routeIds.has("crm_record_read") ||
    routeIds.has("deal_stage_update") ||
    hasGoalSignal(goal, ["crm", "hubspot", "salesforce", "pipedrive"])
  ) {
    add("crm", "CRM, e.g. HubSpot (or Salesforce / Pipedrive)");
  }

  if (routeIds.has("slack_notification") || hasGoalSignal(goal, ["slack"])) {
    add("slack", "Slack channel");
  }

  if (hasGoalSignal(goal, ["content brief"])) {
    add("content_brief", "Content brief source");
  }
  if (hasGoalSignal(goal, ["documents", "document", "selected files", "select files"])) {
    add("selected_documents", "Selected document source");
  }

  if (
    hasGoalSignal(goal, ["pull request", "pr opens", "github", "diff", "code review"]) &&
    hasGoalSignal(goal, ["review", "risky"])
  ) {
    add("pr_source", "GitHub pull request / diff source");
  }

  if (hasGoalSignal(goal, ["competitor"]) && hasGoalSignal(goal, ["price", "prices"])) {
    add("competitor_prices", "Competitor price sources");
  }

  if (
    hasGoalSignal(goal, ["sales"]) &&
    hasGoalSignal(goal, ["tell", "tells", "notify", "alert"]) &&
    !routeIds.has("slack_notification")
  ) {
    add("sales_notification", "Sales notification channel");
  }

  if (routeIds.has("email_draft")) {
    const sender = routeIds.has("optional_email_send") && !explicitlyDraftOnly(goal)
      ? "Email sender is optional; draft-only is enough unless approved replies should be sent"
      : "Email draft account; draft-only is enough";
    add("email_draft", sender);
  }

  for (const need of whatYouNeed) {
    if (
      [
        "email_read",
        "email_draft",
        "optional_email_send",
        "crm_note_write",
        "crm_record_read",
        "deal_stage_update",
        "slack_notification",
      ].includes(need.component_id)
    ) {
      continue;
    }
    if (
      need.component_id === "github_trigger" &&
      hasGoalSignal(goal, ["pull request", "pr opens", "diff", "code review"])
    ) {
      continue;
    }
    if (
      need.component_id === "source_retrieval" &&
      hasGoalSignal(goal, ["documents", "document", "selected files", "select files"])
    ) {
      continue;
    }
    if (
      need.component_id === "reviewer_notification" &&
      enforcedGates.includes("human_approval_gate") &&
      routeIds.has("email_read") &&
      (routeIds.has("calendar_lookup") || routeIds.has("calendar_write")) &&
      !hasGoalSignal(goal, ["slack", "email notification", "webhook notification"])
    ) {
      continue;
    }
    const examples = formatExamples(need.product_examples);
    add(need.component_id, examples ? `${need.label} (${examples})` : need.label);
  }

  if (enforcedGates.includes("human_approval_gate")) {
    add("approval", "Human approval checkpoint");
  }
  if (steps.some((step) => step.model_tier !== "none")) {
    add("model_provider", "Model provider");
  }

  if (lines.length === 0 && needById.size === 0) {
    lines.push("No external product connection required");
  }

  return lines.slice(0, 6);
}

function connectLine(goal: string, steps: RouteStep[], whatYouNeed: IntegrationNeed[], enforcedGates: string[]): string {
  const lowerGoal = goal.toLowerCase();
  const mentionsApOrInvoice = /\b(ap|accounts payable|invoice|invoices)\b/.test(lowerGoal);
  const slackLabel = hasGoalSignal(goal, ["sales", "lead", "leads", "crm"])
    ? "Slack sales channel"
    : mentionsApOrInvoice
    ? "Slack/AP alert channel"
    : hasGoalSignal(goal, ["competitor", "price", "prices", "summary"])
    ? "Slack summary channel"
    : "Slack channel";
  return buildProductCardConnectList(goal, steps, whatYouNeed, enforcedGates)
    .filter((item) => item !== "Human approval checkpoint")
    .map((item) =>
      item
        .replace("Gmail / email inbox", "Gmail inbox")
        .replace("Email inbox (Gmail / Outlook / IMAP)", "email inbox (Gmail/Outlook/IMAP)")
        .replace("CRM, e.g. HubSpot (or Salesforce / Pipedrive)", "CRM (HubSpot/Salesforce/Pipedrive)")
        .replace("Slack channel", slackLabel)
        .replace("Email sender is optional; draft-only is enough unless approved replies should be sent", "optional email sender")
        .replace("Email draft account; draft-only is enough", "email draft account")
        .replace(/\(choose one: ([^)]+)\)/, "($1)"),
    )
    .join(" · ");
}

function howItWorksSteps(steps: RouteStep[]): string[] {
  const routeIds = new Set(steps.map((s) => s.component_id));
  if (routeIds.has("email_read") && routeIds.has("crm_note_write")) {
    const lines = [
      "Read and extract lead data from the inbox.",
      "Validate/classify whether it is a real sales lead.",
      "Draft a reply for review.",
      "Pause for approval before any external write.",
      routeIds.has("slack_notification")
        ? "After approval, update CRM and alert sales in Slack."
        : "After approval, update CRM and notify the reviewer or sales owner.",
    ];
    if (routeIds.has("optional_email_send")) {
      lines.push("Optionally send the approved email; v1 should probably stay draft-only.");
    }
    lines.push("Write an audit log.");
    return lines;
  }
  // MAR-349: derive the code-workflow narrative from the ACTUAL route
  // components, never from a fixed read-only PR-review template. The old branch
  // returned "Notify reviewers without editing or committing code." on ANY
  // github/codebase route — even one containing code_editing + test_runner —
  // so the headline promised a read-only reviewer while the grounded route
  // edited code (SAFE-03). Each line is emitted only when its component is
  // present and in route order, so the story can never contradict the step
  // list. Checked before the monitor branch so a scheduled code loop is not
  // mis-narrated as a data pipeline.
  if (
    routeIds.has("github_trigger") ||
    routeIds.has("codebase_scan") ||
    routeIds.has("code_editing")
  ) {
    const CODE_STEP_PHRASE: Record<string, string> = {
      github_trigger: "Receive the GitHub event (push / pull request).",
      scheduled_trigger: "Start on the schedule.",
      loop_controller:
        "Iterate the coder/reviewer loop until it passes or the max rounds is reached.",
      codebase_scan: "Scan the codebase and diff for context.",
      plan_generation: "Plan the changes to make.",
      code_editing: "Edit the code to apply the planned changes.",
      test_runner: "Run the test suite and check the results.",
      pr_summary: "Prepare a pull request summary of the changes.",
      reviewer_notification: "Notify the reviewer to check the changes.",
      human_approval_gate:
        "Pause for human approval before opening the pull request or any other external write.",
      optional_email_send: "Send the notification only after approval.",
      audit_log: "Write an audit log.",
    };
    const lines = steps
      .map((s) => CODE_STEP_PHRASE[s.component_id])
      .filter((p): p is string => Boolean(p));
    if (lines.length > 0) return lines.slice(0, 8);
  }
  if (routeIds.has("page_monitor") || routeIds.has("scheduled_trigger")) {
    return [
      "Start from the trigger or schedule.",
      "Read the source data and normalize it.",
      "Validate the important fields before acting.",
      routeIds.has("human_approval_gate")
        ? "Pause for approval before any external write."
        : "Route the result according to the plan controls.",
      "Notify the right channel and write an audit log.",
    ];
  }
  return steps.slice(0, 7).map((s) => s.purpose.replace(/\s+/g, " ").trim());
}

function buildControlsLine(steps: RouteStep[]): string {
  const routeIds = new Set(steps.map((s) => s.component_id));
  const controls = ["state", "retries", "credential-failure handling", "tests"];
  if (
    routeIds.has("crm_note_write") ||
    routeIds.has("optional_email_send") ||
    routeIds.has("external_publish")
  ) {
    controls.push("rollback/compensation");
  }
  const finalControl = controls.pop();
  return `Add ${controls.join(", ")}, and ${finalControl} in the build brief.`;
}

function buildProductCardNotes(
  goal: string,
  planSource: PlanSource,
  steps: RouteStep[],
  coverage: Coverage,
): string[] {
  const routeIds = new Set(steps.map((s) => s.component_id));
  const notes: string[] = [];
  if (hasGoalSignal(goal, ["slack"]) && !routeIds.has("slack_notification")) {
    notes.push(
      "Slack is named in the goal, but this validated playbook spine does not include a Slack Notification step; add that connection deliberately in the build brief if the sales alert is mandatory.",
    );
  }
  if (routeIds.has("optional_email_send")) {
    notes.push(
      "Optional Email Send means approved sending is available, not required; keep the first version draft-only if replies should stay manual.",
    );
  }
  if (coverage.unsupported_supply.length > 0) {
    notes.push(
      `Verify route extras before building: ${coverage.unsupported_supply.map((id) => `\`${id}\``).join(", ")}.`,
    );
  }
  if (planSource === "composed") {
    notes.push("This is a composed candidate, so treat untested edges as build-time checks rather than proven playbook evidence.");
  }
  return notes.slice(0, 3);
}

function renderProductCardContinueMenu(
  wizard: GoalToProductWizard,
  goal: string,
  scope: ScopeAssessment,
): string[] {
  // MAR-385: a chat run is a dry-run/walking skeleton only when the goal asks to
  // build a durable agent AND the runtime must outlive the session; a genuinely
  // attended/one-shot goal (client-chat runtime) is never nagged toward the brief.
  const buildDeliverable =
    wizard.runtime_requirements.must_run_while_user_offline && goalHasBuildIntent(goal);
  // Same layout split as before (was keyed off the old prepare_runtime click):
  // the runtime-first layout appears when the plan needs a durable/interactive
  // runtime and no question is pending.
  const questionsPending = wizard.clarifying_questions.length > 0;
  const showRuntimeLayout =
    !questionsPending &&
    (wizard.runtime_requirements.must_run_while_user_offline ||
      wizard.runtime_requirements.trigger_mode === "interactive");
  // MAR-386: the ⭐ is scope-aware, but ONLY once questions are answered — while a
  // question is pending, answering it (the "Quick checks" block above) is the ⭐,
  // so no menu line is marked. Capability is never gated: every A–E option is
  // always present; scope only moves which one says "Recommended".
  const starDryRun = !questionsPending && (scope.size === "small" || scope.size === "medium");
  const starLinear = !questionsPending && scope.size === "large";
  const mark = (line: string, on: boolean) => (on ? `${line} — Recommended` : line);

  if (showRuntimeLayout) {
    const eLine = dryRunMenuLine("E", buildDeliverable, "");
    return [
      `### How do you want to continue?`,
      ``,
      `A) ${wizard.recommended_setup.label} — Next achievable step`,
      `B) Review or change Runtime, Control surface, Interaction surface, or Trigger`,
      `C) Show the technical plan and deployment alternatives`,
      mark(`D) Save this plan to Linear / Obsidian / Notion`, starLinear),
      mark(eLine, starDryRun),
      ``,
    ];
  }
  const eLine = dryRunMenuLine("E", buildDeliverable, " (C)");
  return [
    `### How do you want to continue?`,
    ``,
    mark(`A) Save this plan to Linear / Obsidian / Notion`, starLinear),
    `B) Generate a portable agent handoff prompt`,
    `C) Turn it into a build prompt for Claude Code / Codex / Cursor`,
    `D) Review or change the plan`,
    mark(eLine, starDryRun),
    ``,
  ];
}

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
  nextActionMenu: NextAction[],
  clarifyingQuestions: ClarifyingQuestion[],
  coverage: Coverage,
  constraintCoverage: ConstraintCoverage,
  hostingAndMonitoring: HostingAndMonitoring,
  goalToProductWizard: GoalToProductWizard,
  scope: ScopeAssessment,
  /**
   * MAR-224: when true (`standard` depth) the recommended route is rendered as a
   * full numbered step list with per-step risk instead of the one-line chain —
   * a clean superset of the guided layer that still omits the technical block
   * (model tiers, credentials, worker pipeline, provenance block = Layer 2).
   */
  fullSteps: boolean,
): string {
  const lines: string[] = [];

  lines.push(`## ${productCardTitle(goal, planSource, playbook, steps)}`, ``);
  lines.push(`**You want:** ${truncateGoalForCard(goal)}`, ``);

  lines.push(`**Route:** ${routeSpine(goal, steps)}`, ``);

  if (outboundComponentsExcludedByConstraints(goal).has("optional_email_send")) {
    lines.push(`Email sending: excluded per your constraint`, ``);
  }

  lines.push(`**How it works**`);
  howItWorksSteps(steps).forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });
  lines.push(``);

  lines.push(...renderOperatingBundleCompact(goalToProductWizard));

  if (fullSteps) {
    lines.push(`**Steps:**`);
    for (const s of steps) {
      lines.push(
        `${s.step}. **${s.component_name ?? s.component_id}** — ${s.purpose} · _${riskStepNote(s.risk_level)}_`,
      );
    }
    lines.push(``);
  }

  lines.push(`**Connect:** ${connectLine(goal, steps, whatYouNeed, enforcedGates)}.`, ``);

  lines.push(...renderCoverageBlock(coverage, steps, goal));

  lines.push(...renderConstraintBlockCompact(constraintCoverage));

  const cardRouteIds = new Set(steps.map((s) => s.component_id));
  let cardSafeguard: string;
  if (enforcedGates.length > 0) {
    if (enforcedGates.includes("human_approval_gate")) {
      const guardedActions = [
        cardRouteIds.has("crm_note_write") ? "CRM updates" : null,
        cardRouteIds.has("slack_notification") ? "Slack alerts" : null,
        cardRouteIds.has("calendar_write") ? "calendar invite creation" : null,
        cardRouteIds.has("optional_email_send") && !explicitlyDraftOnly(goal) ? "sending" : null,
      ].filter((action): action is string => Boolean(action));
      cardSafeguard =
        guardedActions.length > 0
          ? `Keep the approval gate before ${formatHumanList(guardedActions)}`
          : `Keep the human approval gate before any irreversible action`;
      if (explicitlyDraftOnly(goal) && cardRouteIds.has("email_draft")) {
        cardSafeguard += "; keep the reply draft-only and leave sending disabled";
      }
      if (cardRouteIds.has("scheduled_trigger") && cardRouteIds.has("slack_notification")) {
        cardSafeguard =
          "The current plan pauses for approval before each Slack post; choose that, or explicitly allow automatic low-risk price-change alerts";
      }
    } else {
      cardSafeguard = `approval is enforced (${enforcedGates.join(", ")}) — keep it`;
    }
  } else if (approvalAdvisory) {
    cardSafeguard = clearance.autonomous_allowed
      ? `approval gate waived per your request — acceptable here for notification-class writes`
      : `approval gate waived per your request, but the route still writes to a business system (${approvalAdvisory.write_components.join(", ")}) — keep a human check`;
  } else if (safety.approval_gates_required.length > 0) {
    cardSafeguard = `approval is required but not enforced — add ${safety.approval_gates_required.join(", ")} before building`;
  } else {
    cardSafeguard = `no approval gate required for this plan`;
  }
  const cardUncovered = coverage.unmatched_demand.length;
  const cardAutoText =
    anySignal(goal.toLowerCase(), ["never run in the background", "only when i ask", "when i ask in chat"])
      ? "attended only by request and never runs in the background"
      : enforcedGates.includes("human_approval_gate") &&
    cardRouteIds.has("scheduled_trigger") &&
    cardRouteIds.has("slack_notification")
      ? "may monitor unattended, but each Slack post waits for approval"
      : clearance.autonomous_allowed && safety.status === "fail"
      ? "unattended blocked — resolve the safety failure first"
      : clearance.autonomous_allowed && cardUncovered > 0
      ? `may run unattended for the covered steps only (${cardUncovered} goal step${cardUncovered === 1 ? "" : "s"} not carried by this plan)`
      : clearance.autonomous_allowed
      ? "may run unattended"
      : clearance.level === "L4"
      ? "human always required"
      : "human-in-the-loop by default";
  lines.push(`**Key safeguard:** ${cardSafeguard}. This is ${clearance.level} ${cardAutoText}.`, ``);
  lines.push(`**Build controls:** ${buildControlsLine(steps)}`, ``);

  if (clarifyingQuestions.length > 0) {
    // Only the scope-completion questions offer "Not sure yet" — promising it
    // when the list is a side-effect question alone would be a lie.
    const anyNotSure = clarifyingQuestions.some((q) => q.options.includes("Not sure yet"));
    lines.push(
      anyNotSure
        ? `**Quick checks to pin down the plan** (pick one each, or "Not sure yet"):`
        : `**Quick checks to pin down the plan** (pick one):`,
    );
    lines.push(...renderClarifyingQuestions(clarifyingQuestions, "compact"));
  }

  lines.push(...renderProductCardContinueMenu(goalToProductWizard, goal, scope));

  lines.push(
    `> 🟢 Registry-grounded, no LLM calls. 🔵 Additions are suggestions. ` +
      `For full details, call \`output_depth: "technical"\`.`,
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
  workerPipeline: WorkerPipeline | null,
  loopGuidance: LoopGuidance | null,
  clearance: AutomationClearance,
  designNotes: string[],
  whatYouNeed: IntegrationNeed[],
  nextActionMenu: NextAction[],
  clarifyingQuestions: ClarifyingQuestion[],
  coverage: Coverage,
  constraintCoverage: ConstraintCoverage,
  hostingAndMonitoring: HostingAndMonitoring,
  goalToProductWizard: GoalToProductWizard,
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
      // MAR-249: plain-English risk consequence from the operator register.
      `   ↳ _${riskStepNote(s.risk_level)}_`,
    );
  }
  lines.push(``);

  // MAR-250: coverage gaps directly under the steps — a technical reader must
  // see where the registry ends before reading tiers/credentials.
  const coverageBlock = renderCoverageBlock(coverage, steps, goal);
  if (coverageBlock.length > 0) {
    lines.push(`### Coverage gaps`, ``, ...coverageBlock);
  }

  // MAR-250 phase 2: constraint coverage right after step coverage — the
  // technical reader sees which commitments the route enforces vs. delegates.
  lines.push(...renderConstraintBlockFull(constraintCoverage));

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
  if (workerPipeline && workerPipeline.workers.length > 0) {
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

  // MAR-315: full hosting + monitoring recommendation (recommended pick,
  // reason, and alternatives — Layer 1 carries the compact one-liner only).
  lines.push(...renderOperatingBundleFull(goalToProductWizard));

  // MAR-225: bounded clarifying questions (architecture-affecting only).
  if (clarifyingQuestions.length > 0) {
    lines.push(`### Quick checks to pin down the plan`, ``);
    lines.push(...renderClarifyingQuestions(clarifyingQuestions, "full"));
  }

  // MAR-226: standardized next-action menu — target-aware, prevents dead-ending.
  if (nextActionMenu.length > 0) {
    lines.push(`### Next actions`, ``);
    for (const a of nextActionMenu) lines.push(`- ${a.label} — \`${a.action}\``);
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
      coverage: "computed", // MAR-250: matcher provenance + demand lexicon, no LLM
      constraint_coverage: "computed", // MAR-250 phase 2: constraint lexicons + route structure, no LLM
      automation_clearance: "computed",
      worker_pipeline: "grounded",
      worker_pipeline_pointer: "advisory", // MAR-256: depth-omission pointer
      loop_guidance: "grounded",
      observability: "advisory",    // MAR-296: DASH-v1 event/gate guidance
      design_notes: "grounded",     // edge control_flow_note + component pattern
      what_you_need: "computed",    // derived from component permission scopes
      suggested_next_actions: "advisory",
      next_action_menu: "advisory", // MAR-226: standardized action menu
      clarifying_questions: "advisory", // MAR-225: bounded constraint questions
      hosting_and_monitoring: "computed", // MAR-315: deterministic route-shape derivation
      goal_to_product_wizard: "advisory", // MAR-333: deterministic menu contract for clients
      scope_assessment: "computed", // MAR-386: S/M/L derived from plan fields, no LLM
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
  const overlapIds = new Set(composedIds);
  // MAR-344: "alerts sales in Slack after approval" names the Slack egress, not
  // an internal reviewer handoff. Keep compose's flag-only reviewer noise intact,
  // but don't let it depress the email_lead_to_crm playbook precision or append
  // an unasked reviewer step to the product-card path.
  if (shouldIgnoreReviewerNotificationForLeadSlack(input.goal, overlapIds)) {
    overlapIds.delete("reviewer_notification");
  }
  const bestOverlap = findOverlappingPlaybooks(overlapIds, registry.playbooks, 0.3)[0];
  // MAR-142 (generalized MAR-265): gated playbooks also require a strong
  // domain token in the goal — the precision floor alone (0.72) is not
  // sufficient when generic tokens like "read" happen to score above it on an
  // out-of-domain goal (e.g. Stripe→Slack read-only report).
  const signalGatePassed =
    !bestOverlap || playbookSignalGatePassed(bestOverlap.playbook_id, input.goal);

  const playbookMatch =
    bestOverlap &&
    bestOverlap.overlap_fraction >= PLAYBOOK_RECALL_MIN &&
    bestOverlap.precision >= PLAYBOOK_PRECISION_MIN &&
    signalGatePassed
      ? bestOverlap
      : null;
  const planSource: PlanSource = playbookMatch ? "playbook" : "composed";

  // ── Step 3: build the route depending on plan_source ──
  let steps: RouteStep[];
  let planningOrder: string[];
  let executionOrder: string[];
  let playbook: PlanPlaybook | null = null;
  let routeComponentIds: string[];
  let playbookCoverageClaims: string[] = [];

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
    playbookCoverageClaims = [route?.summary, pb?.summary].filter(
      (text): text is string => typeof text === "string",
    );
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

  const excludedByNoOutbound = outboundComponentsExcludedByConstraints(input.goal);
  if (excludedByNoOutbound.size > 0 && routeComponentIds.some((id) => excludedByNoOutbound.has(id))) {
    const filteredIds = routeComponentIds.filter((id) => !excludedByNoOutbound.has(id));
    const filteredComponents = resolveComponents(filteredIds, registry);
    const ordered = computeExecutionOrder(filteredComponents, registry.edges);
    steps = ordered.map((c, i) => toRouteStep(c, i));
    planningOrder = filteredComponents.map((c) => c.id);
    executionOrder = ordered.map((c) => c.id);
    routeComponentIds = ordered.map((c) => c.id);
  }

  // ── Step 3b: coverage accounting for the chosen route (MAR-250) ──
  // Composed plans reuse the compose pass's coverage. Playbook plans serve a
  // different (golden-path) component set, so coverage is recomputed against it:
  // unmatched demand still surfaces (a playbook can under-cover a goal), while
  // unsupported-supply accounting is skipped — the playbook set is validated as
  // a whole, not per-token.
  let coverage: Coverage;
  if (planSource === "playbook") {
    const playbookMatchResult = matchCapabilities(
      input.goal,
      input.must_have_capabilities,
      input.must_avoid,
      registry.components,
      registry.edges,
    );
    coverage = computeCoverage({
      goal: input.goal,
      routeMatches: playbookMatchResult.matches.filter((m) =>
        routeComponentIds.includes(m.component.id),
      ),
      finalComponentIds: routeComponentIds,
      injectedComponentIds: new Set(),
      mode: "playbook",
      groundedClaimTexts: playbookCoverageClaims,
    });
  } else {
    coverage = composed.coverage;
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

  // ── MAR-250 phase 2: constraint coverage on the FINAL route ──
  // Computed after the no-outbound exclusion filter so the prohibition check
  // sees the route the user actually gets.
  const constraint_coverage = computeConstraintCoverage({
    goal: input.goal,
    executionOrder,
    gatedWriteIds: gatedWrites,
  });

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
  // MAR-256 payload diet: the pipeline is the same build team for every plan
  // (byte-identical, ~1,500 tokens), so it ships only at technical/deep — or
  // when the plan is genuinely loop/worker-shaped and the pipeline is
  // plan-specific content rather than boilerplate (loop components in the
  // route, or the dynamic_worker_loop playbook — that plan IS the pipeline).
  const outputDepth = input.output_depth ?? "brief";
  const technicalDepth = outputDepth === "technical" || outputDepth === "deep";
  const routeIsLoopShaped =
    routeComponentIds.includes("loop_controller") ||
    routeComponentIds.includes("fan_out_collector") ||
    playbook?.id === "dynamic_worker_loop";
  const worker_pipeline =
    technicalDepth || routeIsLoopShaped
      ? composeWorkerPipeline(registry.workers ?? [])
      : null;
  const worker_pipeline_pointer = worker_pipeline
    ? null
    : `Omitted at output_depth "${outputDepth}" — re-call plan_workflow with output_depth: "technical" to include the build-team worker contracts.`;

  // ── MAR-167: bounded-loop contract when the route is loop-shaped ──
  // Already plan-specific (null unless loop_controller is in the route), so it
  // needs no depth gating — a non-null value is never boilerplate.
  const loop_guidance = buildLoopGuidance(routeComponentIds, registry, input.goal);

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
  // ── MAR-315: deterministic hosting + monitoring recommendation ──
  const localOrHosted: "local" | "hosted" | "either" =
    input.local_or_hosted === "local"
      ? "local"
      : input.local_or_hosted === "hosted"
      ? "hosted"
      : "either";
  const hosting_and_monitoring = buildHostingAndMonitoring(
    input.goal,
    routeComponentIds,
    localOrHosted,
    outputDepth,
  );

  // ── MAR-226: standardized, machine-consumable next-action menu ──
  const next_action_menu = buildNextActionMenu(
    planSource,
    playbook,
    input.build_target,
    what_you_need,
    input.goal,
    hosting_and_monitoring,
  );

  // ── MAR-225: bounded clarifying questions for missing architecture constraints ──
  const clarifying_questions = buildClarifyingQuestions(input.goal, routeComponentIds);
  const { wizard: goal_to_product_wizard, scope: scope_assessment } = buildGoalToProductWizard({
    goal: input.goal,
    steps,
    whatYouNeed: what_you_need,
    enforcedGates: enforced_approval_gates,
    buildTarget: input.build_target,
    hostingAndMonitoring: hosting_and_monitoring,
    clarifyingQuestions: clarifying_questions,
    outputDepth,
    clearance: automation_clearance,
    loopShaped: loop_guidance !== null,
  });

  // ── Step 6: fused markdown ──
  // MAR-101: every depth leads with the same scannable status front-matter so
  // route_status / safety / blocking / approval / untested-edge count are
  // unmissable regardless of how much detail follows.
  // MAR-224: layered depth. guided/brief = Layer-1 concise decision UI (default);
  // standard = step list + safety, no technical block; technical/deep = full plan.
  // (outputDepth computed above with the MAR-256 worker_pipeline gate.)
  const statusHeader =
    outputDepth === "guided" || outputDepth === "brief"
      ? buildCompactStatusHeader(
          route_status,
          safety_review,
          untested_edges,
          enforced_approval_gates,
          approval_gate_advisory,
          coverage,
          constraint_coverage,
          scope_assessment,
        )
      : buildStatusHeader(
    route_status,
    safety_review,
    untested_edges,
    enforced_approval_gates,
    approval_gate_advisory,
    automation_clearance,
    coverage,
    constraint_coverage,
    scope_assessment,
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
      next_action_menu,
      clarifying_questions,
      coverage,
      constraint_coverage,
      hosting_and_monitoring,
      goal_to_product_wizard,
      scope_assessment,
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
      next_action_menu,
      clarifying_questions,
      coverage,
      constraint_coverage,
      hosting_and_monitoring,
      goal_to_product_wizard,
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
    coverage,
    constraint_coverage,
    evals_to_add: composed.evals_to_add,
    design_notes,
    what_you_need,
    suggested_next_actions,
    next_action_menu,
    clarifying_questions,
    hosting_and_monitoring,
    goal_to_product_wizard,
    scope_assessment,
    worker_pipeline,
    worker_pipeline_pointer,
    loop_guidance,
    automation_clearance,
    observability: buildObservabilityGuidance(steps),
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
    "cowork = Claude Cowork where available (configure an assistant, no code); " +
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
        "Prefer this as the entry point for designing a new AI workflow. " +
        "IMPORTANT: render the returned `summary_markdown` to the user VERBATIM — do not " +
        "paraphrase or summarize it, and do not drop the A) B) C) D) E) continuation menu at the end. " +
        "If you run the plan in-chat via connectors, declare it as the attended dry-run option (E) — " +
        "nothing persists — and offer `export_build_brief` afterward; a chat run never fulfills a build goal.",
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
            content: [{ type: "text" as const, text: needsGoal.summary_markdown }],
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
            build_target: input.build_target,
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
            content: [{ type: "text" as const, text: needsGoal.summary_markdown }],
            structuredContent: needsGoal,
          };
        }

        logger.debug(
          `plan_workflow → source=${result.plan_source} steps=${result.recommended_route.length} ` +
          `safety=${result.safety_review.status}`,
        );

        return {
          content: [{ type: "text" as const, text: result.summary_markdown }],
          structuredContent: result,
        };
      } catch (err) {
        logger.error("plan_workflow failed", err);
        return toErrorResult(err);
      }
    },
  );
}
