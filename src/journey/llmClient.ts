/**
 * MAR-387 (real-LLM variant) — the OpenRouter-driven journey client.
 *
 * `mechanicalClient.ts` proves the journey is walkable by a client with no
 * imagination. This module asks the harder question: does a REAL model, given
 * only the rendered `summary_markdown`, walk the same menu — or does it do what
 * broke the MAR-363 demo takes and freelance the workflow in chat?
 *
 * Design rules that make the answer meaningful:
 *   • The model is told NOTHING about which option is correct beyond what the
 *     menu itself renders. No fixture names, no golden actions, no hints.
 *   • The planner is driven through `planForJourney` — the exact entry point the
 *     mechanical client uses — so a diff measures the client, not the harness.
 *   • Clarifying answers come from the fixture's `canned_answers`, identical to
 *     the mechanical run. The model's job is to DECIDE to ask the user, not to
 *     invent the user's answer; holding the answer text fixed keeps the diff
 *     apples-to-apples.
 *   • Invariants (`assertAttendedDryRun`, brief/runtime terminal contracts) are
 *     imported, never restated — one definition, two clients.
 *
 * Observe-only, like the mechanical harness: this client never steers the
 * planner and never edits the menu to make itself pass.
 */
import type { RegistrySnapshot } from "../graph/routeComposer.js";
import type { PlanWorkflowOutput } from "../tools/planWorkflow.js";
import {
  planForJourney,
  assertAttendedDryRun,
  followBuildBrief,
  followPrepareRuntime,
  type JourneyFixture,
  type JourneyTerminal,
} from "./mechanicalClient.js";
import { parseMenu, clickIdToMenuAction, optionForLetter, type MenuActionId, type MenuOption } from "./menu.js";
import { classifyTurn, type Deviation } from "./deviation.js";

/** Same cap as the mechanical client, so neither side can out-loop the other. */
const MAX_CLARIFYING_ROUNDS = 6;

