import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toErrorResult } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import {
  replayPlanPassport,
  type ObservedRun,
  type ReplayPlanPassport,
} from "../lib/planReplay.js";
import { ReplayPlanPassportOutputShape } from "./outputSchemas.js";

const PlanPassportShape = z
  .object({
    contract: z.literal("orchestratekit.plan_passport.v1"),
    contract_id: z.string(),
    goal: z.string(),
    locked_constraints: z
      .object({
        read_only: z.boolean().optional(),
        draft_only: z.boolean().optional(),
        no_outbound: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    route: z
      .object({
        components: z.array(
          z
            .object({
              step: z.number(),
              component_id: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    safety_gates: z
      .object({
        enforced_approval_gates: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    acceptance_tests: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.string(),
            assertion: z.string(),
            evidence_required: z.array(z.string()),
            severity: z.enum(["must", "should"]),
          })
          .passthrough(),
      )
      .optional(),
    build_handoff: z
      .object({
        target: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ObservedRunShape = z
  .object({
    steps: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              component_id: z.string(),
              status: z.string().optional(),
              evidence: z.array(z.string()).optional(),
              notes: z.string().optional(),
            })
            .passthrough(),
        ]),
      )
      .default([]),
    events: z
      .array(
        z
          .object({
            type: z.string().optional(),
            component_id: z.string().optional(),
            action: z.string().optional(),
            status: z.string().optional(),
            approved: z.boolean().optional(),
            approval_gate: z.string().optional(),
            evidence: z.string().optional(),
            notes: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
    checklist: z
      .array(
        z
          .object({
            id: z.string(),
            status: z.enum(["pass", "warning", "fail", "missing"]),
            evidence: z.array(z.string()).optional(),
            notes: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
    actual: z
      .object({
        build_target: z.string().optional(),
        hosting: z.string().optional(),
        monitoring: z.string().optional(),
      })
      .passthrough()
      .optional(),
    notes: z.array(z.string()).default([]),
  })
  .passthrough();

const InputShape = {
  plan_passport: PlanPassportShape.optional().describe(
    "The plan_passport object emitted by export_build_brief with delivery_mode='plan_passport'.",
  ),
  build_brief: z
    .object({
      plan_passport: PlanPassportShape.optional(),
    })
    .passthrough()
    .optional()
    .describe("Optional full export_build_brief result; plan_passport is read from this when plan_passport is omitted."),
  observed_run: ObservedRunShape.describe(
    "Local observed event log/checklist for the built agent. This is caller-supplied evidence; the MCP does not execute the run.",
  ),
};

function resolvePassport(input: {
  plan_passport?: z.infer<typeof PlanPassportShape>;
  build_brief?: { plan_passport?: z.infer<typeof PlanPassportShape> };
}): ReplayPlanPassport {
  const passport = input.plan_passport ?? input.build_brief?.plan_passport;
  if (!passport) {
    throw new Error("replay_plan_passport requires plan_passport or build_brief.plan_passport");
  }
  return passport as ReplayPlanPassport;
}

export function registerReplayPlanPassport(server: McpServer): void {
  server.registerTool(
    "replay_plan_passport",
    {
      title: "Replay Plan Passport",
      description:
        "Deterministically compares a Plan Passport against a caller-supplied local run event log/checklist. " +
        "Reports route drift, approval-gate failures, forbidden actions, and missing evidence; emits a local LAB evidence object plus human-gated corpus/Linear candidates on failure. " +
        "Stateless: stores nothing, sends nothing, executes nothing, and makes no LLM calls.",
      inputSchema: InputShape,
      outputSchema: ReplayPlanPassportOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const passport = resolvePassport(input);
        const result = replayPlanPassport(passport, input.observed_run as ObservedRun);
        logger.debug(
          `replay_plan_passport -> ${result.status} ` +
            `drift=${result.drift_chips.length} missing=${result.missing_evidence.length}`,
        );
        return {
          content: [{ type: "text" as const, text: result.summary_markdown }],
          structuredContent: result,
        };
      } catch (err) {
        logger.error("replay_plan_passport failed", err);
        return toErrorResult(err);
      }
    },
  );
}
