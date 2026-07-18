/**
 * Connection contract (MAR-383 / DASH-08, Connect — UX spine step 4).
 *
 * REFRAME: a connection is not "a scope list plus an npm package" — it is a
 * remote MCP server the user authorized once. This module turns the route's
 * integration needs into per-connection ACQUISITION PATHS: for each provider,
 * the ranked, honest ways a user can actually obtain that connection, each
 * tagged with where the provider token ends up living (MAR-383's ownership
 * model: dash | agent | external_manager).
 *
 * This is the contract the DASH Connection Center consumes. It builds no UI,
 * no broker, and no OAuth flow — it is deterministic metadata derived from the
 * registry-grounded integration catalog. STATELESS: no network, no secrets.
 * The MCP never holds a token and never sees a credential value.
 *
 * ─────────────────────────── the honesty rules ───────────────────────────
 *
 * These are load-bearing, not stylistic. Each is asserted in
 * tests/lib/connectionContract.test.ts:
 *
 * 1. An OAuth grant made in claude.ai (or Cursor, or any other client) can
 *    NEVER transfer to our runtime. The refresh token is bound to that
 *    application's client_id and redeeming it needs their client secret. Every
 *    application obtains its OWN grant. What genuinely carries over is only:
 *    the account identity, the least-privilege scope contract, and a
 *    login_hint prefill. Any copy implying transfer is a lie, so no string in
 *    this module may promise it.
 * 2. A path whose availability is "planned" must never be rendered as "one
 *    click" or as something the user can do today. The broker-backed path is
 *    the architectural TARGET; it does not exist yet, and saying otherwise is
 *    the "fake completeness" anti-pattern from the UX spine.
 * 3. Providers whose scopes are restricted by the provider (Gmail) must
 *    disclose the verification cost rather than hiding it behind "one click".
 *    That cost is the single biggest hidden expense of a connection product.
 */

import type { McpServerInfo, PlacementAvailability } from "../tools/planWorkflow.js";
import { restrictedScopeDisclosure } from "./credentialScopeCatalog.js";

// ──────────────────────────────── types ────────────────────────────────

/**
 * Where the provider token physically lives once the connection exists
 * (MAR-383's ownership model). This is the field that decides who can revoke
 * the connection and what breaks when the agent is deleted — DASH renders it
 * per row, so it is part of the contract rather than a rendering detail.
 */
export type ConnectionOwnershipLocation =
  /** A DASH-managed (or broker-managed) connection the agent merely consumes. */
  | "dash"
  /** The agent's own .env / secret store — deleting the agent deletes it. */
  | "agent"
  /** An MCP server or credential manager the user runs and owns separately. */
  | "external_manager";

/**
 * How a user can obtain this connection, in architectural preference order.
 * Ranking is deterministic and fixed by kind — it encodes the MAR-383 target
 * architecture, NOT what happens to be easiest today. `availability` is what
 * keeps that honest: the preferred path is currently "planned".
 */
export type AcquisitionPathKind =
  /** Target: a broker-backed connection-holding MCP server (Composio/Arcade class). */
  | "broker_connection_mcp"
  /** Today: an official or community MCP server that holds the provider token. */
  | "mcp_server"
  /** Escape hatch: raw per-runtime OAuth via the generated scripts/connect.mjs. */
  | "raw_oauth";

export type AcquisitionPath = {
  kind: AcquisitionPathKind;
  /** 1 = architecturally preferred. Stable across plans for the same provider. */
  rank: number;
  label: string;
  ownership_location: ConnectionOwnershipLocation;
  /**
   * Reuses the PlacementAvailability vocabulary so clients that already render
   * runtime/control-surface availability need no new matcher words:
   *   "planned"       — does not exist yet; never render as an action.
   *   "requires setup"— real, but the user must install and authorize it.
   *   "advanced"      — real, but the self-hosted/expert path.
   */
  availability: PlacementAvailability;
  /** What the user actually does. Plain English, no scopes, no packages. */
  how: string;
  /** What this path buys once done — the honest reuse story for THIS path. */
  reuse: string;
  caveat?: string;
};

