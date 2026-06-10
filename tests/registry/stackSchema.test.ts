import { describe, it, expect } from "vitest";
import { StackSchema } from "../../src/registry/stackSchema.js";

const validStack = {
  id: "default_local",
  name: "Default Local Stack",
  status: "published",
  summary: "Opinionated stack for local MVP tools.",
};

describe("StackSchema", () => {
  it("accepts a minimal valid stack", () => {
    const result = StackSchema.safeParse(validStack);
    expect(result.success).toBe(true);
  });

  it("accepts a stack with choices", () => {
    const result = StackSchema.safeParse({
      ...validStack,
      choices: {
        state_store: { recommended: "sqlite", alternatives: ["postgres"] },
        agent_framework: { recommended: ["vercel-ai-sdk"], alternatives: [] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("allows recommended to be a string or array", () => {
    const withString = StackSchema.safeParse({
      ...validStack,
      choices: { state_store: { recommended: "sqlite" } },
    });
    expect(withString.success).toBe(true);

    const withArray = StackSchema.safeParse({
      ...validStack,
      choices: { state_store: { recommended: ["sqlite", "postgres"] } },
    });
    expect(withArray.success).toBe(true);
  });

  it("rejects missing required field: summary", () => {
    const result = StackSchema.safeParse({ ...validStack, summary: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = StackSchema.safeParse({ ...validStack, status: "live" });
    expect(result.success).toBe(false);
  });
});
