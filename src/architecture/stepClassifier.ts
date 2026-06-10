import type { Component } from "../registry/componentSchema.js";

// ---------------------------------------------------------------------------
// LLM-driven capability detection tokens (substring match against capabilities)
// ---------------------------------------------------------------------------

const LLM_TOKENS = [
  "generat",
  "draft",
  "summariz",
  "synthesiz",
  "classif",
  "rank",
  "plan",
  "interpret",
  "extract structured",
  "embed",
  "semantic",
  "intent",
  "reason",
  "evaluat",
];

const DETERMINISTIC_TOKENS = [
  "scrape",
  "fetch",
  "validat",
  "dedup",
  "normaliz",
  "format",
  "store",
  "queue",
  "monitor",
  "hash",
  "check",
  "retry",
  "count",
  "parse",
  "read email",
  "ingest",
  "run test",
  "execute",
];

function isLlmDriven(component: Component): boolean {
  // Category heuristic
  if (component.category === "orchestration") return true;

  // Capability token matching
  const caps = component.capabilities.join(" ").toLowerCase();
  return LLM_TOKENS.some((t) => caps.includes(t));
}

function isDeterministic(component: Component): boolean {
  if (
    component.category === "eval" ||
    component.category === "state" ||
    component.category === "safety"
  )
    return true;

  const caps = component.capabilities.join(" ").toLowerCase();
  return DETERMINISTIC_TOKENS.some((t) => caps.includes(t));
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type StepClassification = {
  llm_driven_steps: string[];
  deterministic_steps: string[];
  state_components: string[];
  tool_components: string[];
  approval_gate_components: string[];
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a set of component IDs into LLM-driven steps, deterministic steps,
 * state/storage components, tool integrations and approval gates.
 *
 * When a playbook is available, its `llm_driven_steps` and `deterministic_steps`
 * override the heuristic for component IDs that appear in both lists.
 */
export function classifySteps(
  componentIds: string[],
  allComponents: Component[],
  playbookHints?: {
    llm_driven_steps?: string[];
    deterministic_steps?: string[];
  },
): StepClassification {
  const llmSet = new Set(
    (playbookHints?.llm_driven_steps ?? []).map((s) => s.toLowerCase()),
  );
  const detSet = new Set(
    (playbookHints?.deterministic_steps ?? []).map((s) => s.toLowerCase()),
  );

  const llm: string[] = [];
  const deterministic: string[] = [];
  const state: string[] = [];
  const tools: string[] = [];
  const approvalGates: string[] = [];

  for (const cid of componentIds) {
    const comp = allComponents.find((c) => c.id === cid);
    if (!comp) continue;

    // Playbook hints override heuristics when the component id appears in them
    const inLlmHint = llmSet.has(cid) || llmSet.has(comp.name.toLowerCase());
    const inDetHint = detSet.has(cid) || detSet.has(comp.name.toLowerCase());

    if (comp.category === "safety" || cid === "human_approval_gate") {
      approvalGates.push(cid);
      deterministic.push(cid);
      continue;
    }

    if (comp.category === "state") {
      state.push(cid);
      deterministic.push(cid);
      continue;
    }

    if (comp.category === "tool" || comp.category === "integration") {
      tools.push(cid);
    }

    if (inLlmHint || (!inDetHint && isLlmDriven(comp))) {
      llm.push(cid);
    } else if (inDetHint || isDeterministic(comp)) {
      deterministic.push(cid);
    } else {
      // Fallback: if the component is not clearly LLM-driven, default to deterministic
      deterministic.push(cid);
    }
  }

  return {
    llm_driven_steps: llm,
    deterministic_steps: [...new Set(deterministic)],
    state_components: state,
    tool_components: tools,
    approval_gate_components: approvalGates,
  };
}

/**
 * Describes storage needs based on state components.
 */
export function describeStateNeeds(
  stateComponents: string[],
  localOrHosted: "local" | "hosted" | "either" = "either",
): { components: string[]; needs: string[]; recommendation: string } {
  const needs: string[] = [];

  if (stateComponents.length === 0) {
    return {
      components: [],
      needs: ["No persistent state required — ephemeral in-memory execution is sufficient."],
      recommendation: "No state store needed for this workflow.",
    };
  }

  if (stateComponents.includes("state_store")) {
    const rec =
      localOrHosted === "hosted"
        ? "Supabase / Postgres with row-level security"
        : "SQLite (zero-config, file-based, sufficient for local MVP)";
    needs.push(`State persistence required → ${rec}`);
  }

  if (stateComponents.includes("audit_log")) {
    needs.push("Audit trail required → structured JSON log to stderr (upgrade to Pino when shipping)");
  }

  if (stateComponents.includes("job_queue")) {
    const rec =
      localOrHosted === "hosted"
        ? "BullMQ with Redis for durable retries and scheduling"
        : "Inline async execution (add BullMQ when you need durable retries or fan-out)";
    needs.push(`Job queue required → ${rec}`);
  }

  const recommendation =
    localOrHosted === "hosted"
      ? "Hosted storage: SQLite → Supabase/Postgres before launch."
      : "Local storage: SQLite zero-config, switch when you have real concurrency needs.";

  return { components: stateComponents, needs, recommendation };
}