export type ConnectionRequirement = {
  /** Stable id for DASH row identity (e.g. "gmail", "google_calendar"). */
  connection_id: string;
  label: string;
  /** Route components this ONE authorization serves. */
  serves_components: string[];
  /** Plain-English capability. Never scopes — those stay at technical depth. */
  grants: string;
  /**
   * The transfer-honesty statement is NOT repeated per row: it is the exported
   * `AUTHORIZATION_NOTE` constant, because the constraint is architectural and
   * identical for every provider. Renderers state it once per page (§11 and
   * Layer 1 both do), rather than paying for it on every connection.
   */
  /** Ranked paths, rank 1 first. */
  acquisition_paths: AcquisitionPath[];
  /**
   * The first path a user can actually act on today (the first non-"planned"
   * path). Clients that render a single call-to-action must use THIS, not
   * `acquisition_paths[0]`, or they will offer a button for a path that does
   * not exist.
   */
  actionable_path_kind: AcquisitionPathKind;
  /** Provider verification cost, or null when the provider imposes none. */
  verification_requirement: string | null;
  /** Least-privilege scopes — technical/deep depth only, never Layer 1. */
  scopes: string[];
};

/** Structural input: the subset of IntegrationNeed this module reads. */
export type ConnectionNeedInput = {
  component_id: string;
  label: string;
  product_examples: string[];
  auth_model: string;
  mcp_server: McpServerInfo;
  required_scopes: string[];
};

// ─────────────────────────── honesty constants ───────────────────────────

/**
 * The one sentence that must accompany every connection. It states the
 * architectural constraint plainly and names what DOES carry over, so the
 * reader is not left assuming the worst OR the best.
 */
export const AUTHORIZATION_NOTE =
  "Each application authorizes its own connection — a grant you made in claude.ai or Cursor " +
  "cannot be reused by the deployed agent, because the refresh token is bound to that app. " +
  "What carries over is the account, this least-privilege scope set, and a login prefill.";

/** Layer-1 phrasing: same fact, compressed to fit the decision layer. */
export const AUTHORIZATION_NOTE_SHORT =
  "Each app authorizes its own connection — a claude.ai grant does not carry to the deployed agent";

/**
 * What the TARGET architecture buys, stated as a future. Rendered only next to
 * a "planned" path so it can never read as an available feature.
 */
const BROKER_REUSE =
  "Planned: authorize once against the connection server; chat dry-runs, Cursor and the deployed " +
  "agent then all use that one connection.";

// ─────────────────────────── provider grouping ───────────────────────────

export type ConnectionSpec = {
  connection_id: string;
  label: string;
  grants: string;
};

/**
 * component_id → the provider connection that satisfies it. Several components
 * collapse onto ONE connection on purpose: a single Gmail authorization covers
 * reading, composing and saving a draft, so showing three "connections" would
 * overstate what the user has to do. Components absent from this map fall back
 * to a connection derived from their catalog entry.
 */
const COMPONENT_CONNECTIONS: Record<string, ConnectionSpec> = {
  email_read: { connection_id: "gmail", label: "Gmail", grants: "Read your inbox" },
  email_draft: { connection_id: "gmail", label: "Gmail", grants: "Write drafts (never send)" },
  gmail_draft_write: {
    connection_id: "gmail",
    label: "Gmail",
    grants: "Save drafts to your mailbox (never send)",
  },
  calendar_lookup: {
    connection_id: "google_calendar",
    label: "Google Calendar",
    grants: "Read your events and free/busy",
  },
  calendar_write: {
    connection_id: "google_calendar",
    label: "Google Calendar",
    grants: "Create and update events",
  },
  slack_notification: { connection_id: "slack", label: "Slack", grants: "Post to a channel" },
  // NOTE: `reviewer_notification` is deliberately absent. It is channel-agnostic
  // (Slack, email or webhook), so pinning it to a provider would name a
  // connection the user never chose.
  chat_trigger: { connection_id: "slack", label: "Slack", grants: "Receive messages and commands" },
  crm_note_write: { connection_id: "hubspot", label: "HubSpot", grants: "Write contacts and notes" },
  crm_record_read: { connection_id: "hubspot", label: "HubSpot", grants: "Read contacts and deals" },
  deal_stage_update: { connection_id: "hubspot", label: "HubSpot", grants: "Advance deal stages" },
};

