import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const skillRoot = join(
  process.cwd(),
  "distribution",
  "claude-skill",
  "orchestratekit-agent-planner",
);

function readSkillFile(relativePath: string): string {
  return readFileSync(join(skillRoot, relativePath), "utf-8");
}

describe("Claude Skill distribution", () => {
  it("includes a portable Skill entrypoint with live MCP-first instructions", () => {
    const skill = readSkillFile("SKILL.md");

    expect(skill).toContain("description:");
    expect(skill).toContain("plan_workflow");
    expect(skill).toContain("summary_markdown");
    expect(skill).toContain("explain_component");
    expect(skill).toContain("export_build_brief");
    expect(skill).toContain("orchestratekit://playbooks/<playbook_id>");
    expect(skill).toContain("references/playbooks.md");
    expect(skill).toContain("references/safety-checklist.md");
    expect(skill).toContain("references/setup.md");
  });

  it("documents the hybrid Skill plus MCP recommendation", () => {
    const evaluation = readFileSync(join(process.cwd(), "docs", "CLAUDE_SKILL.md"), "utf-8");
    const readme = readSkillFile("README.md");

    expect(evaluation).toContain("hybrid Skill plus MCP");
    expect(evaluation).toContain("distribution/claude-skill/orchestratekit-agent-planner/");
    expect(readme).toContain("Build and ship the hybrid Skill plus MCP path.");
    expect(readme).toContain("pnpm verify");
  });

  it("keeps the static playbook catalogue aligned with published registry playbooks", () => {
    const catalogue = readSkillFile(join("references", "playbooks.md"));
    const publishedPlaybooks = loadRegistry().playbooks
      .filter((playbook) => playbook.status === "published")
      .map((playbook) => playbook.id)
      .sort();

    expect(publishedPlaybooks).toHaveLength(12);

    for (const playbookId of publishedPlaybooks) {
      expect(catalogue).toContain(`## ${playbookId}`);
    }
  });

  it("makes offline-mode limitations and setup explicit", () => {
    const setup = readSkillFile(join("references", "setup.md"));
    const safety = readSkillFile(join("references", "safety-checklist.md"));

    expect(setup).toContain("https://mcp.orchestratemcp.dev/mcp");
    expect(setup).toContain("Offline Skill Mode");
    expect(setup).toContain("Plan Passport replay verification");
    expect(safety).toContain("Offline Skill mode cannot prove edge coverage");
    expect(safety).toContain("approval");
  });
});
