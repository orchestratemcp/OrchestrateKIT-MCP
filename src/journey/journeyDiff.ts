/**
 * MAR-387 (real-LLM variant) — the per-fixture diff report.
 *
 * Diffs a real model's walk against the mechanical golden for the SAME fixture
 * and answers the three questions the harness exists to answer:
 *   1. Did it reach the same terminal deliverable?
 *   2. Did it take the same number of turns?
 *   3. Did it stay on the menu — no invented steps, no workflow executed in chat,
 *      no faked completion?
 *
 * The mechanical golden is computed LIVE (not read from a checked-in snapshot),
 * so when the planner's ⭐ contract moves, both sides move together and this
 * report keeps comparing like with like instead of drifting against a stale
 * pinned baseline.
 */
import type { JourneyTranscript } from "./mechanicalClient.js";
import type { LlmJourneyResult } from "./llmClient.js";
import type { ViolationCode } from "./deviation.js";

export type JourneyVerdict =
  | "match"
  | "legitimate_alternative"
  | "contract_violation";

export type JourneyDiff = {
  fixture: string;
  model: string;
  verdict: JourneyVerdict;
  terminal: { golden: string; llm: string | null; same: boolean };
  turns: { golden: number; llm: number; same: boolean };
  /** Distinct contract violations across all turns. */
  violations: ViolationCode[];
  /** Heuristic signals that fired, for human audit. */
  signals: string[];
  /** One line per turn, for the printed report. */
  turn_notes: string[];
  /** Set when a shared invariant threw during the LLM run (planner drift). */
  invariant_error: string | null;
};

/** Count the golden's planning rounds — plan steps in the mechanical transcript. */
function goldenPlanRounds(golden: JourneyTranscript): number {
  return golden.steps.filter((s) => s.kind === "plan").length;
}

export function diffJourney(
  golden: JourneyTranscript,
  llm: LlmJourneyResult,
): JourneyDiff {
  const violations = [
    ...new Set(llm.turns.flatMap((t) => t.deviation.violations)),
  ];
  const signals = [...new Set(llm.turns.flatMap((t) => t.deviation.signals))];

  const goldenTurns = goldenPlanRounds(golden);
  const sameTerminal = llm.terminal === golden.terminal;
  const sameTurns = llm.plan_rounds === goldenTurns;

  // A violation anywhere dominates. Otherwise, a different-but-real menu choice
  // (or a resulting different terminal) is a legitimate alternative, not a bug.
  let verdict: JourneyVerdict;
  if (violations.length > 0) {
    verdict = "contract_violation";
  } else if (llm.turns.every((t) => t.deviation.kind === "match") && sameTerminal && sameTurns) {
    verdict = "match";
  } else {
    verdict = "legitimate_alternative";
  }

  const turnNotes = llm.turns.map(
    (t) =>
      `  turn ${t.round}: ⭐ ${t.golden_action} · client ${t.chosen_action}` +
      `${t.chosen_letter ? ` (${t.chosen_letter})` : ""} → ${t.deviation.kind}` +
      `${t.deviation.violations.length > 0 ? ` [${t.deviation.violations.join(", ")}]` : ""}`,
  );

  return {
    fixture: golden.fixture,
    model: llm.model,
    verdict,
    terminal: { golden: golden.terminal, llm: llm.terminal, same: sameTerminal },
    turns: { golden: goldenTurns, llm: llm.plan_rounds, same: sameTurns },
    violations,
    signals,
    turn_notes: turnNotes,
    invariant_error: llm.invariant_error,
  };
}

const VERDICT_MARK: Record<JourneyVerdict, string> = {
  match: "✅",
  legitimate_alternative: "🟡",
  contract_violation: "❌",
};

/** Render the diff set as a human-readable report. */
export function formatReport(diffs: JourneyDiff[]): string {
  const lines: string[] = [
    "",
    "═".repeat(72),
    "MAR-387 real-LLM golden journey — diff vs mechanical golden",
    "═".repeat(72),
  ];

  for (const d of diffs) {
    lines.push(
      "",
      `${VERDICT_MARK[d.verdict]} ${d.fixture}  [${d.model}]  → ${d.verdict}`,
      `  terminal: golden=${d.terminal.golden} llm=${d.terminal.llm ?? "none"} ${d.terminal.same ? "(same)" : "(DIFFERS)"}`,
      `  turns:    golden=${d.turns.golden} llm=${d.turns.llm} ${d.turns.same ? "(same)" : "(DIFFERS)"}`,
      ...d.turn_notes,
    );
    if (d.violations.length > 0) lines.push(`  violations: ${d.violations.join(", ")}`);
    if (d.signals.length > 0) lines.push(`  signals:    ${d.signals.join(", ")}`);
    if (d.invariant_error) lines.push(`  ⚠ invariant error (planner drift, not client): ${d.invariant_error}`);
  }

  const violations = diffs.filter((d) => d.verdict === "contract_violation");
  const alternatives = diffs.filter((d) => d.verdict === "legitimate_alternative");
  const matches = diffs.filter((d) => d.verdict === "match");

  lines.push(
    "",
    "─".repeat(72),
    `${matches.length} matched ⭐ · ${alternatives.length} legitimate alternative · ${violations.length} contract violation`,
    violations.length > 0
      ? `❌ Contract violations: ${violations.map((d) => d.fixture).join(", ")}`
      : "✅ No contract violations — the client walked the menu on every fixture.",
    "─".repeat(72),
    "",
  );

  return lines.join("\n");
}
