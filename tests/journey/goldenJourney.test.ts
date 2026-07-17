/**
 * MAR-387 — the golden-journey test.
 *
 * Runs the mechanical client (no LLM, no network) per fixture and:
 *  - snapshots a normalized, timestamp-free journey transcript (structural drift
 *    fails CI; prose churn does not — long strings collapse to "[text]", the same
 *    discipline as tests/tools/outputSchemas.test.ts);
 *  - asserts the journey reaches a terminal deliverable (build brief or runtime
 *    contract) and never lands in an "unknown/unhandled option" state;
 *  - proves determinism: each fixture runs 5× and the RAW transcripts must be
 *    byte-identical — the MAR-363 "5 consecutive identical runs" recording bar,
 *    automated. The test IS the rehearsal.
 *
 * This suite lives under tests/ so `pnpm verify` (which runs `vitest run`) picks
 * it up automatically — no dedicated script.
 */
import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import {
  runMechanicalJourney,
  type JourneyTranscript,
} from "../../src/journey/mechanicalClient.js";
import { JOURNEY_FIXTURES } from "./fixtures/index.js";

const registry = loadRegistry();

/**
 * Collapse long prose to a stable marker and sort object keys so the golden
 * captures journey STRUCTURE (route ids, click ids, terminal shape, section
 * presence) without churning on unrelated planner wording edits — those are
 * responseUxEvals' job, not the journey's.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "string") return value.length > 80 ? "[text]" : value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe("MAR-387 — golden journey (mechanical client, always picks ⭐)", () => {
  for (const fixture of JOURNEY_FIXTURES) {
    describe(fixture.name, () => {
      const transcript = runMechanicalJourney(fixture, registry);

      it("matches the golden transcript snapshot", () => {
        expect(normalize(transcript)).toMatchSnapshot();
      });

      it("reaches a terminal deliverable with no unknown/unhandled option", () => {
        expect(transcript.terminal === "build_brief" || transcript.terminal === "prepare_runtime").toBe(true);
        const last = transcript.steps[transcript.steps.length - 1];
        expect(last.kind).toBe(`terminal:${transcript.terminal}`);
        // Every plan step carried a recommended click the client could follow —
        // runMechanicalJourney throws on an unknown id, so reaching here proves it.
        for (const step of transcript.steps) {
          if (step.kind === "plan") {
            expect(step.recommended_next_click.id.length).toBeGreaterThan(0);
          }
        }
      });

      it("observed the attended dry-run option honestly (never improvised, never steered)", () => {
        const dryRun = transcript.steps.find((s) => s.kind === "attended_dry_run_option");
        expect(dryRun, "attended dry-run option step present").toBeDefined();
        expect(dryRun).toMatchObject({ present: true, honest_disclosure: true });
      });
    });
  }

  // The MAR-363 recording bar, automated: 5 consecutive byte-identical runs.
  it("is deterministic: 5 consecutive runs produce byte-identical transcripts", () => {
    for (const fixture of JOURNEY_FIXTURES) {
      const runs: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        runs.push(JSON.stringify(runMechanicalJourney(fixture, registry)));
      }
      const first = runs[0];
      for (let i = 1; i < runs.length; i += 1) {
        expect(runs[i], `run ${i} of "${fixture.name}" drifted from run 0`).toBe(first);
      }
    }
  });

  it("every fixture ends on a terminal step and carries a dry-run observation", () => {
    // A cross-fixture guard so an accidentally trivial fixture (no plan, no
    // terminal) can't pass silently.
    const seenTerminals = new Set<JourneyTranscript["terminal"]>();
    for (const fixture of JOURNEY_FIXTURES) {
      const t = runMechanicalJourney(fixture, registry);
      seenTerminals.add(t.terminal);
      expect(t.steps.some((s) => s.kind === "plan")).toBe(true);
      expect(t.steps.some((s) => s.kind === "attended_dry_run_option")).toBe(true);
    }
    // The fixture set must exercise BOTH terminal shapes, not just one path.
    expect(seenTerminals.has("build_brief")).toBe(true);
    expect(seenTerminals.has("prepare_runtime")).toBe(true);
  });
});
