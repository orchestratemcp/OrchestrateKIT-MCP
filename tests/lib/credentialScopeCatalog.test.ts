/**
 * P0-05 — single credential/scope catalog.
 *
 * Every surface that renders a Gmail/Calendar OAuth scope — `what_you_need`
 * (planWorkflow.ts), the credential manifest + connect.mjs + build brief §11
 * (connectContract.ts) — must derive from `GOOGLE_SCOPE_CATALOG`
 * (credentialScopeCatalog.ts). These tests snapshot every rendered surface
 * side by side so a future edit to one without the others (or a direct edit
 * to the shared catalog) is caught here rather than shipping a split-brain
 * scope claim again.
 */
import { describe, it, expect } from "vitest";
import {
  GOOGLE_SCOPE_CATALOG,
  GMAIL_SEND_SCOPE,
  googleScopesForComponents,
} from "../../src/lib/credentialScopeCatalog.js";
import { buildCredentialManifest, buildConnectScript, s11Connect, buildConnectArtifacts } from "../../src/lib/connectContract.js";
import { planWorkflow } from "../../src/tools/planWorkflow.js";
import { exportBuildBrief } from "../../src/tools/exportBuildBrief.js";
import { loadRegistry } from "../../src/registry/registryLoader.js";

const registry = loadRegistry();

// The P0-02 dogfood prompt: read Gmail, check Calendar, draft a reply, create
// one Calendar event + one Gmail draft after approval, never send.
const DOGFOOD_GOAL =
  "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
  "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
  "and only after I approve creates one Calendar event and one Gmail draft. " +
  "Never send the email. I will be present for approval and I want visible run logs.";

describe("GOOGLE_SCOPE_CATALOG — single source of truth", () => {
  it("email_draft never includes gmail.send (users.drafts.create needs only gmail.compose)", () => {
    expect(GOOGLE_SCOPE_CATALOG.email_draft.scopes).not.toContain(GMAIL_SEND_SCOPE);
    expect(GOOGLE_SCOPE_CATALOG.email_draft.scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
  });

  it("email_read is readonly, calendar_lookup/write are least-privilege", () => {
    expect(GOOGLE_SCOPE_CATALOG.email_read.scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(GOOGLE_SCOPE_CATALOG.calendar_lookup.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(GOOGLE_SCOPE_CATALOG.calendar_write.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("googleScopesForComponents dedupes and orders Gmail before Calendar, read before write", () => {
    expect(
      googleScopesForComponents(["calendar_write", "email_draft", "email_read", "calendar_lookup"]),
    ).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });
});

describe("P0-05 — every rendered permission surface agrees, for the golden email+calendar flow", () => {
  const plan = planWorkflow({ goal: DOGFOOD_GOAL, must_have_capabilities: [], must_avoid: [] }, registry);

  const brief = exportBuildBrief({
    goal: plan.goal,
    plan_source: plan.plan_source,
    route_status: plan.route_status,
    recommended_route: plan.recommended_route,
    safety_review: plan.safety_review,
    automation_clearance: plan.automation_clearance,
    enforced_approval_gates: plan.enforced_approval_gates,
    untested_edges: plan.untested_edges,
    avoid_when_violations: plan.avoid_when_violations,
    evals_to_add: plan.evals_to_add,
    design_notes: plan.design_notes,
    worker_pipeline: plan.worker_pipeline,
    loop_guidance: plan.loop_guidance,
    approval_gate_advisory: plan.approval_gate_advisory,
    handoff_targets: ["prompt"],
    llm_provider: "anthropic",
  });

  const routeIds = plan.recommended_route.map((s) => s.component_id);
  const manifest = buildCredentialManifest(
    plan.recommended_route.map((s) => ({ component_id: s.component_id, model_tier: s.model_tier })),
    { llm_provider: "anthropic" },
  );
  const refresh = manifest.find((c) => c.env === "GMAIL_REFRESH_TOKEN");
  const connectArtifacts = buildConnectArtifacts({
    route_steps: plan.recommended_route.map((s) => ({
      component_id: s.component_id,
      model_tier: s.model_tier,
    })),
    agent_name: "p0-05-golden-flow",
    registry_fingerprint: "test-fingerprint",
    llm_provider: "anthropic",
  });
  const script = buildConnectScript(manifest, {
    agent_name: "p0-05-golden-flow",
    registry_fingerprint: "test-fingerprint",
  });
  const s11 = s11Connect(connectArtifacts);

  it("the dogfood goal actually routes through email_draft and calendar_write", () => {
    // guards the rest of this suite against silently testing the wrong route
    expect(routeIds).toContain("email_draft");
    expect(routeIds).toContain("calendar_write");
    // P0-04: the post-approval draft SAVE is the surface most likely to attract a
    // send scope. If it ever drops out of the route, every gmail.send assertion
    // below would pass vacuously.
    expect(routeIds).toContain("gmail_draft_write");
  });

  it("what_you_need renders gmail.compose (never gmail.send) for the draft component", () => {
    const draftNeed = plan.what_you_need.find((n) => n.component_id === "email_draft");
    expect(draftNeed?.required_scopes).toEqual(["https://www.googleapis.com/auth/gmail.compose"]);
    expect(draftNeed?.required_scopes).not.toContain(GMAIL_SEND_SCOPE);
  });

  it("P0-04: the draft SAVE renders gmail.compose, never gmail.send", () => {
    // Saving a draft is where "we need send access" is the tempting wrong answer:
    // users.drafts.create accepts gmail.compose, and granting send here would hand
    // the agent a capability the whole route exists to withhold.
    const saveNeed = plan.what_you_need.find((n) => n.component_id === "gmail_draft_write");
    expect(saveNeed?.required_scopes).toEqual(["https://www.googleapis.com/auth/gmail.compose"]);
    expect(saveNeed?.required_scopes).not.toContain(GMAIL_SEND_SCOPE);
  });

  it("connectContract's GMAIL_REFRESH_TOKEN oauth scopes never include gmail.send", () => {
    expect(refresh?.oauth?.scopes).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(refresh?.oauth?.scopes).not.toContain(GMAIL_SEND_SCOPE);
  });

  it("build brief §11 never mentions gmail.send", () => {
    expect(s11).toContain("§11 Connect");
    expect(s11).not.toContain("gmail.send");
  });

  it("the generated connect.mjs script embeds the same scopes and never requests gmail.send", () => {
    expect(script).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(script).not.toContain("gmail.send");
  });

  it("the full build brief markdown never requests gmail.send", () => {
    expect(brief.brief_markdown).not.toContain("gmail.send");
  });

  it("snapshot: every rendered permission surface for the golden flow, side by side", () => {
    expect({
      what_you_need_scopes: Object.fromEntries(
        plan.what_you_need.map((n) => [n.component_id, n.required_scopes]),
      ),
      credential_manifest_oauth_scopes: refresh?.oauth?.scopes,
      s11_credential_lines: s11
        .split("\n")
        .filter((line) => line.startsWith("- `")),
    }).toMatchSnapshot();
  });
});