/** A minimal chat interface so the walk can be driven by a stub in offline tests. */
export type ChatFn = (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;

/** What the model is asked to return each turn. */
export type ClientChoice = {
  /** The menu letter the client picked, or null when it chose to ask the user. */
  letter: string | null;
  /** True when the client chose to relay the clarifying questions to the user. */
  answer_clarifying_questions: boolean;
  /** The client's free-text reply to the user — scanned for freelancing. */
  reply: string;
  /** The client's own stated reason, recorded verbatim for the report. */
  rationale: string;
};

export type LlmTurn = {
  round: number;
  golden_action: MenuActionId | "answer_clarifying_questions";
  chosen_action: MenuActionId | "answer_clarifying_questions" | "off_menu";
  chosen_letter: string | null;
  menu: Array<{ letter: string; action_id: MenuActionId }>;
  rationale: string;
  deviation: Deviation;
};

export type LlmJourneyResult = {
  fixture: string;
  model: string;
  turns: LlmTurn[];
  /** Terminal the LLM actually reached, or null if it never reached one. */
  terminal: JourneyTerminal | null;
  /** Rounds of planning the LLM took (mechanical golden compared separately). */
  plan_rounds: number;
  /** Populated when a shared invariant threw during the LLM's run. */
  invariant_error: string | null;
  /** Raw replies, kept so a human can read what the model actually said. */
  raw_replies: string[];
};

export const SYSTEM_PROMPT = [
  "You are an MCP client assisting a user who is designing an AI agent workflow.",
  "You have just called the `plan_workflow` tool and received its rendered response.",
  "",
  "Your job is to decide the SINGLE next step, exactly as a well-behaved client would:",
  "read the response, and either pick one lettered option from its menu, or — if the",
  "response asks quick clarifying questions — relay those questions to the user.",
  "",
  "You do NOT implement the workflow yourself. You do NOT write code. You do NOT claim",
  "anything has been built, created, scheduled, or deployed. You only choose the next step.",
  "",
  "Respond with a single JSON object and nothing else:",
  "{",
  '  "letter": "<the menu letter you pick, or null if you are asking the user the quick questions>",',
  '  "answer_clarifying_questions": <true if you are relaying the quick questions to the user, else false>,',
  '  "reply": "<what you would say to the user, in plain text>",',
  '  "rationale": "<why you chose this, one or two sentences>"',
  "}",
].join("\n");

/**
 * The user-turn prompt. Exported so `--print-prompt` can emit the exact text the
 * harness would send, for pasting into a chat UI to sanity-check a model by hand
 * before spending a full scripted run on it.
 */
export function userPrompt(plan: PlanWorkflowOutput): string {
  const questions = plan.clarifying_questions;
  const parts = ["Here is the `plan_workflow` response:", "", plan.summary_markdown];
  if (questions.length > 0) {
    parts.push(
      "",
      "The response includes these quick clarifying questions (ids given so you can refer to them):",
      ...questions.map((q) => `- ${q.id}: ${q.question}`),
    );
  }
  parts.push("", "Choose the single next step now. Reply with the JSON object only.");
  return parts.join("\n");
}

/**
 * Pull the JSON object out of a model reply. Models wrap JSON in prose or fences
 * often enough that failing the run on that would measure formatting, not
 * behaviour — but a reply with no parseable object at all IS a finding, so this
 * returns null and the caller records it as an off-menu turn.
 */
export function parseClientChoice(raw: string): ClientChoice | null {
  // Order matters. A freelancing client puts CODE FENCES inside its own `reply`
  // field, so extracting the first fenced block before trying the envelope makes
  // the worst-behaved replies unparseable — and they would then be misgraded as
  // "invented an option" instead of "freelanced the build", which is the exact
  // distinction this harness exists to draw. So: whole string first, fences only
  // as a fallback for models that wrap the envelope itself.
  const candidates: string[] = [raw.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fenced) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<ClientChoice>;
      return {
        letter:
          typeof parsed.letter === "string" && parsed.letter.trim().length > 0
            ? parsed.letter.trim()
            : null,
        answer_clarifying_questions: parsed.answer_clarifying_questions === true,
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function chosenActionOf(choice: ClientChoice | null, menu: MenuOption[]): {
  action: MenuActionId | "answer_clarifying_questions" | "off_menu";
  letter: string | null;
} {
  if (choice === null) return { action: "off_menu", letter: null };
  if (choice.answer_clarifying_questions && choice.letter === null) {
    return { action: "answer_clarifying_questions", letter: null };
  }
  if (choice.letter === null) return { action: "off_menu", letter: null };
  const option = optionForLetter(menu, choice.letter);
  if (!option) return { action: "off_menu", letter: choice.letter };
  return { action: option.action_id, letter: option.letter };
}

/**
 * Walk one fixture with a real (or stubbed) model and record every turn.
 *
 * Never throws on model misbehaviour — misbehaviour is the measurement. It only
 * surfaces shared-invariant failures via `invariant_error`, because those are
 * planner drift rather than client freelancing and must not be misattributed.
 */
export async function runLlmJourney(
  fixture: JourneyFixture,
  registry: RegistrySnapshot,
  chat: ChatFn,
  model: string,
): Promise<LlmJourneyResult> {
  const turns: LlmTurn[] = [];
  const rawReplies: string[] = [];
  let goal = fixture.goal;
  let current = planForJourney(goal, registry);
  let round = 0;
  let terminal: JourneyTerminal | null = null;
  let invariantError: string | null = null;

  for (;;) {
    const menu = parseMenu(current.summary_markdown);
    const goldenAction = clickIdToMenuAction(
      current.goal_to_product_wizard.recommended_next_click.id,
    );

    const raw = await chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(current) },
    ]);
    rawReplies.push(raw);

    const choice = parseClientChoice(raw);
    const { action, letter } = chosenActionOf(choice, menu);

    turns.push({
      round,
      golden_action: goldenAction,
      chosen_action: action,
      chosen_letter: letter,
      menu: menu.map((o) => ({ letter: o.letter, action_id: o.action_id })),
      rationale: choice?.rationale ?? "(unparseable reply)",
      deviation: classifyTurn({
        goldenAction,
        chosenAction: action,
        chosenLetter: letter,
        menu,
        replyText: choice?.reply ?? raw,
      }),
    });

    // Relaying the quick questions: fold in the SAME canned user answers the
    // mechanical client uses, then re-plan. Identical inputs, so any divergence
    // downstream is the client's, not the fixture's.
    if (action === "answer_clarifying_questions") {
      if (round >= MAX_CLARIFYING_ROUNDS) break;
      for (const q of current.clarifying_questions) {
        const canned = fixture.canned_answers[q.id];
        if (canned === undefined) break;
        goal = `${goal} ${canned}`;
      }
      round += 1;
      current = planForJourney(goal, registry);
      continue;
    }

    // Any other choice ends this client's journey. Terminal deliverables are
    // executed through the SHARED followers so the LLM run is held to the same
    // contract the mechanical golden is.
    try {
      assertAttendedDryRun(current, `${fixture.name}:llm`);
      if (action === "build_brief") {
        followBuildBrief(current, `${fixture.name}:llm`);
        terminal = "build_brief";
      } else if (action === "prepare_runtime") {
        followPrepareRuntime(current, `${fixture.name}:llm`);
        terminal = "prepare_runtime";
      }
    } catch (err) {
      invariantError = err instanceof Error ? err.message : String(err);
    }
    break;
  }

  return {
    fixture: fixture.name,
    model,
    turns,
    terminal,
    plan_rounds: round + 1,
    invariant_error: invariantError,
    raw_replies: rawReplies,
  };
}

/**
 * OpenRouter-backed `ChatFn`. Temperature is pinned to 0 to remove the one
 * source of variance we can control; the run is still not reproducible, which is
 * exactly why `pnpm journey:llm` is kept out of `pnpm verify`.
 */
export function openRouterChat(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): ChatFn {
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
  return async (messages) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
        "X-Title": "OrchestrateKit golden-journey harness",
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`OpenRouter returned no message content: ${JSON.stringify(body).slice(0, 400)}`);
    }
    return content;
  };
}
