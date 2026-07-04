import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { loadProbes, runProbe } from "../../src/graph/nodeProbes.js";

/**
 * Node-probe regression suite (MAR-125 / TEST-01).
 *
 * Single-capability goals run through the full composeRoute (matcher + safety
 * augmenter + ordering). These are FIXTURES (Track A), not logged sessions.
 * Shares benchmarks/node-probes.yaml with `pnpm probe`.
 *
 * `xfail: true` probes document an open bug (see `finding`): they are allowed to
 * fail, but if one starts PASSING this suite fails so the marker can be removed.
 */

const probes = loadProbes();
const registry = loadRegistry({ includeBeta: false });

describe("node probes (MAR-125)", () => {
  it("has a non-trivial probe set", () => {
    expect(probes.length).toBeGreaterThanOrEqual(15);
  });

  it("has unique probe ids", () => {
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const probe of probes) {
    describe(probe.id, () => {
      const r = runProbe(probe, registry);

      if (probe.xfail) {
        it(`is a known xfail (${probe.finding ?? "untracked"}) — should still fail`, () => {
          expect(
            r.passed,
            `${probe.id} now PASSES — remove xfail and close ${probe.finding ?? "the finding"}`,
          ).toBe(false);
        });
        return;
      }

      it("includes every must_have component", () => {
        expect(r.missing, `${probe.id} missing: ${r.missing.join(", ")}`).toEqual([]);
      });

      it("leaks no forbidden component", () => {
        expect(r.leaked, `${probe.id} leaked: ${r.leaked.join(", ")}`).toEqual([]);
      });

      it("matches no forbidden playbook", () => {
        expect(
          r.leaked_playbook,
          `${probe.id} matched forbidden playbook: ${r.leaked_playbook.join(", ")}`,
        ).toEqual([]);
      });

      it("selects the required playbook when one is pinned", () => {
        expect(
          r.missing_playbook,
          `${probe.id} did not select required playbook: ${r.missing_playbook.join(", ")}`,
        ).toEqual([]);
      });
    });
  }
});
