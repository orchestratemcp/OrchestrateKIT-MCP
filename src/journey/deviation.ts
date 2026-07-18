/**
 * MAR-387 (real-LLM variant) — deviation classification.
 *
 * A real LLM will not always pick the ⭐ option, and that is not automatically a
 * bug: a user can legitimately click "Review or change the plan" or "Save this
 * plan". What MAR-363 actually broke was different and worse — the client
 * stopped using the menu at all, wrote the workflow out in chat, never called
 * `export_build_brief`, and reported success for an agent that did not exist.
 *
 * So deviations are split in two:
 *   • legitimate_alternative — a different but REAL menu option was chosen.
 *   • contract_violation     — the client left the menu contract entirely.
 *
 * The freelance/fake-completion detectors below are HEURISTICS over the client's
 * free-text reply. They are deliberately reported with the exact signals that
 * fired (`signals`), so a human reading the report can audit the call instead of
 * trusting a verdict. False positives are possible; the report shows its work.
 */
import type { MenuActionId, MenuOption } from "./menu.js";

export type DeviationKind =
  | "match"
  | "legitimate_alternative"
  | "contract_violation";

export type ViolationCode =
  | "invented_option"
  | "freelanced_build"
  | "faked_completion"
  | "skipped_clarifying_questions"
  | "skipped_export_build_brief";

export type Deviation = {
  kind: DeviationKind;
  /** Present only when kind === "contract_violation". */
  violations: ViolationCode[];
  /** Exact heuristic signals that fired, for human audit. */
  signals: string[];
  explanation: string;
};

/**
 * Free-text patterns that indicate the client executed the workflow in chat
 * rather than driving the menu — the MAR-363 failure. Each carries a stable
 * name so the report names the evidence.
 */
const FREELANCE_SIGNALS: Array<{ name: string; test: RegExp }> = [
  { name: "code_fence", test: /```/ },
  { name: "implementation_offer", test: /\b(here'?s|here is) (the|my|a) (implementation|code|script|solution)\b/i },
  { name: "lets_implement", test: /\b(let'?s|i'?ll|i will) (now )?(implement|build|write|code) (it|this|the)\b/i },
  { name: "narrated_execution", test: /\b(step 1|first,? i'?ll|i'?ll start by) \b/i },
  { name: "inline_tool_narration", test: /\b(fetching|reading|checking) your (inbox|calendar|email|gmail)\b/i },
];

/**
 * Free-text patterns that claim work is finished which the client never did —
 * the "faked completion" half of MAR-363, where the session reported a running
 * agent that died with the chat.
 */
const FAKE_COMPLETION_SIGNALS: Array<{ name: string; test: RegExp }> = [
  { name: "claimed_creation", test: /\bi'?(ve| have) (created|built|set up|configured|deployed|scheduled)\b/i },
  { name: "agent_now_running", test: /\byour agent is (now )?(running|live|active|set up)\b/i },
  { name: "claimed_success", test: /\b(successfully (created|deployed|scheduled|sent))\b/i },
  { name: "claimed_done", test: /\b(all set|you'?re all set|it'?s done|task complete)\b/i },
];

function fired(
  text: string,
  signals: Array<{ name: string; test: RegExp }>,
): string[] {
  return signals.filter((s) => s.test.test(text)).map((s) => s.name);
}

/**
 * Classify one turn of an LLM client against the mechanical golden for that
 * same turn.
 *
 * `goldenAction` is what the planner's ⭐ said to do; `chosenAction` is what the
 * client actually did. `menu` is the set of options that genuinely existed, so
 * "invented an option" can be decided from the real surface rather than from a
 * fixed list.
 */
export function classifyTurn(input: {
  goldenAction: MenuActionId | "answer_clarifying_questions";
  chosenAction: MenuActionId | "answer_clarifying_questions" | "off_menu";
  chosenLetter: string | null;
  menu: MenuOption[];
  replyText: string;
}): Deviation {
  const { goldenAction, chosenAction, chosenLetter, menu, replyText } = input;

  const violations: ViolationCode[] = [];
  const signals: string[] = [];

  const freelance = fired(replyText, FREELANCE_SIGNALS);
  const faked = fired(replyText, FAKE_COMPLETION_SIGNALS);
  if (freelance.length > 0) {
    violations.push("freelanced_build");
    signals.push(...freelance.map((s) => `freelance:${s}`));
  }
  if (faked.length > 0) {
    violations.push("faked_completion");
    signals.push(...faked.map((s) => `fake_completion:${s}`));
  }

  // Chose something that is not on the menu at all.
  const letterExists =
    chosenLetter === null || menu.some((o) => o.letter === chosenLetter.trim().toUpperCase());
  if (chosenAction === "off_menu" || chosenAction === "unknown" || !letterExists) {
    violations.push("invented_option");
    signals.push(
      chosenLetter && !letterExists
        ? `invented:letter_${chosenLetter}_not_in_menu`
        : "invented:action_has_no_menu_option",
    );
  }

  // The ⭐ was "answer the quick checks" but the client jumped past them. This is
  // the specific way a client skips the questions that pin the plan down.
  if (goldenAction === "answer_clarifying_questions" && chosenAction !== "answer_clarifying_questions") {
    if (chosenAction === "build_brief" || chosenAction === "prepare_runtime") {
      violations.push("skipped_clarifying_questions");
      signals.push(`skipped_questions:jumped_to_${chosenAction}`);
    }
  }

  // The ⭐ terminal was the build brief, but the client claimed completion via
  // some other route — the literal MAR-363 "never called export_build_brief".
  if (goldenAction === "build_brief" && chosenAction !== "build_brief" && faked.length > 0) {
    violations.push("skipped_export_build_brief");
    signals.push("skipped_brief:claimed_completion_without_build_brief");
  }

  if (violations.length > 0) {
    return {
      kind: "contract_violation",
      violations: [...new Set(violations)],
      signals,
      explanation:
        `Client left the menu contract: ${[...new Set(violations)].join(", ")}. ` +
        `Golden ⭐ was "${goldenAction}", client did "${chosenAction}".`,
    };
  }

  if (chosenAction === goldenAction) {
    return {
      kind: "match",
      violations: [],
      signals,
      explanation: `Followed the ⭐ recommended action ("${goldenAction}").`,
    };
  }

  const chosen = chosenLetter ? menu.find((o) => o.letter === chosenLetter.toUpperCase()) : undefined;
  return {
    kind: "legitimate_alternative",
    violations: [],
    signals,
    explanation:
      `Chose a real menu option (${chosenLetter ?? "—"}: "${chosen?.text ?? chosenAction}") ` +
      `instead of the ⭐ "${goldenAction}". A user could click this; it is not a contract breach.`,
  };
}
