import { describe, expect, it } from "vitest";
import { validateLead } from "../examples/email-lead-agent/src/steps/schemaValidation.js";
import { classifyIntent } from "../examples/email-lead-agent/src/steps/intentClassifier.js";
import type { Lead } from "../examples/email-lead-agent/src/types.js";

describe("email-lead-agent: schema_validation", () => {
  it("accepts a well-formed raw message and parses the From header", () => {
    const result = validateLead({
      id: "m1",
      threadId: "t1",
      from: "Priya Shah <priya@example.com>",
      to: "sales@orchestratekit.dev",
      subject: "Pricing?",
      bodyText: "hi",
      receivedAt: "2026-07-12T00:00:00Z",
    });
    expect(result.valid).toBe(true);
    expect(result.lead?.fromEmail).toBe("priya@example.com");
    expect(result.lead?.fromName).toBe("Priya Shah");
  });

  it("rejects a message missing required fields", () => {
    const result = validateLead({ id: "m2", from: "broken" });
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  it("rejects a From header with no parseable email address", () => {
    const result = validateLead({
      id: "m3",
      threadId: "t3",
      from: "not-an-email",
      to: "sales@orchestratekit.dev",
      subject: "x",
      bodyText: "y",
      receivedAt: "2026-07-12T00:00:00Z",
    });
    expect(result.valid).toBe(false);
  });
});

describe("email-lead-agent: intent_classifier", () => {
  const baseLead: Lead = {
    emailId: "m1",
    threadId: "t1",
    fromEmail: "a@example.com",
    fromName: "A",
    subject: "",
    bodyText: "",
    receivedAt: "2026-07-12T00:00:00Z",
  };

  it("classifies pricing/demo language as a sales lead", () => {
    const result = classifyIntent({ ...baseLead, subject: "Pricing for a 40-seat rollout?", bodyText: "Could we book a demo?" });
    expect(result.intent).toBe("sales_lead");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies newsletter language as not a lead", () => {
    const result = classifyIntent({ ...baseLead, subject: "This week in dev tools", bodyText: "Unsubscribe anytime." });
    expect(result.intent).toBe("not_a_lead");
  });

  it("defaults to not_a_lead when no signal matches", () => {
    const result = classifyIntent({ ...baseLead, subject: "hello", bodyText: "how are you" });
    expect(result.intent).toBe("not_a_lead");
  });
});
