import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

/**
 * Composed-route corpus contracts (MAR-260 / FLYWHEEL-03).
 *
 * matcherCorpus.test.ts asserts `level: "raw"` goals against the raw
 * capability matcher. This suite asserts `level: "composed"` goals against
 * the FULL plan_workflow compose path — the surface real clients see, where
 * the audit-class failures live (augmenter injections, top-N truncation,
 * playbook selection, execution ordering).
 *
 * Deliberate overlap with benchmarks/node-probes.yaml: probes are handpicked
 * single-capability checks; these are real-goal contracts exported by the
 * Lab (`pnpm export:corpus`) and committed by a human.
 *
 * xfail semantics mirror node-probes: a goal with a non-empty `xfail` is
 * EXPECTED to break its contract (staged behind the pending fix named in the
 * string). If it starts passing, this suite fails — promote the contract in
 * the Lab corpus (move the staged ids into the main row, clear the xfail).
 */

interface CorpusGoal {
  slug: string;
  goal: string;
  domain: string;
  must_have: string[];
  nice_to_have: string[];
  forbidden: string[];
  missing_but_expected: string[];
  source: string;
  level?: "raw" | "composed";
  xfail?: string;
}

interface Corpus {
  version: number;
  goal_count: number;
  goals: CorpusGoal[];
}

const corpusPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/matcher-corpus.json",
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

const registry = loadRegistry();
const knownIds = new Set(
  (registry as { components: Array<{ id: string }> }).components.map(
    (c) => c.id,
  ),
);

const composedGoals = corpus.goals.filter((g) => g.level === "composed");

function routeIds(goal: string): string[] {
  const result = planWorkflow(
    { goal, must_have_capabilities: [], must_avoid: [] },
    registry,
  );
  return result.recommended_route.map((s) => s.component_id);
}

describe("composed corpus contracts (MAR-260)", () => {
  // A contract naming a component the registry doesn't have would silently
  // never-match (must_have) or vacuously pass (forbidden). Fail loudly at
  // load time instead — unless the row is xfail (staged for a future fix).
  it("non-xfail composed contracts reference only known component ids", () => {
    for (const g of composedGoals) {
      if (g.xfail) continue;
      for (const id of [...g.must_have, ...g.forbidden]) {
        expect(
          knownIds.has(id),
          `${g.slug}: unknown component id "${id}" in contract`,
        ).toBe(true);
      }
    }
  });

  if (composedGoals.length === 0) {
    // Order-independent with the Lab export: the suite is a no-op until the
    // fixture carries composed-level rows.
    it("has no composed-level goals in the fixture (nothing to enforce yet)", () => {
      expect(composedGoals).toEqual([]);
    });
  }

  for (const goal of composedGoals) {
    describe(goal.slug, () => {
      const ids = routeIds(goal.goal);
      const missing = goal.must_have.filter((id) => !ids.includes(id));
      const leaked = goal.forbidden.filter((id) => ids.includes(id));

      if (!goal.xfail) {
        it("composed route includes all must_have components", () => {
          expect(
            missing,
            `${goal.slug}: must_have missing from composed route [${ids.join(", ")}]`,
          ).toEqual([]);
        });

        it("composed route excludes all forbidden components", () => {
          expect(
            leaked,
            `${goal.slug}: forbidden leaked into composed route [${ids.join(", ")}]`,
          ).toEqual([]);
        });
      } else {
        it(`xfail (${goal.xfail}): contract still fails as expected`, () => {
          const broken = missing.length > 0 || leaked.length > 0;
          expect(
            broken,
            `${goal.slug}: xfail contract now PASSES — the pending fix landed. ` +
              `Promote the contract in the Lab corpus (merge staged ids into ` +
              `the main row, clear xfail) and re-export.`,
          ).toBe(true);
        });
      }
    });
  }
});
