import type { ReviewContext, ReviewFinding, ReviewRule } from "../types.js";

/**
 * MAR-117 — credential/permission resilience at design time.
 *
 * Components that call an authenticated external service with an expirable
 * credential (token / API key / OAuth scope). Without a credential-failure path
 * the workflow dies silently when a token expires or a scope is revoked.
 */
const CREDENTIALED_EXTERNAL_COMPONENTS = new Set([
  "external_publish",
  "optional_email_send",
  "calendar_write",
  "crm_note_write",
  "data_scraper",
]);

/**
 * Warns (medium) when a route uses an external integration with expirable
 * credentials but has no credential-failure path (auth_failure_handler).
 *
 * Medium, not high: this is graceful-degradation resilience, not an
 * irreversibility/safety gap — it should surface as a warning, not block the
 * design. The compose/plan_workflow augmenter injects auth_failure_handler
 * automatically, so this rule mainly catches user-supplied designs (and
 * validated playbooks that predate the credential-resilience guidance).
 */
const externalIntegrationWithoutCredentialPath: ReviewRule = (
  ctx: ReviewContext,
): ReviewFinding[] => {
  if (ctx.hasAuthFailureHandler) return [];

  const credentialed = ctx.componentIds.filter((id) =>
    CREDENTIALED_EXTERNAL_COMPONENTS.has(id),
  );
  if (credentialed.length === 0) return [];

  return [
    {
      severity: "medium",
      category: "tool_safety",
      message:
        `External integration(s) ${credentialed.map((c) => `\`${c}\``).join(", ")} ` +
        "have no credential-failure path. They will die silently when a token expires or a scope is revoked.",
      reason:
        "Tokens expire and scopes get revoked. Without a handler the agent 'works, then breaks' " +
        "mid-run with no recovery and no clear signal about which permission failed.",
      recommended_fix:
        "Add `auth_failure_handler` (token-expired → refresh → retry-with-backoff → alert/halt) to the route. " +
        "Provision the credentials via a named secret manager (1Password, Doppler, HashiCorp Vault, or env + OIDC) " +
        "with least-privilege scopes — never store credentials in the workflow itself.",
      entity_ref: {
        entity_type: "component" as const,
        entity_id: credentialed[0]!,
      },
    },
  ];
};

export const credentialRules: ReviewRule[] = [
  externalIntegrationWithoutCredentialPath,
];
