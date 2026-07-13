import { createHmac, timingSafeEqual } from "node:crypto";

export function base64UrlDecode(value = "") {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function extractPlainText(part = {}) {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return base64UrlDecode(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractPlainText(child);
    if (text) return text;
  }
  return "";
}

export function parseMailbox(value = "") {
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] ?? value).trim().toLowerCase();
  const name = match ? value.slice(0, match.index).replace(/^\s*"|"\s*$/g, "").trim() : "";
  return { name, email };
}

export function toEmailMessage(message) {
  const payload = message.payload ?? {};
  const header = (name) =>
    payload.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: String(message.id ?? ""),
    threadId: String(message.threadId ?? ""),
    from: header("From"),
    fromMailbox: parseMailbox(header("From")),
    to: header("To"),
    subject: header("Subject"),
    messageId: header("Message-ID"),
    bodyText: extractPlainText(payload) || String(message.snippet ?? ""),
    receivedAt: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
  };
}

function timeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedDateToUtc(year, month, day, hour, minute, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = timeZoneParts(new Date(instant), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant += wallClock - represented;
  }
  return new Date(instant);
}

function overlaps(start, end, busy) {
  return busy.some((interval) => start < new Date(interval.end) && end > new Date(interval.start));
}

export function findAvailableSlots({ busy = [], now = new Date(), timeZone = "Europe/Stockholm", count = 2 }) {
  const today = timeZoneParts(now, timeZone);
  const slots = [];
  const earliest = new Date(now.getTime() + 60 * 60 * 1000);

  for (let dayOffset = 0; dayOffset < 14 && slots.length < count; dayOffset += 1) {
    const localDate = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    const weekday = localDate.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    for (let minutes = 9 * 60; minutes <= 16 * 60 + 30 && slots.length < count; minutes += 30) {
      const start = zonedDateToUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        Math.floor(minutes / 60),
        minutes % 60,
        timeZone,
      );
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      if (start < earliest || overlaps(start, end, busy)) continue;
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        label: new Intl.DateTimeFormat("sv-SE", {
          timeZone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(start),
      });
    }
  }
  if (slots.length < count) throw new Error(`Calendar lookup found only ${slots.length}/${count} free slots.`);
  return slots;
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signApproval(proposal, secret) {
  if (!secret) throw new Error("APPROVAL_SECRET is required.");
  const payload = Buffer.from(JSON.stringify(proposal), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyApproval(token, secret, now = Date.now()) {
  if (!secret) throw new Error("APPROVAL_SECRET is required.");
  const [payload, supplied, extra] = String(token ?? "").split(".");
  if (!payload || !supplied || extra) throw new Error("Malformed approval token.");
  const expected = signature(payload, secret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error("Approval token signature is invalid.");
  }
  const proposal = JSON.parse(base64UrlDecode(payload));
  if (!proposal.expiresAt || Date.parse(proposal.expiresAt) <= now) throw new Error("Approval token has expired.");
  return proposal;
}

export function encodeRawEmail({ to, subject, bodyText, messageId, approvalId }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `Message-ID: <${approvalId}@orchestratekit.local>`,
  ];
  if (messageId) headers.push(`In-Reply-To: ${messageId}`, `References: ${messageId}`);
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${bodyText}\r\n`, "utf8").toString("base64url");
}

export function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual ?? ""));
  const right = Buffer.from(String(expected ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}
