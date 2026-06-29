/**
 * MAR-107 — Edge validation fixtures
 *
 * One describe block per tested edge. Each block name is the edge ID so that
 * test_refs in the YAML files map directly to this file.
 */
import { describe, it, expect } from "vitest";
import { augmentWithSafety } from "../../src/graph/safetyAugmenter.js";
import {
  computeExecutionOrder,
  detectAvoidViolations,
} from "../../src/graph/routeOrdering.js";
import { composeRoute } from "../../src/graph/routeComposer.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();
const { components, edges } = registry;

function pick(ids: string[]) {
  return ids.map((id) => {
    const c = components.find((c) => c.id === id);
    if (!c) throw new Error(`Component not found in registry: ${id}`);
    return c;
  });
}

// ── requires: human_approval_gate (critical) ───────────────────────────────

describe("edge: external_publish__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when external_publish is present", () => {
    const result = augmentWithSafety(pick(["external_publish"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });

  it("gate is not duplicated when already present in the selected set", () => {
    const result = augmentWithSafety(
      pick(["external_publish", "human_approval_gate"]),
      edges,
      components,
    );
    const gateCount = result.components.filter((c) => c.id === "human_approval_gate").length;
    expect(gateCount).toBe(1);
  });
});

describe("edge: optional_email_send__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when optional_email_send is present", () => {
    const result = augmentWithSafety(pick(["optional_email_send"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

describe("edge: crm_note_write__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when crm_note_write is present", () => {
    const result = augmentWithSafety(pick(["crm_note_write"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

describe("edge: calendar_write__requires__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when calendar_write is present", () => {
    const result = augmentWithSafety(pick(["calendar_write"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

// ── avoid_when (critical) ──────────────────────────────────────────────────

describe("edge: data_scraper__avoid__external_publish", () => {
  it("detectAvoidViolations flags a critical violation when both endpoints are selected", () => {
    const violations = detectAvoidViolations(
      new Set(["data_scraper", "external_publish"]),
      edges,
    );
    const v = violations.find(
      (v) => v.from === "data_scraper" && v.to === "external_publish",
    );
    expect(v).toBeDefined();
    expect(v!.severity).toBe("critical");
  });

  it("no violation when external_publish is absent from the route", () => {
    const violations = detectAvoidViolations(
      new Set(["data_scraper", "data_normalizer", "schema_validation"]),
      edges,
    );
    const v = violations.find(
      (v) => v.from === "data_scraper" && v.to === "external_publish",
    );
    expect(v).toBeUndefined();
  });
});

// ── requires: citation_checker (high) ─────────────────────────────────────

describe("edge: research_synthesis__requires__citation_checker", () => {
  it("edge is present in registry with relation requires and severity high", () => {
    const edge = edges.find((e) => e.id === "research_synthesis__requires__citation_checker");
    expect(edge).toBeDefined();
    expect(edge!.relation).toBe("requires");
    expect(edge!.severity).toBe("high");
  });

  it("composeRoute for a research + citations goal includes citation_checker", () => {
    const result = composeRoute(
      {
        goal: "research a topic and synthesise findings with verified citations",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("citation_checker");
  });
});

// ── must_run_before (high) ─────────────────────────────────────────────────

describe("edge: schema_validation__before__external_publish", () => {
  it("computeExecutionOrder places schema_validation before external_publish", () => {
    const ordered = computeExecutionOrder(
      pick(["external_publish", "schema_validation", "human_approval_gate"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("schema_validation")).toBeLessThan(ids.indexOf("external_publish"));
  });
});

describe("edge: code_editing__before__test_runner", () => {
  it("computeExecutionOrder places code_editing before test_runner", () => {
    const ordered = computeExecutionOrder(
      pick(["test_runner", "code_editing", "codebase_scan"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("code_editing")).toBeLessThan(ids.indexOf("test_runner"));
  });
});

describe("edge: codebase_scan__before__code_editing", () => {
  it("computeExecutionOrder places codebase_scan before code_editing", () => {
    const ordered = computeExecutionOrder(
      pick(["code_editing", "codebase_scan", "test_runner"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("codebase_scan")).toBeLessThan(ids.indexOf("code_editing"));
  });
});

// ── produces_input_for (high) ──────────────────────────────────────────────

describe("edge: plan_generation__produces__code_editing", () => {
  it("computeExecutionOrder places plan_generation before code_editing", () => {
    const ordered = computeExecutionOrder(
      pick(["code_editing", "plan_generation", "codebase_scan", "test_runner"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("plan_generation")).toBeLessThan(ids.indexOf("code_editing"));
  });
});

describe("edge: source_retrieval__produces__source_ranking", () => {
  it("computeExecutionOrder places source_retrieval before source_ranking", () => {
    const ordered = computeExecutionOrder(
      pick(["source_ranking", "source_retrieval", "research_synthesis"]),
      edges,
    );
    const ids = ordered.map((c) => c.id);
    expect(ids.indexOf("source_retrieval")).toBeLessThan(ids.indexOf("source_ranking"));
  });
});

// ── safer_with (high) ─────────────────────────────────────────────────────

describe("edge: copy_generation__safer_with__human_approval_gate", () => {
  it("augmentWithSafety injects human_approval_gate when copy_generation is present", () => {
    const result = augmentWithSafety(pick(["copy_generation"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MAR-164 — edge-validation sprint: 20 priority untested edges → tested:true.
// Assertions are behavioral (the augmenter / execution-orderer / composer
// actually enacts the edge), not "edge exists". Most are matcher-independent
// (augmentWithSafety / computeExecutionOrder on a fixed component set) so they
// stay green as the matcher evolves; the two `requires` cases use composeRoute
// with goals whose `to` component can ONLY arrive via the requires edge.
// ═══════════════════════════════════════════════════════════════════════════

/** safer_with → auth_failure_handler: present component pulls a credential-failure path. */
const AUTH_HANDLER_EDGES: Array<[string, string]> = [
  ["external_publish__safer_with__auth_failure_handler", "external_publish"],
  ["optional_email_send__safer_with__auth_failure_handler", "optional_email_send"],
  ["calendar_write__safer_with__auth_failure_handler", "calendar_write"],
  ["crm_note_write__safer_with__auth_failure_handler", "crm_note_write"],
  ["slack_notification__safer_with__auth_failure_handler", "slack_notification"],
  ["webhook_trigger__safer_with__auth_failure_handler", "webhook_trigger"],
  ["airtable_lookup__safer_with__auth_failure_handler", "airtable_lookup"],
  ["stripe_data_read__safer_with__auth_failure_handler", "stripe_data_read"],
];

for (const [edgeId, from] of AUTH_HANDLER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety injects auth_failure_handler when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("auth_failure_handler");
      expect(result.added_auth_handler).toBe(true);
    });
  });
}

/** safer_with → human_approval_gate: the safer_with edge alone triggers the gate (augmenter Rule 2). */
const SAFER_GATE_EDGES: Array<[string, string]> = [
  ["email_draft__safer_with__human_approval_gate", "email_draft"],
  ["design_brief_generation__safer_with__human_approval_gate", "design_brief_generation"],
  ["pr_summary__safer_with__human_approval_gate", "pr_summary"],
];

for (const [edgeId, from] of SAFER_GATE_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety injects human_approval_gate when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("human_approval_gate");
    });
  });
}

/** recommended_for → audit_log: an external-write action pulls an audit trail. */
const AUDIT_EDGES: Array<[string, string]> = [
  ["audit_log__recommended__external_publish", "external_publish"],
  ["audit_log__recommended__optional_email_send", "optional_email_send"],
  ["audit_log__recommended__calendar_write", "calendar_write"],
  ["audit_log__recommended__slack_notification", "slack_notification"],
];

for (const [edgeId, from] of AUDIT_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety adds audit_log when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("audit_log");
      expect(result.added_audit).toBe(true);
    });
  });
}

/** requires → audit_log: saga_compensation must keep an audit trail of every reversal. */
describe("edge: saga_compensation__requires__audit_log", () => {
  it("augmentWithSafety adds audit_log when saga_compensation is present", () => {
    const result = augmentWithSafety(pick(["saga_compensation"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("audit_log");
  });
});

/** produces_input_for / must_run_before: the orderer puts `from` before `to`. */
const ORDER_EDGES: Array<[string, string, string, string[]]> = [
  // [edgeId, from, to, componentSet]
  [
    "codebase_scan__produces__plan_generation",
    "codebase_scan",
    "plan_generation",
    ["plan_generation", "codebase_scan", "code_editing", "test_runner"],
  ],
  [
    "content_idea_intake__produces__copy_generation",
    "content_idea_intake",
    "copy_generation",
    ["copy_generation", "content_idea_intake", "design_brief_generation"],
  ],
  [
    "source_ranking__produces__research_synthesis",
    "source_ranking",
    "research_synthesis",
    ["research_synthesis", "source_ranking", "source_retrieval"],
  ],
  [
    "pdf_extraction__produces__data_normalizer",
    "pdf_extraction",
    "data_normalizer",
    ["data_normalizer", "pdf_extraction"],
  ],
];

for (const [edgeId, from, to, set] of ORDER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`computeExecutionOrder places ${from} before ${to}`, () => {
      const ids = computeExecutionOrder(pick(set), edges).map((c) => c.id);
      expect(ids.indexOf(from)).toBeLessThan(ids.indexOf(to));
    });
  });
}

/** requires (composeRoute Step 3): the required component is pulled in even though
 *  the goal never names it and no keyword matches it directly. */
describe("edge: page_monitor__requires__state_store", () => {
  it("composeRoute for a page-monitor goal pulls in state_store", () => {
    const result = composeRoute(
      {
        goal: "Monitor a web page for changes and alert me when it changes.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("page_monitor");
    expect(ids).toContain("state_store");
  });
});

describe("edge: research_synthesis__requires__source_freshness_check", () => {
  it("composeRoute for a research goal pulls in source_freshness_check", () => {
    const result = composeRoute(
      {
        goal: "research a topic and synthesise the findings into a grounded summary",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("research_synthesis");
    expect(ids).toContain("source_freshness_check");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MAR-213 — Graph densification: 20 new edges (78 → 98)
// Same patterns as above: ORDER_EDGES for produces_input_for sequencing,
// AUDIT_EDGES for recommended_for → audit_log injection.
// ═══════════════════════════════════════════════════════════════════════════

/** recommended_for → audit_log: CRM writes are externally visible and must be audited. */
describe("edge: audit_log__recommended__crm_note_write", () => {
  it("augmentWithSafety adds audit_log when crm_note_write is present", () => {
    const result = augmentWithSafety(pick(["crm_note_write"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("audit_log");
    expect(result.added_audit).toBe(true);
  });
});

/** produces_input_for: execution ordering for the 19 new sequencing edges. */
const MAR213_ORDER_EDGES: Array<[string, string, string, string[]]> = [
  [
    "email_read__produces__email_draft",
    "email_read",
    "email_draft",
    ["email_draft", "email_read", "optional_email_send"],
  ],
  [
    "email_draft__produces__optional_email_send",
    "email_draft",
    "optional_email_send",
    ["optional_email_send", "email_draft", "human_approval_gate"],
  ],
  [
    "email_read__produces__calendar_lookup",
    "email_read",
    "calendar_lookup",
    ["calendar_lookup", "email_read", "calendar_write"],
  ],
  [
    "calendar_lookup__produces__calendar_write",
    "calendar_lookup",
    "calendar_write",
    ["calendar_write", "calendar_lookup", "human_approval_gate"],
  ],
  [
    "github_trigger__produces__reviewer_notification",
    "github_trigger",
    "reviewer_notification",
    ["reviewer_notification", "github_trigger", "schema_validation"],
  ],
  [
    "github_trigger__produces__slack_notification",
    "github_trigger",
    "slack_notification",
    ["slack_notification", "github_trigger", "schema_validation", "human_approval_gate"],
  ],
  [
    "scheduled_trigger__produces__data_scraper",
    "scheduled_trigger",
    "data_scraper",
    ["data_scraper", "scheduled_trigger", "data_normalizer"],
  ],
  [
    "scheduled_trigger__produces__job_queue",
    "scheduled_trigger",
    "job_queue",
    ["job_queue", "scheduled_trigger"],
  ],
  [
    "stripe_data_read__produces__slack_notification",
    "stripe_data_read",
    "slack_notification",
    ["slack_notification", "stripe_data_read", "human_approval_gate"],
  ],
  [
    "auth_failure_handler__produces__audit_log",
    "auth_failure_handler",
    "audit_log",
    ["audit_log", "auth_failure_handler"],
  ],
  [
    "auth_failure_handler__produces__slack_notification",
    "auth_failure_handler",
    "slack_notification",
    ["slack_notification", "auth_failure_handler", "audit_log", "human_approval_gate"],
  ],
  [
    "threshold_router__produces__human_approval_gate",
    "threshold_router",
    "human_approval_gate",
    ["human_approval_gate", "threshold_router"],
  ],
  [
    "fan_out_collector__produces__state_store",
    "fan_out_collector",
    "state_store",
    ["state_store", "fan_out_collector"],
  ],
  [
    "fan_out_collector__produces__data_normalizer",
    "fan_out_collector",
    "data_normalizer",
    ["data_normalizer", "fan_out_collector"],
  ],
  [
    "loop_controller__produces__state_store",
    "loop_controller",
    "state_store",
    ["state_store", "loop_controller"],
  ],
  [
    "page_monitor__produces__slack_notification",
    "page_monitor",
    "slack_notification",
    ["slack_notification", "page_monitor", "state_store", "human_approval_gate"],
  ],
  [
    "pdf_extraction__produces__source_ranking",
    "pdf_extraction",
    "source_ranking",
    ["source_ranking", "pdf_extraction", "data_normalizer"],
  ],
  [
    "copy_generation__produces__multi_variant_generator",
    "copy_generation",
    "multi_variant_generator",
    ["multi_variant_generator", "copy_generation", "content_idea_intake"],
  ],
  [
    "intent_classifier__produces__email_draft",
    "intent_classifier",
    "email_draft",
    ["email_draft", "intent_classifier", "user_goal_intake"],
  ],
];

for (const [edgeId, from, to, set] of MAR213_ORDER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`computeExecutionOrder places ${from} before ${to}`, () => {
      const ids = computeExecutionOrder(pick(set), edges).map((c) => c.id);
      expect(ids.indexOf(from)).toBeLessThan(ids.indexOf(to));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAR-120 — Chat / conversational domain: chat_trigger + Discord/Teams/Telegram
// notification egresses. Same validation patterns as above.
// ═══════════════════════════════════════════════════════════════════════════

/** safer_with → auth_failure_handler: the augmenter injects the handler. */
const MAR120_AUTH_HANDLER_EDGES: Array<[string, string]> = [
  ["chat_trigger__safer_with__auth_failure_handler", "chat_trigger"],
  ["discord_notification__safer_with__auth_failure_handler", "discord_notification"],
  ["teams_notification__safer_with__auth_failure_handler", "teams_notification"],
  ["telegram_notification__safer_with__auth_failure_handler", "telegram_notification"],
];

for (const [edgeId, from] of MAR120_AUTH_HANDLER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety injects auth_failure_handler when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("auth_failure_handler");
      expect(result.added_auth_handler).toBe(true);
    });
  });
}

/** recommended_for → audit_log: each platform post pulls an audit trail. */
const MAR120_AUDIT_EDGES: Array<[string, string]> = [
  ["audit_log__recommended__discord_notification", "discord_notification"],
  ["audit_log__recommended__teams_notification", "teams_notification"],
  ["audit_log__recommended__telegram_notification", "telegram_notification"],
];

for (const [edgeId, from] of MAR120_AUDIT_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`augmentWithSafety adds audit_log when ${from} is present`, () => {
      const result = augmentWithSafety(pick([from]), edges, components);
      expect(result.components.map((c) => c.id)).toContain("audit_log");
      expect(result.added_audit).toBe(true);
    });
  });
}

/** produces_input_for: execution ordering for the chat flow edges. */
const MAR120_ORDER_EDGES: Array<[string, string, string, string[]]> = [
  [
    "chat_trigger__produces__intent_classifier",
    "chat_trigger",
    "intent_classifier",
    ["intent_classifier", "chat_trigger"],
  ],
  [
    "chat_trigger__produces__discord_notification",
    "chat_trigger",
    "discord_notification",
    ["discord_notification", "chat_trigger", "human_approval_gate"],
  ],
];

for (const [edgeId, from, to, set] of MAR120_ORDER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`computeExecutionOrder places ${from} before ${to}`, () => {
      const ids = computeExecutionOrder(pick(set), edges).map((c) => c.id);
      expect(ids.indexOf(from)).toBeLessThan(ids.indexOf(to));
    });
  });
}

/** recommended_for → chat_trigger: a chat-triggered agent acts on a sender's behalf,
 *  so a full chat-bot route carries both chat_trigger and an audit trail. */
describe("edge: audit_log__recommended__chat_trigger", () => {
  it("composeRoute for a Discord-bot goal contains chat_trigger and audit_log", () => {
    const result = composeRoute(
      {
        goal: "Build a Discord bot that answers support questions in the channel and posts the reply.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("chat_trigger");
    expect(ids).toContain("audit_log");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MAR-217 — Knowledge / second-brain domain: knowledge_ingestion, vector_store,
// source_attribution, note_linking. Same validation patterns as the chat block.
// ═══════════════════════════════════════════════════════════════════════════

/** produces_input_for: execution ordering for the knowledge-flow edges. */
const MAR217_ORDER_EDGES: Array<[string, string, string, string[]]> = [
  [
    "user_goal_intake__produces__knowledge_ingestion",
    "user_goal_intake",
    "knowledge_ingestion",
    ["knowledge_ingestion", "user_goal_intake", "vector_store"],
  ],
  [
    "knowledge_ingestion__produces__vector_store",
    "knowledge_ingestion",
    "vector_store",
    ["vector_store", "knowledge_ingestion"],
  ],
  [
    "knowledge_ingestion__produces__schema_validation",
    "knowledge_ingestion",
    "schema_validation",
    ["schema_validation", "knowledge_ingestion", "vector_store"],
  ],
  [
    "vector_store__produces__source_ranking",
    "vector_store",
    "source_ranking",
    ["source_ranking", "vector_store", "research_synthesis"],
  ],
  [
    "vector_store__produces__note_linking",
    "vector_store",
    "note_linking",
    ["note_linking", "vector_store"],
  ],
];

for (const [edgeId, from, to, set] of MAR217_ORDER_EDGES) {
  describe(`edge: ${edgeId}`, () => {
    it(`computeExecutionOrder places ${from} before ${to}`, () => {
      const ids = computeExecutionOrder(pick(set), edges).map((c) => c.id);
      expect(ids.indexOf(from)).toBeLessThan(ids.indexOf(to));
    });
  });
}

/** recommended_for → audit_log: ingesting an owned corpus pulls an audit trail. */
describe("edge: audit_log__recommended__vector_store", () => {
  it("augmentWithSafety adds audit_log when vector_store is present", () => {
    const result = augmentWithSafety(pick(["vector_store"]), edges, components);
    expect(result.components.map((c) => c.id)).toContain("audit_log");
    expect(result.added_audit).toBe(true);
  });
});

/** recommended: a second-brain synthesis goal scores source_attribution via keyword hints
 *  ("grounded summary" → source_attribution + research_synthesis). */
describe("edge: research_synthesis__requires__source_attribution", () => {
  it("composeRoute for a second-brain synthesis goal pulls in source_attribution", () => {
    const result = composeRoute(
      {
        goal: "Build a second brain over my notes that synthesizes a grounded summary from the relevant notes.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("research_synthesis");
    expect(ids).toContain("source_attribution");
  });
});

/** recommended_for: a query route that grounds an answer carries both the
 *  owned-corpus attribution and the external-citation checker. */
describe("edge: source_attribution__recommended__citation_checker", () => {
  it("composeRoute for a knowledge-query goal contains source_attribution and citation_checker", () => {
    const result = composeRoute(
      {
        goal: "An agent that answers questions from my personal knowledge base, cites the source note for each answer, and shows which note each answer came from.",
        must_have_capabilities: [],
        must_avoid: [],
      },
      registry,
    );
    const ids = result.recommended_route.map((s) => s.component_id);
    expect(ids).toContain("source_attribution");
    expect(ids).toContain("citation_checker");
  });
});
