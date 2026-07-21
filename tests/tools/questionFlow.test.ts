/**
 * MAR-401 (GOLD-01) — the `question_flow` contract.
 *
 * plan_workflow's first screen is a card followed by sequential CLICKABLE
 * question rounds. This suite pins the round spine (confirm_card →
 * build_surface → process → monitoring → conditional clarifying rounds), the
 * stable option ids the LAB harness and DASH switch on, and the rule that every
 * recommended pick is a re-projection of machinery the plan already computed —
 * never fresh inference, never drift from the ⭐.
 */
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { parseMenu } from "../../src/journey/menu.js";

const registry = loadRegistry();

function plan(goal: string, depth: "brief" | "standard" | "technical" = "brief") {
  return planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [], output_depth: depth },
    registry,
  );
}

// Fully-specified medium goal — no clarifying questions.
const HEAVY_GOAL =
  "Read new leads from my email inbox, draft a reply, update the CRM record, " +
  "notify the sales channel on Slack, and require human approval before anything is sent externally";
// Small attended goal — ⭐ is the no-code assistant surface.
const ONE_SHOT = "summarize my inbox for me now";
// Durable/offline goal — hosted runtime recommended.
const PRICING =
  "Build an agent that checks 5 competitor pages every morning, detects price changes, " +
  "and sends me a Slack summary. I want to approve before anything external is changed.";
// Under-specified goal — raises clarifying questions.
const VAGUE = "go through my inbox and handle the sales leads automatically";

describe("MAR-401 — question_flow round spine", () => {
  it("every plan carries the four fixed rounds, in order, at every depth", () => {
    for (const depth of ["brief", "standard", "technical"] as const) {
      const qf = plan(HEAVY_GOAL, depth).question_flow;
      expect(qf.contract).toBe("orchestratekit.question_flow.v1");
      expect(qf.rounds.map((r) => r.id).slice(0, 4)).toEqual([
        "confirm_card",
        "build_surface",
        "process",
        "monitoring",
      ]);
    }
  });

  it("round 0 is always confirm_card with yes / change_something", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE]) {
      const round = plan(goal).question_flow.rounds[0];
      expect(round.id).toBe("confirm_card");
      expect(round.options.map((o) => o.id)).toEqual(["yes", "change_something"]);
      expect(round.recommended_option_id).toBe("yes");
      // a correction refines the goal, so it belongs in a re-call
      expect(round.fold_answer_into_recall).toBe(true);
    }
  });

  it("every round has options with stable ids and every option has a label", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE]) {
      for (const round of plan(goal).question_flow.rounds) {
        expect(round.options.length).toBeGreaterThanOrEqual(2);
        for (const option of round.options) {
          expect(option.id.length).toBeGreaterThan(0);
          expect(option.label.length).toBeGreaterThan(0);
        }
        // a non-null recommendation always names a real option
        if (round.recommended_option_id !== null) {
          expect(round.options.map((o) => o.id)).toContain(round.recommended_option_id);
        }
      }
    }
  });
});

describe("MAR-401 — recommended picks are re-projections, not fresh inference", () => {
  it("a small attended goal recommends the Cowork build surface (mirrors the MAR-395 ⭐)", () => {
    const r = plan(ONE_SHOT);
    expect(r.goal_to_product_wizard.recommended_next_click.id).toBe("build_in_assistant");
    const round = r.question_flow.rounds.find((x) => x.id === "build_surface")!;
    expect(round.recommended_option_id).toBe("cowork");
  });

  it("a durable hosted goal recommends the always-on self-host surface", () => {
    const r = plan(PRICING);
    const hosting = r.hosting_and_monitoring.hosting.recommended.id;
    const round = r.question_flow.rounds.find((x) => x.id === "build_surface")!;
    const expected =
      hosting === "hosted_cron" || hosting === "hosted_endpoint"
        ? "self_host_hosted"
        : hosting === "in_client"
        ? "cowork"
        : "self_host_local";
    expect(round.recommended_option_id).toBe(expected);
  });

  it("the process round mirrors recommended_next_click (Linear ⭐ → save_plan)", () => {
    const r = plan(HEAVY_GOAL);
    const round = r.question_flow.rounds.find((x) => x.id === "process")!;
    expect(round.options.map((o) => o.id)).toEqual(["save_plan", "build_prompt"]);
    expect(round.recommended_option_id).toBe(
      r.goal_to_product_wizard.recommended_next_click.id === "generate_linear_project"
        ? "save_plan"
        : "build_prompt",
    );
  });

  it("the monitoring round maps the MAR-315 recommendation onto Cowork/local logs/DASH/other", () => {
    const r = plan(PRICING);
    const round = r.question_flow.rounds.find((x) => x.id === "monitoring")!;
    // MAR-410: `lab` was renamed `local_logs` — LAB is a private program the
    // user does not have, and `log_to_file` is the DEFAULT recommendation, so
    // the old id ⭐-pointed every user at software that isn't theirs.
    expect(round.options.map((o) => o.id)).toEqual(["cowork", "local_logs", "dash", "other"]);
    const monitoring = r.hosting_and_monitoring.monitoring.recommended.id;
    const expected =
      r.hosting_and_monitoring.hosting.recommended.id === "in_client"
        ? "cowork"
        : monitoring === "dash_import"
        ? "dash"
        : monitoring === "log_to_file"
        ? "local_logs"
        : "other";
    expect(round.recommended_option_id).toBe(expected);
  });
});

