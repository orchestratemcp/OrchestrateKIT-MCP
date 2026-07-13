import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  benchmarkArtifactMatches,
  buildPublicBenchmark,
  benchmarkSourceFingerprint,
  evaluateFixture,
  renderPublicBenchmarkMarkdown,
  serializePublicBenchmark,
} from "../../src/benchmark/publicBenchmark.js";
import { contentFingerprint } from "../../src/registry/contentFingerprint.js";
import { readRawEntries } from "../../src/registry/registryLoader.js";

const root = process.cwd();

describe("public benchmark", () => {
  it("fingerprints text identically across Windows and Unix line endings", () => {
    expect(benchmarkSourceFingerprint("alpha\r\nbeta\r\n")).toBe(
      benchmarkSourceFingerprint("alpha\nbeta\n"),
    );
  });

  it("matches CRLF benchmark artifacts without hiding content changes", () => {
    const canonical = "alpha\nbeta\n";

    expect(benchmarkArtifactMatches("alpha\r\nbeta\r\n", canonical)).toBe(true);
    expect(benchmarkArtifactMatches("alpha\r\nchanged\r\n", canonical)).toBe(false);
  });

  it("evaluates required and forbidden fixture assertions", () => {
    const verdict = evaluateFixture(
      {
        must_have: ["email_read", "email_draft"],
        forbidden: ["external_publish"],
        nice_to_have: ["audit_log"],
      },
      ["email_read", "external_publish", "audit_log"],
    );

    expect(verdict).toMatchObject({
      required_missing: ["email_draft"],
      forbidden_present: ["external_publish"],
      nice_to_have_present: ["audit_log"],
      assertion_count: 3,
      passed_assertion_count: 1,
      passed: false,
    });
  });

  it("builds a deterministic seven-prompt report with provenance", () => {
    const first = buildPublicBenchmark(root);
    const second = buildPublicBenchmark(root);

    expect(second).toEqual(first);
    expect(first.prompts).toHaveLength(7);
    expect(first.provenance.registry_fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(first.provenance.registry_fingerprint).toBe(
      contentFingerprint(readRawEntries(join(root, "registry"))),
    );
    expect(first.provenance.registry_scope).toBe("public_non_beta");
    expect(first.report_fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(first.methodology).toMatchObject({
      kind: "deterministic_registry_conformance",
      llm_calls: 0,
      network_calls: 0,
      llm_quality_claim_status: "hold_for_isolated_client_rerun",
    });
  });

  it("keeps model-quality limitations prominent in the public page", () => {
    const markdown = renderPublicBenchmarkMarkdown(buildPublicBenchmark(root));

    expect(markdown).toContain("zero LLM and network calls");
    expect(markdown).toContain("does not compare a vanilla model");
    expect(markdown).toContain("graph-internal scores, not LLM quality scores");
  });

  it("keeps committed public artifacts synchronized", () => {
    const report = buildPublicBenchmark(root);
    expect(
      benchmarkArtifactMatches(
        readFileSync(join(root, "benchmarks/public/latest.json"), "utf8"),
        serializePublicBenchmark(report),
      ),
    ).toBe(true);
    expect(
      benchmarkArtifactMatches(
        readFileSync(join(root, "benchmarks/public/README.md"), "utf8"),
        `${renderPublicBenchmarkMarkdown(report)}\n`,
      ),
    ).toBe(true);
  });
});
