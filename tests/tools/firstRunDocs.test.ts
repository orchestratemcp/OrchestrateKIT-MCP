import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function doc(path: string): string {
  return readFileSync(path, "utf8");
}

describe("MAR-344 first-run docs", () => {
  it("keeps public first-run docs free of DASH as a required first-run dependency", () => {
    for (const path of [
      "README.md",
      "docs/FIRST_RUN_STARTERS.md",
      "docs/CHATGPT_USAGE.md",
      "docs/CURSOR_USAGE.md",
      "docs/CLAUDE_DESKTOP_USAGE.md",
    ]) {
      expect(doc(path), `${path} should not mention DASH in first-run docs`).not.toContain("DASH");
    }
  });

  it("points every client guide at plan_workflow as the first action", () => {
    for (const path of [
      "README.md",
      "docs/FIRST_RUN_STARTERS.md",
      "docs/CHATGPT_USAGE.md",
      "docs/CURSOR_USAGE.md",
      "docs/CLAUDE_DESKTOP_USAGE.md",
    ]) {
      const text = doc(path);
      expect(text, `${path} should mention plan_workflow`).toContain("plan_workflow");
      expect(text, `${path} should not lead with old recommend_architecture flow`).not.toContain(
        "recommend_architecture with",
      );
    }
  });

  it("documents the five MAR-344 starter paths", () => {
    const starters = doc("docs/FIRST_RUN_STARTERS.md");
    for (const expected of [
      "Competitor Price Monitor",
      "Gmail Lead to CRM",
      "Read-Only PR Reviewer",
      "Invoice Intake / PO Match",
      "Content Repurposing With Approval",
    ]) {
      expect(starters).toContain(expected);
    }
  });
});