describe("MAR-410 — no private product names in user-facing option copy", () => {
  // "LAB" is an internal program; naming it on a chip offers the user software
  // they cannot get. The generic capability (MAR-315's `log_to_file` label) is
  // what the plan actually recommends, so name the capability, not the product.
  const GOALS = [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE];

  it("no option label anywhere in the flow says LAB", () => {
    for (const goal of GOALS) {
      for (const round of plan(goal).question_flow.rounds) {
        for (const option of round.options) {
          expect(option.label, `${round.id}/${option.id}`).not.toMatch(/\bLAB\b/);
          expect(option.description ?? "", `${round.id}/${option.id}`).not.toMatch(/\bLAB\b/);
        }
      }
    }
  });

  it("the DASH monitoring label no longer carries the LAB Agents module", () => {
    for (const goal of GOALS) {
      const hm = plan(goal).hosting_and_monitoring;
      for (const o of [hm.monitoring.recommended, ...hm.monitoring.alternatives]) {
        expect(o.label).not.toMatch(/\bLAB\b/);
      }
    }
  });

  it("the local-logs option names the capability, not a product", () => {
    const round = plan(PRICING).question_flow.rounds.find((x) => x.id === "monitoring")!;
    const local = round.options.find((o) => o.id === "local_logs")!;
    expect(local.label.toLowerCase()).toContain("file or table you already have");
  });

  it("the local build surface reads as an app you get, not a script on a timer", () => {
    const round = plan(PRICING).question_flow.rounds.find((x) => x.id === "build_surface")!;
    const local = round.options.find((o) => o.id === "self_host_local")!;
    expect(local.label.toLowerCase()).toContain("local app");
  });
});

