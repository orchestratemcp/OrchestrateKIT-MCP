/**
 * MAR-387 (real-LLM variant) — `pnpm journey:llm`.
 *
 * Drives the golden-journey fixtures through a REAL model via OpenRouter and
 * diffs its choices against the mechanical golden.
 *
 * This is deliberately NOT part of `pnpm verify` and CI does not run it: it is
 * paid, networked and non-reproducible, and a flaky live model must never be
 * able to fail the build. The offline half of this harness (menu parsing,
 * deviation classification, the stubbed walk) IS covered by
 * `tests/journey/llmJourney.test.ts`, which CI does run.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... pnpm journey:llm
 *   OPENROUTER_API_KEY=sk-or-... pnpm journey:llm --model anthropic/claude-sonnet-4.5
 *   pnpm journey:llm --json          # machine-readable report on stdout
 *
 * Exit code is 1 only on a CONTRACT VIOLATION — a legitimate alternative choice
 * is reported, not punished, because a user could genuinely click that option.
 */
import { loadRegistry } from "../src/registry/registryLoader.js";
import { runMechanicalJourney, planForJourney } from "../src/journey/mechanicalClient.js";
import {
  runLlmJourney,
  openRouterChat,
  SYSTEM_PROMPT,
  userPrompt,
} from "../src/journey/llmClient.js";
import { diffJourney, formatReport, type JourneyDiff } from "../src/journey/journeyDiff.js";
import { JOURNEY_FIXTURES } from "../tests/journey/fixtures/index.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * `--print-prompt [fixture]` emits the exact system + user turn the harness would
 * send, without calling any API. Paste it into any chat UI to hand-check a model
 * before spending a scripted run on it.
 */
function printPrompt(): void {
  const wanted = argValue("--print-prompt");
  const fixture =
    (wanted && JOURNEY_FIXTURES.find((f) => f.name === wanted)) ?? JOURNEY_FIXTURES[0];
  const plan = planForJourney(fixture.goal, loadRegistry());

  console.log(`# fixture: ${fixture.name}`);
  console.log(`# ⭐ the harness expects: ${plan.goal_to_product_wizard.recommended_next_click.id}`);
  console.log(`# (do NOT paste the line above to the model — it is the answer key)`);
  console.log("\n───────── SYSTEM ─────────\n");
  console.log(SYSTEM_PROMPT);
  console.log("\n───────── USER ─────────\n");
  console.log(userPrompt(plan));
}

async function main(): Promise<void> {
  if (process.argv.includes("--print-prompt")) {
    printPrompt();
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      "OPENROUTER_API_KEY is not set.\n" +
        "This harness makes real, paid model calls; it is intentionally excluded from `pnpm verify`.\n" +
        "Set the key and re-run:  OPENROUTER_API_KEY=sk-or-... pnpm journey:llm",
    );
    process.exitCode = 2;
    return;
  }

  const model = argValue("--model") ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const asJson = process.argv.includes("--json");
  const registry = loadRegistry();
  // OPENROUTER_BASE_URL lets this run against a proxy/gateway, and lets the
  // runner's HTTP path be exercised against a local stub without spending money.
  const chat = openRouterChat({ apiKey, model, baseUrl: process.env.OPENROUTER_BASE_URL });

  const diffs: JourneyDiff[] = [];
  for (const fixture of JOURNEY_FIXTURES) {
    if (!asJson) console.error(`→ ${fixture.name} …`);
    // The golden is computed live, so it tracks the planner's current ⭐
    // contract instead of a snapshot that can go stale under it.
    const golden = runMechanicalJourney(fixture, registry);
    const llm = await runLlmJourney(fixture, registry, chat, model);
    diffs.push(diffJourney(golden, llm));
  }

  if (asJson) {
    console.log(JSON.stringify({ model, diffs }, null, 2));
  } else {
    console.log(formatReport(diffs));
  }

  const violated = diffs.some((d) => d.verdict === "contract_violation");
  // Set exitCode rather than calling process.exit(): a hard exit while fetch
  // keep-alive sockets are still open aborts the process on Windows (libuv
  // "UV_HANDLE_CLOSING" assertion) and reports 127 instead of the real code,
  // which would make this script's pass/fail unreadable to any caller.
  process.exitCode = violated ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
