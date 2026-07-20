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

const PlacementOptionShape = z
  .object({
    id: z.string(),
    label: z.string(),
    appropriate_when: z.string(),
    limitation: z.string(),
    availability: z.enum(["available now", "requires setup", "planned", "advanced"]),
  })
  .passthrough();

/**
 * MAR-383 connection contract. `availability` reuses the same PlacementOption
 * vocabulary above on purpose — a client that already renders availability for
 * runtimes and control surfaces needs no new words for connections.
 */
const AcquisitionPathShape = z
  .object({
    kind: z.enum(["broker_connection_mcp", "mcp_server", "raw_oauth"]),
    rank: z.number(),
    label: z.string(),
    ownership_location: z.enum(["dash", "agent", "external_manager"]),
    availability: z.enum(["available now", "requires setup", "planned", "advanced"]),
    how: z.string(),
    reuse: z.string(),
    caveat: z.string().optional(),
  })
  .passthrough();

export const connectionContractSchema = z.array(
  z
    .object({
      connection_id: z.string(),
      label: z.string(),
      serves_components: z.array(z.string()),
      grants: z.string(),
      acquisition_paths: z.array(AcquisitionPathShape),
      actionable_path_kind: z.enum(["broker_connection_mcp", "mcp_server", "raw_oauth"]),
      verification_requirement: z.string().nullable(),
      scopes: z.array(z.string()),
    })
    .passthrough(),
);

const PlacementAxisShape = z
  .object({
    recommended: PlacementOptionShape,
    alternatives: z.array(PlacementOptionShape),
  })
  .passthrough();

