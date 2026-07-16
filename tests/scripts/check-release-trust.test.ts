import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeCountFloorFailures,
  computeFingerprintFailure,
} from "../../scripts/check-release-trust.js";
import {
  MIN_COMPONENTS,
  MIN_EDGES,
  MIN_ROUTES,
  MIN_PLAYBOOKS,
  EXPECTED_RELEASE_FINGERPRINT,
} from "../../src/config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// P0-06: scripts/check-release-trust.ts is a self-executing script (it
// process.exit(1)s on failure), so its checks are extracted into pure,
// side-effect-free functions guarded behind an isMainModule check — importing
// this module in tests must never run the real gate against disk/git state.
// These tests exercise exactly those pure functions.
describe("scripts/check-release-trust.ts (P0-06)", () => {
  describe("computeCountFloorFailures", () => {
    it("is empty when every count meets its floor", () => {
      const failures = computeCountFloorFailures({
        component_count: MIN_COMPONENTS,
        edge_count: MIN_EDGES,
        route_count: MIN_ROUTES,
        playbook_count: MIN_PLAYBOOKS,
      });
      expect(failures).toHaveLength(0);
    });

    it("flags a below-floor route_count and playbook_count (P0-06)", () => {
      const failures = computeCountFloorFailures({
        component_count: MIN_COMPONENTS,
        edge_count: MIN_EDGES,
        route_count: MIN_ROUTES - 1,
        playbook_count: MIN_PLAYBOOKS - 1,
      });
      expect(failures).toHaveLength(2);
      expect(failures.join("\n")).toMatch(/route_count/);
      expect(failures.join("\n")).toMatch(/playbook_count/);
    });

    it("flags a below-floor component_count and edge_count (MAR-220)", () => {
      const failures = computeCountFloorFailures({
        component_count: MIN_COMPONENTS - 1,
        edge_count: MIN_EDGES - 1,
        route_count: MIN_ROUTES,
        playbook_count: MIN_PLAYBOOKS,
      });
      expect(failures).toHaveLength(2);
      expect(failures.join("\n")).toMatch(/component_count/);
      expect(failures.join("\n")).toMatch(/edge_count/);
    });
  });

  describe("computeFingerprintFailure", () => {
    it("returns null when the fingerprint matches the pinned expected release", () => {
      expect(computeFingerprintFailure(EXPECTED_RELEASE_FINGERPRINT)).toBeNull();
    });

    // Acceptance criterion (P0-06): a stale-fingerprint build reports a demo
    // blocker even though every count floor could still be cleared — count
    // floors alone cannot distinguish "a smaller registry" from "the wrong
    // registry", only the pinned fingerprint can.
    it("returns an actionable failure when the fingerprint does not match (stale build)", () => {
      const failure = computeFingerprintFailure("deadbeefdeadbeef");
      expect(failure).not.toBeNull();
      expect(failure).toContain("deadbeefdeadbeef");
      expect(failure).toContain(EXPECTED_RELEASE_FINGERPRINT);
      expect(failure).toMatch(/EXPECTED_RELEASE_FINGERPRINT/);
    });
  });

  // End-to-end: run the actual gate script (not just the pure helpers) so the
  // acceptance criterion — "current build stays green" — is proven against
  // the real, checked-out registry rather than a mock.
  describe("the real gate, run end-to-end", () => {
    beforeAll(() => {
      // Ensure the generated bundle exists and is in sync, independent of
      // whether `pnpm gen:registry` already ran in this test invocation.
      execFileSync("pnpm", ["gen:registry"], { cwd: ROOT, stdio: "ignore" });
    }, 60_000);

    it("passes (exit 0) against the current checked-out registry", () => {
      expect(() =>
        execFileSync("npx", ["tsx", "scripts/check-release-trust.ts"], {
          cwd: ROOT,
          stdio: "pipe",
        }),
      ).not.toThrow();
    }, 60_000);
  });
});