/**
 * The provider connection a component maps to, or null when the component has
 * no known provider (callers then keep their own descriptive label). Exported
 * so Layer-1 rendering keys rows by connection identity without duplicating the
 * mapping.
 */
export function connectionSpecFor(componentId: string): ConnectionSpec | null {
  return COMPONENT_CONNECTIONS[componentId] ?? null;
}

/** Fallback connection for a catalog component with no explicit provider spec. */
function fallbackConnection(need: ConnectionNeedInput): ConnectionSpec {
  const product = need.product_examples[0] || need.label;
  return {
    connection_id: product.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || need.component_id,
    label: product,
    grants: need.label,
  };
}

// ─────────────────────────── acquisition paths ───────────────────────────

function brokerPath(label: string): AcquisitionPath {
  return {
    kind: "broker_connection_mcp",
    rank: 1,
    label: `${label} connection server (broker-backed)`,
    ownership_location: "dash",
    // NOT built. Rule 2: never renders as an action, never says "one click".
    availability: "planned",
    how: "Not available yet — no connection server exists to authorize against.",
    reuse: BROKER_REUSE,
    caveat:
      "Needs someone to operate the verified provider OAuth app (directly or via a broker). " +
      "MAR-383; until it ships, use the actionable path below.",
  };
}

function mcpServerPath(label: string, mcp: McpServerInfo): AcquisitionPath | null {
  if (mcp.availability === "none") return null;
  const community = mcp.availability === "community";
  return {
    kind: "mcp_server",
    rank: 2,
    label: `${label} MCP server (${mcp.availability})`,
    // The server holds the provider token, so the user owns it outside the agent.
    ownership_location: "external_manager",
    // Installing and authorizing a server is setup, never "available now".
    availability: "requires setup",
    how:
      `Install and authorize the ${mcp.availability} MCP server, then point this agent at it. ` +
      "The server holds the provider token; the agent only calls the server.",
    reuse:
      "Any MCP client you point at this server reuses it, but each client still connects to the " +
      "server itself — the provider grant is never copied between applications.",
    caveat: community
      ? "No official server here — community packages vary in quality and hold a live token, so " +
        "review one before trusting it."
      : mcp.note,
  };
}

function rawOauthPath(label: string, authModel: string): AcquisitionPath {
  return {
    kind: "raw_oauth",
    rank: 3,
    label: `${label} direct credentials (scripts/connect.mjs)`,
    // Credentials land in the agent's own .env — deleting the agent deletes them.
    ownership_location: "agent",
    // MAR-364 stays as the self-hosted escape hatch; demoted from default, not removed.
    availability: "advanced",
    how:
      `Run \`node scripts/connect.mjs\`: it opens the ${authModel} flow, live-probes the ` +
      "credential and writes the agent's local .env.",
    reuse:
      "Serves this agent only — another app, or another copy of this agent, authorizes again.",
    caveat: "You operate the provider app yourself, including any verification it requires.",
  };
}

// ──────────────────────────────── build ────────────────────────────────

/**
 * Derive the ranked connection contract from the route's integration needs.
 * Deterministic: connections appear in first-touched route order, paths in
 * fixed rank order, and identical input always yields identical output.
 */