const RuntimeOptionShape = PlacementOptionShape.extend({
  runtime_class: z.string(),
  reason: z.string(),
  offline_behavior: z.string(),
  install_action: z.string().nullable(),
}).passthrough();

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
    // advisory build pipeline (MAR-166) — null at guided/brief/standard unless
    // the plan is loop/worker-shaped (MAR-256 payload diet)
    worker_pipeline: z
      .object({
        workers: z.array(z.object({ worker_id: z.string() }).passthrough()),
        handoffs: z.array(z.object({}).passthrough()),
        feedback_loops: z.array(z.object({}).passthrough()),
      })
      .passthrough()
      .nullable()
      .optional(),
    // MAR-256: non-null exactly when worker_pipeline was omitted for depth
    worker_pipeline_pointer: z.string().nullable().optional(),
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
    // advisory DASH-v1 observability guidance — event set + gate compliance (MAR-296)
    observability: z
      .object({
        recommended_events: z.array(z.string()),
        gate_events_required_for: z.array(z.string()),
        endpoint_env: z.string(),
        token_env: z.string(),
        note: z.string(),
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
    // per-connection acquisition paths — the DASH Connection Center contract (MAR-383)
    connection_contract: connectionContractSchema.optional(),
    // target-aware next steps — prevents post-plan dead-ending (MAR-208)
    suggested_next_actions: z.array(z.string()).optional(),
    // standardized, machine-consumable next-action menu (MAR-226)
    next_action_menu: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            action: z.string(),
          })
          .passthrough(),
      )
      .optional(),
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
    // deterministic hosting + monitoring recommendation (MAR-315)
    hosting_and_monitoring: z
      .object({
        hosting: z
          .object({
            recommended: z.object({ id: z.string(), label: z.string() }).passthrough(),
            alternatives: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
            reason: z.string(),
          })
          .passthrough(),
        monitoring: z
          .object({
            recommended: z.object({ id: z.string(), label: z.string() }).passthrough(),
            alternatives: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
            reason: z.string(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    // coverage accounting — unmatched demand / unsupported supply (MAR-250)
    goal_to_product_wizard: z
      .object({
        steps: z.array(
          z.object({ step: z.number(), label: z.string(), detail: z.string() }).passthrough(),
        ),
        connections_required: z.array(
          z.object({ id: z.string(), label: z.string(), items: z.array(z.string()) }).passthrough(),
        ),
        build_choices: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              best_for: z.string(),
              tradeoffs: z.string(),
              recommended: z.boolean(),
              action: z.string(),
            })
            .passthrough(),
        ),
        host_monitor_choices: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              best_for: z.string(),
              tradeoffs: z.string(),
              recommended: z.boolean(),
              action: z.string(),
            })
            .passthrough(),
        ),
        artifact_choices: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              best_for: z.string(),
              tradeoffs: z.string(),
              recommended: z.boolean(),
              action: z.string(),
            })
            .passthrough(),
        ),
        runtime_requirements: z
          .object({
            trigger_mode: z.enum(["interactive", "scheduled", "event", "polling", "manual"]),
            operation_mode: z.enum(["interactive", "scheduled", "event-driven", "continuous"]),
            expected_duration: z.enum(["short", "long-running"]),
            persistent_state_needed: z.boolean(),
            durable_approval_needed: z.boolean(),
            must_run_while_user_offline: z.boolean(),
            data_sensitivity: z.enum(["low", "medium", "high"]),
            estimated_operational_complexity: z.enum(["low", "medium", "high"]),
          })
          .passthrough(),
        runtime_recommendation: RuntimeOptionShape,
        runtime_alternatives: z.array(RuntimeOptionShape),
        control_surface: PlacementAxisShape,
        interaction_surface: PlacementAxisShape,
        trigger_explanation: z
          .object({
            mode: z.enum(["interactive", "scheduled", "event", "polling", "manual"]),
            label: z.string(),
            what_wakes_it_up: z.string(),
            offline_behavior: z.string(),
            limitation: z.string(),
          })
          .passthrough(),
        recommended_setup: z
          .object({
            label: z.string(),
            availability: z.enum(["available now", "requires setup", "planned", "advanced"]),
            action: z.string().nullable(),
            blocker: z.string().nullable(),
            next_achievable_step: z.string(),
          })
          .passthrough(),
        clarifying_questions: z.array(
          z.object({ id: z.string(), question: z.string(), options: z.array(z.string()) }).passthrough(),
        ),
        recommended_next_click: z
          .object({ id: z.string(), label: z.string(), action: z.string() })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    // MAR-386: deterministic Small / Medium / Large scope sizing of the task.
    // MAR-397: advisory signal about the INPUT — whether the goal reads like
    // the user's own sentence or a model's rewrite. Never moves the route.
    goal_fidelity: z
      .object({
        looks_like_paraphrase: z.boolean(),
        signals: z.array(z.string()),
        note: z.string(),
      })
      .passthrough()
      .optional(),
    scope_assessment: z
      .object({
        size: z.enum(["small", "medium", "large"]),
        drivers: z.array(z.string()),
        recommended_path: z.string(),
      })
      .passthrough()
      .optional(),
    // MAR-401 (GOLD-01): sequential clickable question rounds a client walks one
    // at a time via its native choice UI; fallback_menu_markdown is the lettered
    // no-choice-UI rendering (parseable by the MAR-387 menu contract).
    question_flow: z
      .object({
        contract: z.literal("orchestratekit.question_flow.v1"),
        rounds: z.array(
          z
            .object({
              id: z.string(),
              question: z.string(),
              options: z.array(
                z.object({ id: z.string(), label: z.string() }).passthrough(),
              ),
              recommended_option_id: z.string().nullable(),
              fold_answer_into_recall: z.boolean(),
            })
            .passthrough(),
        ),
        fallback_menu_markdown: z.string(),
      })
      .passthrough()
      .optional(),
    coverage: z
      .object({
        matched: z.array(
          z
            .object({
              component_id: z.string(),
              tokens: z.array(z.string()),
            })
            .passthrough(),
        ),
        unmatched_demand: z.array(z.string()),
        // MAR-396: the subset of unmatched_demand whose vocabulary the demand
        // lexicon could not parse at all — "we did not understand this step",
        // as distinct from "we understood it and nothing carries it".
        unrecognized_demand: z.array(z.string()),
        unsupported_supply: z.array(z.string()),
        coverage_label: z.enum(["full", "partial", "poor"]),
      })
      .passthrough()
      .optional(),
    // constraint coverage — checkable goal commitments vs. route structure (MAR-250 phase 2)
    constraint_coverage: z
      .object({
        checks: z.array(
          z
            .object({
              constraint_class: z.enum([
                "prohibition",
                "ordering",
                "quantity",
                "duration",
                "filter",
                "exactly_once",
              ]),
              goal_phrase: z.string(),
              status: z.enum(["structural", "delegated", "missing", "violated"]),
              representation: z.string(),
              acceptance_criterion: z.string().nullable(),
            })
            .passthrough(),
        ),
        structural_count: z.number(),
        delegated_count: z.number(),
        problem_count: z.number(),
        constraint_label: z.enum(["structural", "delegated", "gaps"]),
      })
      .passthrough()
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