describe("MAR-411 — option-level hidden_when keeps later rounds coherent", () => {
  // plan_workflow is stateless and emits every round in one call, so it cannot
  // filter downstream options server-side. It declares the dependency instead;
  // the client applies it against answers it already holds.
  const GOALS = [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE];

  it("a self-hosted build hides the 'watch it in the client session' monitoring option", () => {
    const round = plan(PRICING).question_flow.rounds.find((x) => x.id === "monitoring")!;
    const cowork = round.options.find((o) => o.id === "cowork")!;
    expect(cowork.hidden_when).toEqual({
      round: "build_surface",
      answer_in: ["self_host_local", "self_host_hosted"],
    });
  });

  it("a Cowork build hides the options that need an exported manifest or a durable log", () => {
    const round = plan(PRICING).question_flow.rounds.find((x) => x.id === "monitoring")!;
    for (const id of ["local_logs", "dash"]) {
      const opt = round.options.find((o) => o.id === id)!;
      expect(opt.hidden_when!.round).toBe("build_surface");
      expect(opt.hidden_when!.answer_in).toContain("cowork");
    }
  });

  it("every hidden_when names a REAL earlier round and real option ids of it", () => {
    for (const goal of GOALS) {
      const rounds = plan(goal).question_flow.rounds;
      for (const [i, round] of rounds.entries()) {
        for (const option of round.options) {
          if (!option.hidden_when) continue;
          const sourceIndex = rounds.findIndex((r) => r.id === option.hidden_when!.round);
          expect(sourceIndex, `${round.id}/${option.id}`).toBeGreaterThanOrEqual(0);
          // A dependency on a LATER round is unsatisfiable: the client cannot
          // filter on an answer it has not collected yet.
          expect(sourceIndex, `${round.id}/${option.id}`).toBeLessThan(i);
          const sourceIds = rounds[sourceIndex].options.map((o) => o.id);
          for (const answer of option.hidden_when.answer_in) {
            expect(sourceIds, `${round.id}/${option.id}`).toContain(answer);
          }
        }
      }
    }
  });

  it("filtering can never empty a round — every round keeps an unconditional option", () => {
    for (const goal of GOALS) {
      for (const round of plan(goal).question_flow.rounds) {
        const unconditional = round.options.filter((o) => !o.hidden_when);
        expect(unconditional.length, round.id).toBeGreaterThan(0);
      }
    }
  });

  it("hidden_when never hides the recommended option under its OWN recommendation", () => {
    // The ⭐ must survive the filter for the answers the plan itself recommends,
    // or the client would drop the very option the plan pointed at.
    for (const goal of GOALS) {
      const rounds = plan(goal).question_flow.rounds;
      const answers = new Map(rounds.map((r) => [r.id, r.recommended_option_id]));
      for (const round of rounds) {
        const rec = round.options.find((o) => o.id === round.recommended_option_id);
        if (!rec?.hidden_when) continue;
        const given = answers.get(rec.hidden_when.round);
        expect(rec.hidden_when.answer_in, `${round.id}/${rec.id}`).not.toContain(given);
      }
    }
  });

  it("scope never gates capability: every fixed-spine option survives at every size", () => {
    // MAR-386's hard rule. hidden_when expresses INCOHERENCE with an answer,
    // never task size — so no option's condition may reference scope.
    const SMALL = "summarize my inbox for me now";
    const LARGE = HEAVY_GOAL;
    const idsFor = (goal: string) =>
      plan(goal)
        .question_flow.rounds.filter((r) =>
          ["build_surface", "process", "monitoring", "terminal"].includes(r.id),
        )
        .flatMap((r) => r.options.map((o) => `${r.id}/${o.id}`));
    expect(idsFor(SMALL)).toEqual(idsFor(LARGE));
  });
});

