import { describe, expect, it } from "vitest";
// @ts-expect-error The deployable example intentionally stays dependency-free JavaScript.
import { encodeRawEmail, findAvailableSlots, signApproval, toEmailMessage, verifyApproval } from "../examples/email-calendar-agent/src/core.mjs";

describe("email-calendar-agent", () => {
  it("returns two weekday slots and excludes real busy intervals", () => {
    const slots = findAvailableSlots({
      now: new Date("2026-07-13T06:00:00.000Z"),
      timeZone: "Europe/Stockholm",
      busy: [{ start: "2026-07-13T07:00:00.000Z", end: "2026-07-13T08:00:00.000Z" }],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].start).toBe("2026-07-13T08:00:00.000Z");
    expect(slots[1].start).toBe("2026-07-13T08:30:00.000Z");
  });

  it("accepts an intact approval and rejects a real content mutation", () => {
    const proposal = {
      approvalId: "approval-1",
      expiresAt: "2026-07-13T12:15:00.000Z",
      draft: { to: "guest@example.com", bodyText: "Choose A or B" },
      slots: [{ start: "2026-07-14T07:00:00.000Z" }],
    };
    const token = signApproval(proposal, "test-secret");
    expect(verifyApproval(token, "test-secret", Date.parse("2026-07-13T12:00:00.000Z"))).toEqual(proposal);

    const [payload, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    changed.draft.to = "attacker@example.com";
    const changedPayload = Buffer.from(JSON.stringify(changed)).toString("base64url");
    expect(() => verifyApproval(`${changedPayload}.${signature}`, "test-secret", Date.parse("2026-07-13T12:00:00.000Z"))).toThrow("signature");
  });

  it("fails closed after the signed proposal expires", () => {
    const token = signApproval({ expiresAt: "2026-07-13T12:00:00.000Z" }, "test-secret");
    expect(() => verifyApproval(token, "test-secret", Date.parse("2026-07-13T12:00:00.000Z"))).toThrow("expired");
  });

  it("parses the Gmail sender and plain-text body", () => {
    const message = toEmailMessage({
      id: "m1",
      threadId: "t1",
      internalDate: "1783936800000",
      payload: {
        headers: [
          { name: "From", value: 'Ada Lovelace <ada@example.com>' },
          { name: "Subject", value: "Can we meet?" },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from("Tuesday works for me.").toString("base64url") },
      },
    });
    expect(message.fromMailbox).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(message.bodyText).toBe("Tuesday works for me.");
  });

  it("builds a Gmail draft with a deterministic message id and reply headers", () => {
    const raw = encodeRawEmail({
      to: "ada@example.com",
      subject: "Re: Can we meet?",
      bodyText: "Yes.",
      messageId: "<source@example.com>",
      approvalId: "approval-1",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("Message-ID: <approval-1@orchestratekit.local>");
    expect(decoded).toContain("In-Reply-To: <source@example.com>");
    expect(decoded).toContain("\r\n\r\nYes.\r\n");
  });
});
