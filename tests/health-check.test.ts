import { describe, it, expect } from "vitest";
import {
  buildHealthCheckResult,
  computeDemoBlockers,
  type HealthCheckResult,
  type RegistrySummary,
  type RegistryBuild,
} from "../src/tools/index.js";
import {
  SERVER_NAME,
  SERVER_VERSION,
  SERVER_INSTRUCTIONS,
  MIN_COMPONENTS,
  MIN_EDGES,
} from "../src/config.js";

describe("health_check tool", () => {
  it("returns the correct server name", () => {
    const result: HealthCheckResult = buildHealthCheckResult();
    expect(result.name).toBe(SERVER_NAME);
  });

  it("returns the correct server version", () => {
    const result = buildHealthCheckResult();
    expect(result.version).toBe(SERVER_VERSION);
  });

  it("returns a registry summary object", () => {
    const result = buildHealthCheckResult();
    expect(result.registry).toBeDefined();
    expect(typeof result.registry).toBe("object");
  });

  it("registry summary has all count fields as non-negative numbers", () => {
    const r: RegistrySummary = buildHealthCheckResult().registry;
    const fields: (keyof RegistrySummary)[] = [
      "component_count",
      "edge_count",
      "stack_count",
      "route_count",
      "playbook_count",
      "stale_component_count",
    ];
    for (const field of fields) {
      expect(typeof r[field], field).toBe("number");
      expect(r[field], field).toBeGreaterThanOrEqual(0);
    }
  });

  it("registry summary includes untested_edge_pct (MAR-92)", () => {
    const r: RegistrySummary = buildHealthCheckResult().registry;
    expect(typeof r.untested_edge_pct).toBe("number");
    expect(r.untested_edge_pct).toBeGreaterThanOrEqual(0);
    expect(r.untested_edge_pct).toBeLessThanOrEqual(100);
  });

  // MAR-137: stale_component_count — all registry files are new, should be 0
  it("stale_component_count is 0 when all component files are recent (MAR-137)", () => {
    const r = buildHealthCheckResult().registry;
    expect(r.stale_component_count).toBe(0);
  });

  // MAR-114: count floor regression — must never drop below post-MAR-95 baseline
  // MAR-217: ≥55/≥116 (knowledge); MAR-242: ≥58/≥123 (CRM); MAR-243: ≥61/≥131 (monitoring)
  // MAR-244: ≥62/≥136 (file_storage primitive); MAR-254: ≥64/≥144 (data-report
  // spine); MAR-266: ≥64/≥147 (price-monitor edges); MAR-267: ≥64/≥151
  // (PR-review golden-path edges)
  // MAR-220: floor centralised in config (MIN_COMPONENTS / MIN_EDGES)
  it("registry counts meet baseline (≥64 components, ≥151 edges after MAR-267 PR-review edges)", () => {
    const r = buildHealthCheckResult().registry;
    expect(MIN_COMPONENTS).toBe(64);
    expect(MIN_EDGES).toBe(151);
    expect(r.component_count, "components (regression floor)").toBeGreaterThanOrEqual(MIN_COMPONENTS);
    expect(r.edge_count, "edges (regression floor)").toBeGreaterThanOrEqual(MIN_EDGES);
    expect(r.stack_count, "stacks").toBeGreaterThanOrEqual(1);
    expect(r.route_count, "routes").toBeGreaterThanOrEqual(5);
    // MAR-267: pr_review_readonly published → 9 playbooks is the new floor.
    expect(r.playbook_count, "playbooks").toBeGreaterThanOrEqual(9);
  });

  // MAR-220: release-trust safe_to_demo verdict
  it("safe_to_demo is true with empty demo_blockers in a fresh dev build", () => {
    const result = buildHealthCheckResult();
    expect(Array.isArray(result.demo_blockers)).toBe(true);
    expect(result.demo_blockers, JSON.stringify(result.demo_blockers)).toHaveLength(0);
    expect(result.safe_to_demo).toBe(true);
  });

  it("computeDemoBlockers flags below-floor counts, untested edges, and stale builds", () => {
    const lowRegistry: RegistrySummary = {
      component_count: MIN_COMPONENTS - 1,
      edge_count: MIN_EDGES - 1,
      stack_count: 1,
      route_count: 6,
      playbook_count: 6,
      worker_count: 4,
      untested_edge_pct: 5,
      stale_component_count: 0,
    };
    const staleBuild: RegistryBuild = {
      fingerprint: "deadbeefdeadbeef",
      newest_mtime: new Date().toISOString(),
      built_at: new Date(0).toISOString(),
      stale: true,
      stale_files: ["registry/components/foo.component.yaml"],
      process_started_at: new Date().toISOString(),
      process_stale: true,
    };
    const blockers = computeDemoBlockers(lowRegistry, staleBuild);
    expect(blockers.length).toBeGreaterThanOrEqual(5);
    expect(blockers.join("\n")).toMatch(/component_count/);
    expect(blockers.join("\n")).toMatch(/edge_count/);
    expect(blockers.join("\n")).toMatch(/untested/);
    expect(blockers.join("\n")).toMatch(/stale/);
  });

  it("computeDemoBlockers is empty for a healthy fresh build", () => {
    const okRegistry: RegistrySummary = {
      component_count: MIN_COMPONENTS,
      edge_count: MIN_EDGES,
      stack_count: 1,
      route_count: 6,
      playbook_count: 6,
      worker_count: 4,
      untested_edge_pct: 0,
      stale_component_count: 0,
    };
    const freshBuild: RegistryBuild = {
      fingerprint: "abc123abc123abc1",
      newest_mtime: new Date().toISOString(),
      built_at: null,
      stale: false,
      stale_files: [],
      process_started_at: new Date().toISOString(),
      process_stale: false,
    };
    expect(computeDemoBlockers(okRegistry, freshBuild)).toHaveLength(0);
  });

  // MAR-114: build fingerprint and stale-dist detection
  it("returns a build object with required fields", () => {
    const b: RegistryBuild = buildHealthCheckResult().build;
    expect(b).toBeDefined();
    expect(typeof b.fingerprint).toBe("string");
    expect(b.fingerprint.length).toBeGreaterThan(0);
    expect(typeof b.newest_mtime).toBe("string");
    expect(new Date(b.newest_mtime).getTime()).toBeGreaterThan(0);
    expect(typeof b.stale).toBe("boolean");
    expect(Array.isArray(b.stale_files)).toBe(true);
  });

  it("build.built_at is null in dev (tsx) mode — no _build_manifest.json in src registry", () => {
    // When running tests via tsx, defaultRegistryDir resolves to registry/ (source).
    // There is no _build_manifest.json there, so built_at must be null.
    const b = buildHealthCheckResult().build;
    expect(b.built_at).toBeNull();
  });

  it("build.stale is false in dev mode (built_at is null, nothing to compare against)", () => {
    const b = buildHealthCheckResult().build;
    if (b.built_at === null) {
      expect(b.stale).toBe(false);
      expect(b.stale_files).toHaveLength(0);
    }
  });

  it("build.fingerprint is stable across two calls with the same registry", () => {
    const a = buildHealthCheckResult().build.fingerprint;
    const b = buildHealthCheckResult().build.fingerprint;
    expect(a).toBe(b);
  });

  // MAR-141: process_started_at and process_stale fields
  it("build.process_started_at is a valid ISO timestamp", () => {
    const b = buildHealthCheckResult().build;
    expect(typeof b.process_started_at).toBe("string");
    expect(new Date(b.process_started_at).getTime()).toBeGreaterThan(0);
  });

  it("build.process_stale is false in dev mode (built_at is null)", () => {
    const b = buildHealthCheckResult().build;
    if (b.built_at === null) {
      expect(b.process_stale).toBe(false);
    }
  });

  it("build.process_stale is boolean", () => {
    const b = buildHealthCheckResult().build;
    expect(typeof b.process_stale).toBe("boolean");
  });

  // MAR-99: server instructions are defined and mention key entry point
  it("SERVER_INSTRUCTIONS is defined and mentions plan_workflow (MAR-99)", () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe("string");
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(SERVER_INSTRUCTIONS).toContain("plan_workflow");
    expect(SERVER_INSTRUCTIONS).toContain("explain_component");
  });

  // MAR-147: instructions guide the client to elicit user constraints
  // (read-only / unattended / no outbound) before planning, and explicitly
  // forbid coaching "magic" trigger vocabulary.
  it("SERVER_INSTRUCTIONS guides constraint elicitation without magic vocab (MAR-147)", () => {
    const lower = SERVER_INSTRUCTIONS.toLowerCase();
    // elicits the three constraint axes seen in dogfooding
    expect(lower).toContain("read-only");
    expect(lower).toContain("unattended");
    expect(lower).toMatch(/outbound|publish externally|send email/);
    // tells the client to ask before planning
    expect(lower).toContain("constraint");
    // forbids coaching magic vocabulary
    expect(lower).toContain("magic");
    expect(lower).toMatch(/natural phrasing|user actually phrases|plain language/);
  });

  it("SERVER_INSTRUCTIONS describe the stateless scope compiler handoff (MAR-249)", () => {
    const lower = SERVER_INSTRUCTIONS.toLowerCase();
    expect(lower).toContain("export_build_brief");
    expect(lower).toContain("scope compiler");
    expect(lower).toContain("clarify");
    expect(lower).toContain("confirm scope");
    expect(lower).toContain("compile artifacts");
    expect(lower).toContain("does not call an llm");
    expect(lower).toContain("does not write to");
    expect(lower).toContain("linear");
    expect(lower).toContain("obsidian");
    expect(lower).toContain("unknown");
  });

  // MAR-344: cross-client dogfood (ChatGPT, Claude) showed the first response
  // often paraphrases plan_workflow's summary_markdown and drops the A) B) C) D)
  // continuation menu unless a user explicitly asks for verbatim rendering.
  // Bake the instruction into the server-level guidance so it doesn't depend
  // on the user knowing to ask for it.
  it("SERVER_INSTRUCTIONS tells the client to render summary_markdown verbatim (MAR-344)", () => {
    const lower = SERVER_INSTRUCTIONS.toLowerCase();
    expect(lower).toContain("verbatim");
    expect(lower).toContain("summary_markdown");
    expect(lower).toMatch(/do not paraphrase|not.*paraphrase/);
  });

  it("result is JSON-serialisable and round-trips cleanly", () => {
    const result = buildHealthCheckResult();
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as HealthCheckResult;
    expect(parsed.name).toBe(SERVER_NAME);
    expect(parsed.version).toBe(SERVER_VERSION);
    expect(parsed.registry.component_count).toBeGreaterThanOrEqual(32);
    expect(parsed.build.fingerprint.length).toBeGreaterThan(0);
  });
});
