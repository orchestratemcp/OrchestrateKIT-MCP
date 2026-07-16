/**
 * Release-trust gate (MAR-220, extended by P0-06).
 *
 * Five checks, run in CI via `pnpm verify`:
 *
 *   1. The generated registry/docs bundles are NOT tracked in git. They are
 *      gitignored build artifacts (like dist/) — committing them re-introduces
 *      the stale-bundle drift this gate exists to prevent. `gen:registry` /
 *      `deploy:worker` regenerate them on demand.
 *   2. The on-disk generated bundle's content fingerprint matches the YAML
 *      source (mtime-independent, so checkout-stable). Catches a bundle that was
 *      generated from older source — a lying artifact.
 *   3. The source registry meets the published count floors (MIN_COMPONENTS /
 *      MIN_EDGES / MIN_ROUTES / MIN_PLAYBOOKS). Mirrors the health_check
 *      safe_to_demo floors.
 *   4. The source content fingerprint matches EXPECTED_RELEASE_FINGERPRINT
 *      (P0-06). Unlike #3, this pins the EXACT registry snapshot — a build can
 *      clear every count floor and still not be the published release (e.g. an
 *      older or newer, unreleased registry that happens to have "enough" of
 *      everything). Mirrors the health_check matches_expected_release signal.
 *   5. Public release/legal files and package metadata remain present and
 *      aligned with the GitHub repository and product site.
 *
 * Exit 1 on any failure with an actionable message.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readRawEntries, defaultRegistryDir } from "../src/registry/registryLoader.js";
import { assembleRegistry, computeRegistryStatus } from "../src/registry/registryAssembly.js";
import type { RegistryStatus } from "../src/registry/registryTypes.js";
import { contentFingerprint } from "../src/registry/contentFingerprint.js";
import {
  MIN_COMPONENTS,
  MIN_EDGES,
  MIN_ROUTES,
  MIN_PLAYBOOKS,
  EXPECTED_RELEASE_FINGERPRINT,
} from "../src/config.js";

const ROOT = join(defaultRegistryDir(), "..");
const GENERATED_BUNDLES = [
  "src/registry/registryBundle.generated.ts",
  "src/docs-index/bundle.generated.ts",
];
const REQUIRED_PUBLIC_FILES = [
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/releases/v0.1.0.md",
] as const;

/**
 * Pure (MAR-220/P0-06): published count floors. Mirrors
 * `computeDemoBlockers` in src/tools/index.ts — a stale build can still clear
 * MIN_COMPONENTS/MIN_EDGES while missing routes or playbooks added since it
 * was deployed, so each entity type gets its own floor.
 */
export function computeCountFloorFailures(
  status: Pick<RegistryStatus, "component_count" | "edge_count" | "route_count" | "playbook_count">,
): string[] {
  const failures: string[] = [];
  if (status.component_count < MIN_COMPONENTS) {
    failures.push(
      `component_count ${status.component_count} is below the floor ${MIN_COMPONENTS} (MAR-220).`,
    );
  }
  if (status.edge_count < MIN_EDGES) {
    failures.push(`edge_count ${status.edge_count} is below the floor ${MIN_EDGES} (MAR-220).`);
  }
  if (status.route_count < MIN_ROUTES) {
    failures.push(`route_count ${status.route_count} is below the floor ${MIN_ROUTES} (P0-06).`);
  }
  if (status.playbook_count < MIN_PLAYBOOKS) {
    failures.push(
      `playbook_count ${status.playbook_count} is below the floor ${MIN_PLAYBOOKS} (P0-06).`,
    );
  }
  return failures;
}

/**
 * Pure (P0-06): compares a computed content fingerprint against the pinned
 * EXPECTED_RELEASE_FINGERPRINT. Returns null when it matches, an actionable
 * failure message otherwise. This is what makes a stale-fingerprint build
 * (one whose counts are otherwise fully "compatible") fail the gate — count
 * floors alone cannot catch a build that is simply the WRONG registry
 * snapshot rather than a smaller one.
 */
export function computeFingerprintFailure(sourceFingerprint: string): string | null {
  if (sourceFingerprint === EXPECTED_RELEASE_FINGERPRINT) return null;
  return (
    `source content fingerprint ${sourceFingerprint} does not match the pinned release ` +
    `fingerprint ${EXPECTED_RELEASE_FINGERPRINT} (P0-06)\n` +
    "    → if this registry change is intentional, recompute the fingerprint " +
    "(contentFingerprint(readRawEntries())) and update EXPECTED_RELEASE_FINGERPRINT in " +
    "src/config.ts; otherwise this checkout does not match the published release and must " +
    "not be reported safe_to_demo."
  );
}