const ArtifactIssueFieldKeyShape = z.enum([
  "title",
  "goal",
  "user_story",
  "context",
  "inputs",
  "outputs",
  "required_tools",
  "data_model",
  "step_by_step_implementation",
  "edge_cases",
  "failure_modes",
  "security",
  "approval_gates",
  "acceptance_criteria",
  "test_cases",
  "definition_of_done",
  "claude_code_cursor_prompt",
  "files_likely_affected",
  "non_goals",
]);

const ArtifactFieldValueShape = z.union([z.string(), z.array(z.string())]);

const ArtifactIssueFieldsShape = z
  .object({
    title: ArtifactFieldValueShape,
    goal: ArtifactFieldValueShape,
    user_story: ArtifactFieldValueShape,
    context: ArtifactFieldValueShape,
    inputs: ArtifactFieldValueShape,
    outputs: ArtifactFieldValueShape,
    required_tools: ArtifactFieldValueShape,
    data_model: ArtifactFieldValueShape,
    step_by_step_implementation: ArtifactFieldValueShape,
    edge_cases: ArtifactFieldValueShape,
    failure_modes: ArtifactFieldValueShape,
    security: ArtifactFieldValueShape,
    approval_gates: ArtifactFieldValueShape,
    acceptance_criteria: ArtifactFieldValueShape,
    test_cases: ArtifactFieldValueShape,
    definition_of_done: ArtifactFieldValueShape,
    claude_code_cursor_prompt: ArtifactFieldValueShape,
    files_likely_affected: ArtifactFieldValueShape,
    non_goals: ArtifactFieldValueShape,
  })
  .passthrough();

