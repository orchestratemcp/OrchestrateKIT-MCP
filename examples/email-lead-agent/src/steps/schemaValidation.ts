import { z } from "zod";
import type { Lead, RawEmailMessage } from "../types.js";

// Route step 2 (schema_validation). Deterministic — no model involved.
const RawEmailSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  from: z.string().min(3),
  to: z.string().min(3),
  subject: z.string(),
  bodyText: z.string(),
  receivedAt: z.string().datetime().or(z.string().min(1)),
});

const FROM_HEADER_RE = /^(.*?)<([^>]+)>\s*$/;

function parseFromHeader(from: string): { name: string; email: string } {
  const match = FROM_HEADER_RE.exec(from.trim());
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: from.trim(), email: from.trim() };
}

export interface ValidationResult {
  valid: boolean;
  lead?: Lead;
  errorMessage?: string;
}

export function validateLead(raw: unknown): ValidationResult {
  const parsed = RawEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errorMessage: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const msg: RawEmailMessage = parsed.data;
  const { name, email } = parseFromHeader(msg.from);
  if (!email.includes("@")) {
    return { valid: false, errorMessage: `from header did not contain a parseable email address: "${msg.from}"` };
  }

  const lead: Lead = {
    emailId: msg.id,
    threadId: msg.threadId,
    fromEmail: email,
    fromName: name || email,
    subject: msg.subject,
    bodyText: msg.bodyText,
    receivedAt: msg.receivedAt,
  };
  return { valid: true, lead };
}
