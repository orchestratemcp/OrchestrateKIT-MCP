import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { matchCapabilities } from "../../src/graph/capabilityMatcher.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

/**
 * Matcher regression corpus (MAR-106 / LAB-03).
 *
 * The fixture `tests/fixtures/matcher-corpus.json` is generated and exported by
 * OrchestrateLab (`pnpm export:corpus`) and committed here by a human. Each
 * labelled goal pins matcher behaviour:
 *   - must_have  — components that MUST match (guards against false negatives)
 *   - forbidden  — components that MUST NOT match (guards against the known
 *                  false positives in benchmarks/fixtures/false-positives-v1.yaml)
 *
 * A matcher change that reintroduces a known false positive (or drops a required
 * component) fails this suite.
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
}

interface Corpus {
  version: number;
  goal_count: number;
  goals: CorpusGoal[];
}

const REQUIRED_DOMAINS = [
  "research",
  "content_publishing",
  "email_calendar",
  "data_etl",
  "code_agent",
  "crm_sales",
  "monitoring",
];

const corpusPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/matcher-corpus.json",
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

const { components, edges } = loadRegistry();

function matchedIds(goal: string): string[] {
  return matchCapabilities(goal, [], [], components, edges).matches.map(
    (m) => m.component.id,
  );
}

describe("matcher regression corpus (MAR-106)", () => {
  it("has at least 20 labelled goals", () => {
    expect(corpus.goals.length).toBeGreaterThanOrEqual(20);
    expect(corpus.goal_count).toBe(corpus.goals.length);
  });

  it("covers every matcher domain", () => {
    const domains = new Set(corpus.goals.map((g) => g.domain));
    for (const d of REQUIRED_DOMAINS) {
      expect(domains, `corpus is missing domain ${d}`).toContain(d);
    }
  });

  it("has unique slugs", () => {
    const slugs = corpus.goals.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const goal of corpus.goals) {
    describe(goal.slug, () => {
      const ids = matchedIds(goal.goal);

      it("matches all must_have components", () => {
        for (const id of goal.must_have) {
          expect(ids, `${goal.slug}: must_have "${id}" not matched`).toContain(
            id,
          );
        }
      });

      it("excludes all forbidden components (no false positives)", () => {
        for (const id of goal.forbidden) {
          expect(
            ids,
            `${goal.slug}: forbidden "${id}" leaked into matches`,
          ).not.toContain(id);
        }
      });
    });
  }
});