function isTracked(relPath: string): boolean | null {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true; // exit 0 → tracked
  } catch (err) {
    // git exits non-zero when the path is untracked (expected) OR when this is
    // not a git repo (e.g. an exported tarball). Distinguish: if `git` itself is
    // missing / not a repo, skip the check rather than fail the build.
    const msg = String((err as { stderr?: Buffer }).stderr ?? err);
    if (/not a git repository|not found|ENOENT/i.test(msg)) return null;
    return false; // untracked
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];

  // ── 1. generated bundles must not be tracked in git ──
  let gitAvailable = true;
  for (const rel of GENERATED_BUNDLES) {
    const tracked = isTracked(rel);
    if (tracked === null) {
      gitAvailable = false;
      break;
    }
    if (tracked) {
      failures.push(
        `generated bundle is committed to git: ${rel}\n` +
          "    → it is a build artifact; run `git rm --cached " +
          rel +
          "` (it stays gitignored and is regenerated by `pnpm gen:registry`).",
      );
    }
  }
  if (!gitAvailable) {
    process.stderr.write(
      "release-trust: git not available / not a repo — skipping tracked-bundle check.\n",
    );
  }

  // ── 2. on-disk bundle content fingerprint matches source ──
  const raw = readRawEntries();
  const sourceFingerprint = contentFingerprint(raw);

  const bundlePath = join(ROOT, "src/registry/registryBundle.generated.ts");
  if (!existsSync(bundlePath)) {
    failures.push(
      "registry bundle is missing — run `pnpm gen:registry` before verifying.",
    );
  } else {
    const { BUNDLE } = (await import("../src/registry/registryBundle.generated.js")) as {
      BUNDLE: { content_fingerprint?: string };
    };
    const bundleFingerprint = BUNDLE.content_fingerprint;
    if (!bundleFingerprint) {
      failures.push(
        "registry bundle has no content_fingerprint — regenerate with `pnpm gen:registry`.",
      );
    } else if (bundleFingerprint !== sourceFingerprint) {
      failures.push(
        `registry bundle is stale: source content fingerprint ${sourceFingerprint} ` +
          `!= bundle ${bundleFingerprint}\n` +
          "    → run `pnpm gen:registry` to rebuild the bundle from the YAML source.",
      );
    }
  }

  // ── 3. published count floors ──
  const status = computeRegistryStatus(assembleRegistry(raw));
  failures.push(...computeCountFloorFailures(status));

  // ── 4. expected release fingerprint (P0-06) ──
  const fingerprintFailure = computeFingerprintFailure(sourceFingerprint);
  if (fingerprintFailure) failures.push(fingerprintFailure);

  // ── 5. release/legal metadata must remain aligned ──
  for (const rel of REQUIRED_PUBLIC_FILES) {
    if (!existsSync(join(ROOT, rel))) {
      failures.push(`required public release file is missing: ${rel}.`);
    }
  }

  const packageJson = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as {
    license?: string;
    homepage?: string;
    repository?: { url?: string } | string;
    bugs?: { url?: string } | string;
    scripts?: { build?: string };
  };

  if (packageJson.license !== "MIT") {
    failures.push(
      `package.json license must be MIT (found ${packageJson.license ?? "missing"}).`,
    );
  }
  if (packageJson.homepage !== "https://orchestratemcp.dev") {
    failures.push(
      `package.json homepage must be https://orchestratemcp.dev (found ${packageJson.homepage ?? "missing"}).`,
    );
  }

  const repositoryUrl =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;
  if (
    repositoryUrl !==
    "git+https://github.com/orchestratemcp/OrchestrateKIT-MCP.git"
  ) {
    failures.push(
      "package.json repository must point to orchestratemcp/OrchestrateKIT-MCP.",
    );
  }

  const bugsUrl =
    typeof packageJson.bugs === "string"
      ? packageJson.bugs
      : packageJson.bugs?.url;
  if (bugsUrl !== "https://github.com/orchestratemcp/OrchestrateKIT-MCP/issues") {
    failures.push(
      "package.json bugs URL must point to the public GitHub issue tracker.",
    );
  }

  if (!packageJson.scripts?.build?.startsWith("pnpm gen:registry &&")) {
    failures.push(
      "package.json build must generate ignored registry bundles before compiling.",
    );
  }

  // ── report ──
  if (failures.length > 0) {
    process.stderr.write("\n✗ release-trust gate FAILED (MAR-220):\n");
    for (const f of failures) process.stderr.write(`  • ${f}\n`);
    process.stderr.write("\n");
    process.exit(1);
  }

  process.stderr.write(
    `✓ release-trust gate passed: bundle in sync (${sourceFingerprint} == expected release), ` +
      `${status.component_count} components / ${status.edge_count} edges / ` +
      `${status.route_count} routes / ${status.playbook_count} playbooks ` +
      `(floors ${MIN_COMPONENTS}/${MIN_EDGES}/${MIN_ROUTES}/${MIN_PLAYBOOKS}), bundles untracked.\n`,
  );
}

// Only run the gate when this file is executed directly (`pnpm release:check`
// / `tsx scripts/check-release-trust.ts`) — importing it (e.g. from tests, to
// reach computeCountFloorFailures / computeFingerprintFailure) must not
// trigger real fs/git IO or process.exit.
const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main();
}
