/**
 * MCP output schemas (MAR-163).
 *
 * Declares `outputSchema` for the five key tools so MCP clients (ChatGPT,
 * Claude, Cursor) receive a published output shape and a `structuredContent`
 * object they can parse without re-deriving it from prose. Per the MCP spec, a
 * tool that declares an outputSchema MUST return conforming `structuredContent`
 * on every non-error response; the server AND the client validate it.
 *
 * DESIGN — minimal + `.passthrough()`:
 *  - Each schema requires only the fields present in EVERY branch of that tool's
 *    output (ok / not_found / needs_goal / disambiguation), so runtime validation
 *    never breaks a live tool on a non-primary branch, and declares the
 *    high-value fields a client switches on as optional.
 *  - Every object is `.passthrough()` (→ JSON-Schema `additionalProperties: true`).
 *    This is REQUIRED, not cosmetic: the client validates `structuredContent`
 *    with Ajv against the published JSON schema, and a non-passthrough object
 *    emits `additionalProperties: false`, which would REJECT every extra field
 *    the tool returns. Passthrough keeps the schema a published *contract surface*
 *    rather than a filter — the full result still reaches the client untouched.
 *  - The golden snapshot tests (tests/tools/outputSchemas.test.ts) lock the full
 *    shape against drift; these schemas keep the runtime contract.
 */
import { z } from "zod";

/**
 * plan_workflow — a full plan OR a `needs_goal` nudge (MAR-162). The only field
 * common to both is `summary_markdown`; the plan fields and the needs_goal
 * fields are therefore optional, discriminated by the presence of `status`.
 */
export const PlanWorkflowOutputShape = z
  .object({
    summary_markdown: z.string(),
    // present on a plan
    plan_source: z.enum(["playbook", "composed"]).optional(),
    goal: z.string().optional(),
    route_status: z.string().optional(),
    route_score: z.number().optional(),
    enforced_approval_gates: z.array(z.string()).optional(),
    safety_review: z
      .object({ status: z.enum(["pass", "warnings", "fail"]) })
      .passthrough()
      .optional(),
    recommended_route: z
      .array(z.object({ component_id: z.string() }).passthrough())
      .optional(),
    // advisory build pipeline (MAR-166)
    worker_pipeline: z
      .object({
        workers: z.array(z.object({ worker_id: z.string() }).passthrough()),
        handoffs: z.array(z.object({}).passthrough()),
        feedback_loops: z.array(z.object({}).passthrough()),
      })
      .passthrough()
      .optional(),
    // advisory bounded-loop contract — null unless the route is loop-shaped (MAR-167)
    loop_guidance: z
      .object({
        playbook_id: z.string(),
        worker_sequence: z.array(z.string()),
        loop_contract: z.object({ max_iterations: z.number() }).passthrough(),
        guardrail_checklist: z.array(z.string()),
      })
      .passthrough()
      .nullable()
      .optional(),
    // earned-by-evidence autonomy level on every plan (MAR-168)
    automation_clearance: z
      .object({
        level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
        autonomous_allowed: z.boolean(),
        reason: z.string(),
        required_controls: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    // design notes from edge control_flow_note annotations + structural advisories (MAR-211/212)
    design_notes: z.array(z.string()).optional(),
    // concrete integration needs derived from route components (MAR-208 / MAR-124)
    what_you_need: z
      .array(
        z
          .object({
            component_id: z.string(),
            label: z.string(),
            product_examples: z.array(z.string()),
            scopes: z.array(z.string()),
            // MAR-124 CTX-02: enriched catalog fields
            auth_model: z.string().optional(),
            mcp_server: z
              .object({
                availability: z.enum(["official", "community", "none"]),
                package: z.string().optional(),
                transport: z.enum(["stdio", "sse", "http", "none"]),
                note: z.string().optional(),
              })
              .passthrough()
              .optional(),
            required_scopes: z.array(z.string()).optional(),
            gotchas: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    // target-aware next steps — prevents post-plan dead-ending (MAR-208)
    suggested_next_actions: z.array(z.string()).optional(),
    // bounded multiple-choice clarifying questions (MAR-225)
    clarifying_questions: z
      .array(
        z
          .object({
            id: z.string(),
            question: z.string(),
            options: z.array(z.string()),
          })
          .passthrough(),
      )
      .optional(),
    // provenance model — grounded / computed / advisory tags per field (MAR-206)
    provenance: z
      .object({
        model: z.literal("registry-deterministic"),
        all_fields_are_registry_derived: z.literal(true),
        field_tags: z.record(z.enum(["grounded", "computed", "advisory"])),
        grounding_note: z.string(),
      })
      .passthrough()
      .optional(),
    // present on a needs_goal nudge (MAR-162)
    status: z.literal("needs_goal").optional(),
    reason: z.string().optional(),
    example: z.string().optional(),
  })
  .passthrough();

/** explain_component — `ok` (component found) or `not_found`. */
export const ExplainComponentOutputShape = z
  .object({
    status: z.enum(["ok", "not_found"]),
    component_id: z.string().optional(),
    name: z.string().optional(),
    explanation: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

/** get_playbook — `ok` / `low_confidence` / `not_found`; all carry these. */
export const GetPlaybookOutputShape = z
  .object({
    status: z.string(),
    confidence: z.number(),
    summary_markdown: z.string(),
    warnings: z.array(z.string()),
    next_recommended_tools: z.array(z.string()),
    matched_playbook_id: z.string().optional(),
    // polymorphic (full playbook | summary | implementation_focused) — z.unknown
    // so any of the three shapes validates without re-declaring each.
    playbook: z.unknown().optional(),
  })
  .passthrough();

/** recommend_architecture — `ok` or `not_found`; both carry these. */
export const RecommendArchitectureOutputShape = z
  .object({
    status: z.string(),
    confidence: z.number(),
    recommendation_markdown: z.string(),
    next_recommended_tools: z.array(z.string()),
  })
  .passthrough();

/** validate_playbook_candidate — ok / invalid_yaml / schema_invalid (MAR-169). */
export const ValidatePlaybookCandidateOutputShape = z
  .object({
    status: z.enum(["ok", "invalid_yaml", "schema_invalid"]),
    playbook_id: z.string().nullable(),
    qualifies_for: z.enum(["draft", "candidate", "beta"]).nullable(),
    blocking: z.array(z.string()),
    evidence_required: z.array(z.string()),
    summary_markdown: z.string(),
    next_recommended_tools: z.array(z.string()),
  })
  .passthrough();

/** review_workflow_design — single shape. */
export const ReviewWorkflowDesignOutputShape = z
  .object({
    status: z.string(),
    risk_score: z.number(),
    summary_markdown: z.string(),
    blocking_issues: z.array(z.string()),
    warnings: z.array(z.string()),
    approval_gates_required: z.array(z.string()),
    next_recommended_tools: z.array(z.string()),
  })
  .passthrough();