/** export_build_brief — canonical build handoff plus MAR-249 artifact package. */
export const ExportBuildBriefOutputShape = z
  .object({
    status: z.literal("needs_input").optional(),
    summary_markdown: z.string().optional(),
    needs_input: z
      .object({
        kind: z.literal("llm_provider"),
        question: z.string(),
        model_backed_components: z.array(z.string()),
        options: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              description: z.string(),
              arguments_delta: z.object({ llm_provider: z.string() }).passthrough(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    provider_decision: z
      .object({
        required_before: z.literal("build_artifacts"),
        reason: z.string(),
        no_default_provider: z.literal(true),
      })
      .passthrough()
      .optional(),
    delivery: z
      .object({
        contract: z.literal("export_build_brief.delivery.v1"),
        mode: z.enum(["compact", "full", "plan_passport"]),
        artifact_fingerprint: z.string(),
        artifact_bytes: z.number().int().positive(),
        full_artifact_available: z.literal(true),
        full_request: z
          .object({
            tool: z.literal("export_build_brief"),
            reuse_same_arguments: z.literal(true),
            arguments_delta: z.object({ delivery_mode: z.literal("full") }),
            instruction: z.string(),
          })
          .passthrough(),
        omitted_fields: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    brief_markdown: z.string().optional(),
    passport_markdown: z.string().optional(),
    plan_passport: z
      .object({
        contract: z.literal("orchestratekit.plan_passport.v1"),
        contract_id: z.string(),
        registry_fingerprint: z.string(),
        goal: z.string(),
        route: z
          .object({
            plan_source: z.enum(["playbook", "composed"]),
            route_status: z.string(),
            components: z.array(
              z.object({ step: z.number(), component_id: z.string() }).passthrough(),
            ),
          })
          .passthrough(),
        required_connections: z.array(z.object({ env: z.string(), provider: z.string() }).passthrough()),
        safety_gates: z
          .object({
            automation_clearance: z.string(),
            enforced_approval_gates: z.array(z.string()),
          })
          .passthrough(),
        acceptance_tests: z.array(
          z
            .object({
              id: z.string(),
              kind: z.string(),
              assertion: z.string(),
              evidence_required: z.array(z.string()),
              severity: z.enum(["must", "should"]),
            })
            .passthrough(),
        ),
        lab_import: z.object({ artifact: z.literal("plan_passport"), contract_id: z.string() }).passthrough(),
      })
      .passthrough()
      .optional(),
    sections: z.object({}).passthrough().optional(),
    handoffs: z.object({}).passthrough().optional(),
    artifact_index: z
      .object({
        compiler: z.literal("export_build_brief.artifact_compiler.v1"),
        status: z.literal("compiled"),
        artifact_fingerprint: z.string(),
        artifact_bytes: z.number().int().positive(),
        epic: z.object({ title: z.string(), goal: z.string() }).passthrough(),
        milestones: z.array(
          z.object({ id: z.string(), title: z.string(), issue_ids: z.array(z.string()) }).passthrough(),
        ),
        issues: z.array(
          z.object({ id: z.string(), milestone_id: z.string(), title: z.string() }),
        ),
        full_contains: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    artifact_package: z
      .object({
        compiler: z.literal("export_build_brief.artifact_compiler.v1"),
        status: z.literal("compiled"),
        scope_confirmation: z
          .object({
            assumed_confirmed: z.literal(true),
            instruction: z.string(),
          })
          .passthrough(),
        directives: z.array(z.string()),
        field_order: z.array(ArtifactIssueFieldKeyShape),
        epic: z
          .object({
            title: z.string(),
            goal: z.string(),
            context: z.string(),
            non_goals: z.array(z.string()),
            milestones: z.array(z.string()),
          })
          .passthrough(),
        milestones: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              goal: z.string(),
              issue_ids: z.array(z.string()),
            })
            .passthrough(),
        ),
        linear_issue_templates: z.array(
          z
            .object({
              id: z.string(),
              milestone_id: z.string(),
              title: z.string(),
              fields: ArtifactIssueFieldsShape,
              markdown: z.string(),
            })
            .passthrough(),
        ),
        few_shot_example: z
          .object({
            title: z.string(),
            markdown: z.string(),
            note: z.string(),
          })
          .passthrough(),
        build_prompt: z.string(),
        linear_issue_template_markdown: z.string(),
      })
      .passthrough()
      .optional(),
    agent_manifest: z.object({}).passthrough().optional(),
    // MAR-364: fast-connect credential manifest + generated scripts/connect.mjs.
    connect: z
      .object({
        script_path: z.literal("scripts/connect.mjs"),
        credential_manifest: z.array(
          z
            .object({
              env: z.string(),
              provider: z.string(),
              label: z.string(),
              required: z.boolean(),
              secret: z.boolean(),
              required_by: z.array(z.string()),
              mint_url: z.string(),
              mint_hint: z.string(),
              connect: z.enum(["paste", "google_oauth"]),
              probe: z.object({ kind: z.enum(["http", "google_refresh", "none"]) }).passthrough(),
            })
            .passthrough(),
        ),
        connect_script: z.string(),
        instructions: z.string(),
      })
      .passthrough()
      .optional(),
    provenance_tag: z.literal("registry-grounded"),
    grounding_note: z.string(),
  })
  .passthrough();

/** replay_plan_passport — deterministic local replay verifier (MAR-343). */
export const ReplayPlanPassportOutputShape = z
  .object({
    contract: z.literal("orchestratekit.plan_replay.v1"),
    status: z.enum(["pass", "warning", "fail"]),
    plan_contract_id: z.string(),
    replay_fingerprint: z.string(),
    summary_markdown: z.string(),
    drift_chips: z.array(
      z
        .object({
          kind: z.string(),
          severity: z.enum(["info", "warning", "fail"]),
          message: z.string(),
        })
        .passthrough(),
    ),
    missing_evidence: z.array(
      z
        .object({
          kind: z.string(),
          severity: z.enum(["must", "should"]),
          message: z.string(),
          evidence_required: z.array(z.string()),
        })
        .passthrough(),
    ),
    observed_route: z.array(z.string()),
    planned_route: z.array(z.string()),
    suggested_lab_rating: z.enum(["verified", "needs_evidence", "failed"]),
    lab_evidence: z
      .object({
        contract: z.literal("orchestratekit.lab_evidence.plan_replay.v1"),
        source: z.literal("plan_replay"),
        plan_contract_id: z.string(),
        replay_fingerprint: z.string(),
        evidence_status: z.enum(["verified", "needs_evidence", "failed"]),
        route_components: z.array(z.string()),
      })
      .passthrough(),
    corpus_contract_candidate: z
      .object({
        contract: z.literal("orchestratekit.corpus_contract_candidate.v1"),
        source: z.literal("plan_replay"),
        human_gate: z.literal("required"),
      })
      .passthrough()
      .nullable(),
    linear_issue_candidate: z
      .object({
        title: z.string(),
        labels: z.array(z.string()),
        description_markdown: z.string(),
        human_gate: z.literal("required"),
      })
      .passthrough()
      .nullable(),
    provenance_tag: z.literal("deterministic-replay"),
    grounding_note: z.string(),
  })
  .passthrough();
