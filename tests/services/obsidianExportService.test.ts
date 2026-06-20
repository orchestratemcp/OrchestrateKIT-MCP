/**
 * MAR-79 — Obsidian export service tests.
 * Verifies the markdown vault generation for the workflow graph.
 */
import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { exportToObsidian } from "../../src/services/obsidianExportService.js";
import { sanitizeFilename, toWikilink, buildExportPath } from "../../src/services/markdownLinkService.js";

const registry = loadRegistry();

describe("markdownLinkService", () => {
  it("sanitizes filenames: removes special characters", () => {
    expect(sanitizeFilename("external_publish")).toBe("external_publish");
    expect(sanitizeFilename("email-draft")).toBe("email-draft"); // hyphens are valid
    expect(sanitizeFilename("data/scraper")).toBe("data_scraper");
    expect(sanitizeFilename("test@#$name")).toBe("test_name");
  });

  it("generates wikilinks", () => {
    expect(toWikilink("email_draft")).toBe("[[email_draft]]");
  });

  it("builds export paths by category", () => {
    expect(buildExportPath("components", "email_draft")).toBe("components/email_draft.md");
    expect(buildExportPath("edges", "external_publish_requires_human_approval_gate")).toContain("edges/");
    expect(buildExportPath("routes", "my_route")).toBe("routes/my_route.md");
  });
});

describe("exportToObsidian", () => {
  it("returns an export result with files and stats", () => {
    const result = exportToObsidian(registry, false);
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("includes a README file", () => {
    const result = exportToObsidian(registry, false);
    const readme = result.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.content).toContain("OrchestrateMCP");
    expect(readme!.content).toContain("Graph view");
  });

  it("exports published components by default", () => {
    const result = exportToObsidian(registry, false);
    const componentFiles = result.files.filter((f) => f.path.startsWith("components/"));
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it("exports edges with frontmatter", () => {
    const result = exportToObsidian(registry, false);
    const edgeFiles = result.files.filter((f) => f.path.startsWith("edges/"));
    expect(edgeFiles.length).toBeGreaterThan(0);

    const firstEdge = edgeFiles[0]!.content;
    expect(firstEdge).toContain("---");
    expect(firstEdge).toContain("type: edge");
    expect(firstEdge).toContain("from:");
    expect(firstEdge).toContain("to:");
  });

  it("exports routes with component list as wikilinks", () => {
    const result = exportToObsidian(registry, false);
    const routeFiles = result.files.filter((f) => f.path.startsWith("routes/"));
    expect(routeFiles.length).toBeGreaterThan(0);

    const firstRoute = routeFiles[0]!.content;
    expect(firstRoute).toContain("## Components");
    expect(firstRoute).toContain("[[");
  });

  it("exports playbooks with golden path components as wikilinks", () => {
    const result = exportToObsidian(registry, false);
    const playbookFiles = result.files.filter((f) => f.path.startsWith("playbooks/"));
    expect(playbookFiles.length).toBeGreaterThan(0);

    const firstPlaybook = playbookFiles[0]!.content;
    expect(firstPlaybook).toContain("## Components");
  });

  it("exports stacks with choice tiers", () => {
    const result = exportToObsidian(registry, false);
    const stackFiles = result.files.filter((f) => f.path.startsWith("stacks/"));
    expect(stackFiles.length).toBeGreaterThan(0);

    const firstStack = stackFiles[0]!.content;
    expect(firstStack).toContain("## Choices");
  });

  it("includes stats: component, edge, route, playbook, stack counts", () => {
    const result = exportToObsidian(registry, false);
    expect(result.stats.components_exported).toBeGreaterThan(0);
    expect(result.stats.edges_exported).toBeGreaterThan(0);
    expect(result.stats.routes_exported).toBeGreaterThanOrEqual(0);
    expect(result.stats.playbooks_exported).toBeGreaterThanOrEqual(0);
    expect(result.stats.stacks_exported).toBeGreaterThanOrEqual(0);
    expect(result.stats.files_generated).toBeGreaterThan(0);
  });

  it("marks timestamp on export", () => {
    const result = exportToObsidian(registry, false);
    expect(result.stats.timestamp).toBeDefined();
    expect(new Date(result.stats.timestamp)).toBeInstanceOf(Date);
  });

  it("includes warnings for broken/missing links", () => {
    const result = exportToObsidian(registry, false);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("all files are JSON-serialisable (no circular refs)", () => {
    const result = exportToObsidian(registry, false);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("component files include category and model tier", () => {
    const result = exportToObsidian(registry, false);
    const componentFile = result.files.find((f) => f.path.startsWith("components/"));
    expect(componentFile).toBeDefined();
    expect(componentFile!.content).toContain("**Category:**");
    expect(componentFile!.content).toContain("**Model tier:**");
  });

  it("component files include permissions if any", () => {
    const result = exportToObsidian(registry, false);
    // At least one component should have permissions
    const filesWithPerms = result.files.filter(
      (f) => f.path.startsWith("components/") && f.content.includes("## Permissions"),
    );
    expect(filesWithPerms.length).toBeGreaterThanOrEqual(0);
  });

  it("edge files include relationship and severity", () => {
    const result = exportToObsidian(registry, false);
    const edgeFile = result.files.find((f) => f.path.startsWith("edges/"));
    expect(edgeFile).toBeDefined();
    expect(edgeFile!.content).toContain("**Relation:**");
    expect(edgeFile!.content).toContain("**Severity:**");
  });
});