export function buildConnectionContract(
  needs: readonly ConnectionNeedInput[],
): ConnectionRequirement[] {
  const byConnection = new Map<string, ConnectionRequirement>();

  for (const need of needs) {
    const spec = COMPONENT_CONNECTIONS[need.component_id] ?? fallbackConnection(need);
    const existing = byConnection.get(spec.connection_id);

    if (existing) {
      // Same connection, additional component: merge what it serves and the
      // scopes it must carry. One authorization, not two.
      existing.serves_components.push(need.component_id);
      if (!existing.grants.includes(spec.grants)) existing.grants += `; ${spec.grants}`;
      for (const scope of need.required_scopes) {
        if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
      }
      existing.verification_requirement = restrictedScopeDisclosure(existing.scopes);
      continue;
    }

    const paths: AcquisitionPath[] = [brokerPath(spec.label)];
    const mcp = mcpServerPath(spec.label, need.mcp_server);
    if (mcp) paths.push(mcp);
    paths.push(rawOauthPath(spec.label, need.auth_model));

    const actionable = paths.find((p) => p.availability !== "planned");

    byConnection.set(spec.connection_id, {
      connection_id: spec.connection_id,
      label: spec.label,
      serves_components: [need.component_id],
      grants: spec.grants,
      acquisition_paths: paths,
      // A path list is always built with at least the raw_oauth escape hatch,
      // so a non-planned path always exists; the fallback keeps types honest.
      actionable_path_kind: actionable?.kind ?? "raw_oauth",
      verification_requirement: restrictedScopeDisclosure(need.required_scopes),
      scopes: [...need.required_scopes],
    });
  }

  return Array.from(byConnection.values());
}

/**
 * Default/brief depth carries the DECISION-relevant half of each connection:
 * which account, what it grants, the path you can actually act on today, and
 * any provider verification cost. The per-path prose (how/reuse/caveat) is
 * build-time detail and rides only at technical/deep depth — the same
 * depth-gating the worker pipeline uses to keep the default payload small
 * (MAR-256). Nothing honesty-bearing is dropped: `actionable_path_kind` still
 * excludes any "planned" path, and `verification_requirement` still discloses
 * restricted scopes.
 *
 * export_build_brief is NOT depth-gated — DASH reads the full contract from the
 * agent.manifest.json, so no consumer loses the ranked paths.
 */
export function compactConnectionContract(
  connections: readonly ConnectionRequirement[],
): ConnectionRequirement[] {
  return connections.map((c) => ({
    ...c,
    acquisition_paths: c.acquisition_paths.map((p) => ({
      kind: p.kind,
      rank: p.rank,
      label: p.label,
      ownership_location: p.ownership_location,
      availability: p.availability,
      how: "",
      reuse: "",
    })),
  }));
}

/**
 * Layer-1 rendering: connection NAMES plus the one-authorization fact. No
 * scopes, no package names, no per-component rows — a reader at the decision
 * layer needs to know which accounts they are about to connect and that each
 * app connects on its own, nothing more.
 */
export function connectionSummaryLine(connections: readonly ConnectionRequirement[]): string {
  if (connections.length === 0) return "No external product connection required";
  const names = connections.map((c) => c.label).join(" · ");
  return `${names}. ${AUTHORIZATION_NOTE_SHORT}`;
}

/** §11 rendering for the build brief — the full ranked contract per connection. */
export function renderConnectionContract(connections: readonly ConnectionRequirement[]): string[] {
  if (connections.length === 0) return [];
  const lines = [
    "**Connection contract** _(MAR-383 — a connection is a remote MCP server you authorized once)_",
    "",
    `> ${AUTHORIZATION_NOTE}`,
    "",
  ];
  for (const c of connections) {
    lines.push(`- **${c.label}** — ${c.grants} (serves ${c.serves_components.join(", ")})`);
    if (c.verification_requirement) {
      lines.push(`  - ⚠️ ${c.verification_requirement}`);
    }
    for (const p of c.acquisition_paths) {
      const actionable = p.kind === c.actionable_path_kind ? " ← do this today" : "";
      lines.push(
        `  ${p.rank}. ${p.label} — _${p.availability}_, token held by \`${p.ownership_location}\`${actionable}`,
      );
      lines.push(`     ${p.how}`);
      if (p.caveat) lines.push(`     _${p.caveat}_`);
    }
  }
  return lines;
}