describe("MAR-412 — the terminal round is the MCP's, and it honours the process answer", () => {
  const GOALS = [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE];

  it("every plan ends with a `terminal` round, at every depth", () => {
    for (const depth of ["brief", "standard", "technical"] as const) {
      for (const goal of GOALS) {
        const rounds = plan(goal, depth).question_flow.rounds;
        expect(rounds.at(-1)!.id, `${goal} @ ${depth}`).toBe("terminal");
        // exactly one — the closing round is not duplicated into the spine
        expect(rounds.filter((r) => r.id === "terminal")).toHaveLength(1);
      }
    }
  });

  it("the terminal recommendation mirrors the process round — never a different deliverable", () => {
    for (const goal of GOALS) {
      const rounds = plan(goal).question_flow.rounds;
      const process = rounds.find((r) => r.id === "process")!;
      const terminal = rounds.at(-1)!;
      expect(terminal.recommended_option_id).toBe(process.recommended_option_id);
    }
  });

  it("answering process=build_prompt leaves a build-prompt terminal action standing", () => {
    // The dogfood defect: the user picked "Turn it into a build prompt" and the
    // closing round offered Linear issues instead. Applying hidden_when against
    // that answer must leave the build-prompt action, and drop save_plan.
    const terminal = plan(PRICING).question_flow.rounds.at(-1)!;
    const survives = (answer: string) =>
      terminal.options
        .filter((o) => !(o.hidden_when?.round === "process" && o.hidden_when.answer_in.includes(answer)))
        .map((o) => o.id);

    expect(survives("build_prompt")).toContain("build_prompt");
    expect(survives("build_prompt")).not.toContain("save_plan");
    expect(survives("save_plan")).toContain("save_plan");
    expect(survives("save_plan")).not.toContain("build_prompt");
  });

  it("the terminal round keeps its escape hatches under either process answer", () => {
    const terminal = plan(PRICING).question_flow.rounds.at(-1)!;
    for (const answer of ["build_prompt", "save_plan"]) {
      const ids = terminal.options
        .filter((o) => !(o.hidden_when?.round === "process" && o.hidden_when.answer_in.includes(answer)))
        .map((o) => o.id);
      expect(ids).toContain("not_yet");
      expect(ids).toContain("other");
      // never empty, and never a single forced button
      expect(ids.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("the terminal round is honest that nothing has been written yet", () => {
    const terminal = plan(HEAVY_GOAL).question_flow.rounds.at(-1)!;
    expect(terminal.why ?? "").toMatch(/nothing is created/i);
    expect(terminal.fold_answer_into_recall).toBe(false);
  });
});

describe("MAR-413 — option descriptions ship grounded, so the client invents none", () => {
  const GOALS = [HEAVY_GOAL, ONE_SHOT, PRICING, VAGUE];
  const FIXED_SPINE = ["confirm_card", "build_surface", "process", "monitoring", "terminal"];

  it("every fixed-spine option carries a description", () => {
    for (const goal of GOALS) {
      for (const round of plan(goal).question_flow.rounds) {
        if (!FIXED_SPINE.includes(round.id)) continue;
        for (const option of round.options) {
          expect(option.description ?? "", `${round.id}/${option.id}`).not.toBe("");
        }
      }
    }
  });

  it("no description asserts anything about the user's existing setup", () => {
    // The dogfood subtitle claimed the choice matched "how your other
    // OrchestrateKit agents are monitored". The MCP is stateless — it knows of
    // no other agents — so any such claim is invention, wherever it originates.
    const FABRICATION = /your (other|existing|current) \w+|already (run|have set|use)\b|as you (do|did)\b/i;
    for (const goal of GOALS) {
      for (const round of plan(goal).question_flow.rounds) {
        for (const option of round.options) {
          expect(option.description ?? "", `${round.id}/${option.id}`).not.toMatch(FABRICATION);
        }
      }
    }
  });

  it("descriptions are deterministic — the same goal renders the same prose", () => {
    const a = plan(PRICING).question_flow.rounds;
    const b = plan(PRICING).question_flow.rounds;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the recommended monitoring description states its own limitation", () => {
    // A ⭐ that only sells itself is how "log to a file" reads as monitoring.
    const round = plan(PRICING).question_flow.rounds.find((x) => x.id === "monitoring")!;
    const local = round.options.find((o) => o.id === "local_logs")!;
    expect(local.description!.toLowerCase()).toContain("nothing alerts you");
  });
});

describe("MAR-401 — conditional rounds fold in the MAR-225 clarifying questions", () => {
  it("an under-specified goal appends its foldable clarifying questions as rounds 4+", () => {
    const r = plan(VAGUE);
    expect(r.clarifying_questions.length).toBeGreaterThan(0);
    // The three scope-completion forks the fixed spine already asks are NOT
    // folded again (rounds 1-3 carry them); everything else rides verbatim.
    const SPINE_COVERED = new Set(["build_surface", "hosting_monitoring", "artifact_target"]);
    const foldable = r.clarifying_questions.filter((q) => !SPINE_COVERED.has(q.id));
    expect(foldable.length).toBeGreaterThan(0);
    // MAR-412: `terminal` is always last, so the conditional band is slice(4, -1).
    expect(r.question_flow.rounds.at(-1)!.id).toBe("terminal");
    const conditional = r.question_flow.rounds.slice(4, -1);
    expect(conditional.map((x) => x.id)).toEqual(foldable.map((q) => q.id));
    // round ids stay unique — the whole point of not double-folding
    const ids = r.question_flow.rounds.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [i, round] of conditional.entries()) {
      const q = foldable[i];
      expect(round.question).toBe(q.question);
      expect(round.options.map((o) => o.label)).toEqual(q.options);
      // architecture-affecting answers must be folded into a re-call goal
      expect(round.fold_answer_into_recall).toBe(true);
      if (q.option_ids) {
        // no parallel vocabulary — the MAR-225 ids ARE the option ids
        expect(round.options.map((o) => o.id)).toEqual(q.option_ids);
      }
    }
  });

  it("a fully-specified goal has exactly the fixed spine + terminal (no nagging)", () => {
    const r = plan(HEAVY_GOAL);
    expect(r.clarifying_questions).toEqual([]);
    // four fixed rounds, no conditionals, plus the MAR-412 terminal round
    expect(r.question_flow.rounds.map((x) => x.id)).toEqual([
      "confirm_card",
      "build_surface",
      "process",
      "monitoring",
      "terminal",
    ]);
  });

  it("a side-effect question keeps its never-default rule (null recommended only when MAR-225 says so)", () => {
    const GOLDEN =
      "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
      "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
      "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
      "the email. I will be present for approval and I want visible run logs.";
    const r = plan(GOLDEN);
    const calendarQ = r.clarifying_questions.find((q) => q.id === "calendar_notification");
    expect(calendarQ).toBeDefined();
    const round = r.question_flow.rounds.find((x) => x.id === "calendar_notification")!;
    // this goal's constraints imply a recommendation — the round must carry the
    // SAME one, not invent its own
    expect(round.recommended_option_id).toBe(calendarQ!.recommended_option_id ?? null);
  });
});

describe("MAR-405 — the confirm_card 'Change something' correction re-call reflects the correction", () => {
  // The confirm round offers `change_something` with fold_answer_into_recall:
  // true — a correction refines the goal and is applied by RE-CALLING
  // plan_workflow with the corrected goal. Nothing pinned that the SECOND card
  // actually reflects the correction rather than being a stale re-render, so a
  // regression that ignored the correction would pass silently. This is that pin.
  const BASE = "Build an email assistant.";
  const READONLY_CORRECTION =
    " It must be strictly read-only: never send, draft, or modify any email; only read and summarize.";

  const WRITE_COMPONENTS = ["email_draft", "email_send", "optional_email_send"];
  const routeOf = (goal: string) =>
    plan(goal).recommended_route.map((step) => step.component_id);
  const cardLine = (goal: string, label: string) =>
    plan(goal).summary_markdown.split("\n").find((l) => l.startsWith(label)) ?? "";

  it("the confirm round is the correction entry point (change_something folds into a re-call)", () => {
    const round = plan(BASE).question_flow.rounds[0];
    expect(round.id).toBe("confirm_card");
    expect(round.options.map((o) => o.id)).toContain("change_something");
    expect(round.fold_answer_into_recall).toBe(true);
  });

  it("the corrected card is not a stale re-render of the first card", () => {
    const before = plan(BASE).summary_markdown;
    const after = plan(BASE + READONLY_CORRECTION).summary_markdown;
    expect(after).not.toBe(before);
  });

  it("the correction is echoed in the card's 'What you'll get' line", () => {
    const line = cardLine(BASE + READONLY_CORRECTION, "**What you'll get:**").toLowerCase();
    expect(line).toContain("read-only");
  });

  it("a read-only correction drops the write path the first plan carried", () => {
    const before = routeOf(BASE);
    const after = routeOf(BASE + READONLY_CORRECTION);
    // The first plan MUST carry at least one write component, or the correction
    // has nothing to remove and this eval would pass vacuously.
    expect(before.some((c) => WRITE_COMPONENTS.includes(c))).toBe(true);
    // The corrected plan must carry NONE of them.
    expect(after.filter((c) => WRITE_COMPONENTS.includes(c))).toEqual([]);
  });

  it("the correction moves the automation clearance (a real re-plan, not a re-render)", () => {
    const before = plan(BASE).automation_clearance.level;
    const after = plan(BASE + READONLY_CORRECTION).automation_clearance.level;
    expect(after).not.toBe(before);
  });

  it("re-calling with the SAME goal is a stable no-op (isolates the correction as the cause)", () => {
    // The differ-assertions above only mean something if an unchanged goal
    // re-renders identically — otherwise any two cards would differ.
    expect(plan(BASE).summary_markdown).toBe(plan(BASE).summary_markdown);
  });
});

describe("MAR-401 — the no-choice-UI fallback menu", () => {
  it("fallback_menu_markdown is the lettered menu and parses under the MAR-387 contract", () => {
    for (const goal of [HEAVY_GOAL, ONE_SHOT, PRICING]) {
      const qf = plan(goal).question_flow;
      expect(qf.fallback_menu_markdown).toContain("### How do you want to continue?");
      const menu = parseMenu(qf.fallback_menu_markdown);
      expect(menu.length).toBeGreaterThan(0);
      for (const option of menu) {
        expect(option.action_id, `"${option.text}"`).not.toBe("unknown");
      }
    }
  });

  it("the fallback menu is deterministic across calls", () => {
    const a = plan(HEAVY_GOAL).question_flow;
    const b = plan(HEAVY_GOAL).question_flow;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
