/**
 * MAR-387 — the menu contract, parsed from the rendered `summary_markdown`.
 *
 * The whole point of the golden journey is that a client should WALK THE MENU.
 * That contract only means something if the menu is machine-readable off the
 * RENDERED markdown — the surface a client actually sees — rather than off an
 * internal field a real client never reads. This module turns the "How do you
 * want to continue?" block into lettered options with a semantic action id, so a
 * client's answer ("C") can be compared against `recommended_next_click.id`
 * without either side hardcoding per-fixture expectations.
 *
 * Scope note: the MCP owns *parseability* — it guarantees its own menu can be
 * read back. Grading whether a given client made an acceptable choice is the
 * Lab's job, since the Lab owns the model gateway and the run history. The MCP
 * stays deterministic: no LLM, no network, no key.
 *
 * Two menu shapes exist today (see planWorkflow's next-action menu): a
 * runtime-first menu (A = the next achievable setup step) and an artifact menu
 * (C = the build prompt). Rather than encode "A means runtime in menu shape 1",
 * each line is classified by its own text, so a re-ordered or re-lettered menu
 * keeps resolving correctly — and an option that stops matching surfaces as
 * `unknown` instead of silently grading as something else.
 */

/** Semantic action behind a lettered menu option. */
export type MenuActionId =
  | "prepare_runtime"
  | "build_brief"
  | "attended_dry_run"
  | "save_plan"
  | "handoff_prompt"
  | "review_plan"
  | "technical_plan"
  | "unknown";

export type MenuOption = {
  letter: string;
  text: string;
  action_id: MenuActionId;
  /** True when the menu itself marks this line as the recommended pick. */
  marked_recommended: boolean;
};

/**
 * Text signatures for each menu line, in priority order. These mirror the
 * literal strings planWorkflow renders; a wording change that breaks one shows
 * up as an `unknown` option (loud) rather than a misgraded run (silent).
 */
const ACTION_SIGNATURES: Array<{ id: MenuActionId; test: RegExp }> = [
  { id: "attended_dry_run", test: /^Run it attended in this chat now/i },
  { id: "build_brief", test: /^Turn it into a build prompt/i },
  { id: "handoff_prompt", test: /^Generate a portable agent handoff prompt/i },
  { id: "save_plan", test: /^Save this plan to/i },
  { id: "review_plan", test: /^Review or change/i },
  { id: "technical_plan", test: /^Show the technical plan/i },
  // The runtime-first menu renders A) as "<setup label> — Next achievable step";
  // the label itself is goal-derived, so the suffix is the stable signal.
  { id: "prepare_runtime", test: /—\s*Next achievable step\s*$/i },
];

function classifyOptionText(text: string): MenuActionId {
  for (const sig of ACTION_SIGNATURES) {
    if (sig.test.test(text)) return sig.id;
  }
  return "unknown";
}

const MENU_HEADING = /^###\s+How do you want to continue\?/m;
const OPTION_LINE = /^([A-Z])\)\s+(.+)$/;

/**
 * Extract the lettered options from a plan's `summary_markdown`. Returns an
 * empty array when the plan renders no menu at all — a caller that expected a
 * menu should treat that as a contract failure, not as "no options".
 */
export function parseMenu(summaryMarkdown: string): MenuOption[] {
  const headingMatch = MENU_HEADING.exec(summaryMarkdown);
  if (!headingMatch) return [];

  const after = summaryMarkdown.slice(headingMatch.index + headingMatch[0].length);
  const options: MenuOption[] = [];
  for (const rawLine of after.split("\n")) {
    const line = rawLine.trim();
    // The menu block ends at the next markdown heading or blockquote note.
    if (line.startsWith("#") || line.startsWith(">")) break;
    const match = OPTION_LINE.exec(line);
    if (!match) continue;
    const [, letter, text] = match;
    options.push({
      letter,
      text,
      action_id: classifyOptionText(text),
      marked_recommended: /—\s*Recommended\b/i.test(text),
    });
  }
  return options;
}

/**
 * Map the planner's machine-readable `recommended_next_click.id` onto the menu
 * action vocabulary. `answer_clarifying_questions` deliberately has no menu
 * letter — at that stage the ⭐ move is to answer the "Quick checks" block, and
 * the menu below it is not yet the right thing to click. Modelling that as its
 * own action (rather than forcing it onto a letter) is what lets the harness
 * catch a client that skips the questions and jumps to a terminal.
 */
export function clickIdToMenuAction(clickId: string): MenuActionId | "answer_clarifying_questions" {
  if (clickId === "answer_clarifying_questions") return "answer_clarifying_questions";
  if (clickId === "prepare_runtime") return "prepare_runtime";
  if (clickId === "build_brief") return "build_brief";
  return "unknown";
}

/** Find the option a client's letter refers to, if the letter exists at all. */
export function optionForLetter(menu: MenuOption[], letter: string): MenuOption | undefined {
  const wanted = letter.trim().toUpperCase();
  return menu.find((o) => o.letter === wanted);
}
