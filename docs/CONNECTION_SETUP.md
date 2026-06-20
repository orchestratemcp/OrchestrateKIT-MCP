# OrchestrateMCP — Connection Setup Guide (CTX-01)

You connected OrchestrateMCP to your AI client and `plan_workflow` gave you a
route. Now the route has steps like **"read your email inbox"**, **"post to
Slack"**, or **"update a CRM note"** — and those steps need **credentials** for
*your* third-party services.

This is the "how do I actually connect Gmail / Slack / Stripe?" wall. This guide
covers it.

> **First, the boundary that never changes.** OrchestrateMCP is a **design-time
> advisor**. It is read-only, stateless, and **never holds, stores, or transmits
> a credential** — yours or anyone's. It tells you *which* steps need access and
> *how to provision it safely*. The actual credentials live in **your** runtime,
> your secret manager, or a managed-auth broker you control. Nothing in this
> guide asks you to give a secret to OrchestrateMCP, and nothing ever will.

---

## Two different "connections" — don't confuse them

| Layer | What connects | Auth | Where it's documented |
|---|---|---|---|
| **1. Client ↔ MCP** | Your AI client (ChatGPT / Claude / Cursor) ↔ the OrchestrateMCP endpoint | **None** — it's a public read-only advisor | [CHATGPT_USAGE.md](CHATGPT_USAGE.md), [CLAUDE_DESKTOP_USAGE.md](CLAUDE_DESKTOP_USAGE.md), [CURSOR_USAGE.md](CURSOR_USAGE.md), [LOCAL_SETUP.md](LOCAL_SETUP.md) |
| **2. Workflow ↔ your services** | The workflow you *build* ↔ Gmail, Slack, Stripe, your CRM… | **Real OAuth / API keys**, your responsibility | **This guide** |

Layer 1 is trivial (point a URL, no login). Layer 2 is the one that actually
takes work, and it's where most people get stuck.

---

## What the planner already tells you

Every `plan_workflow` result includes a **`credential_advisory`** block. For a
route that reads an inbox and publishes externally you'll see something like:

```json
"credential_advisory": {
  "components_requiring_credentials": [
    { "component_id": "email_read", "required_scopes": ["mailbox read scope"] },
    { "component_id": "external_publish", "required_scopes": ["external platform API"] }
  ],
  "secret_manager_recommendation":
    "Provision credentials via a named secret manager (1Password, Doppler, HashiCorp Vault, or env + OIDC) with least-privilege scopes. OrchestrateMCP is advisory and never stores credentials."
}
```

The scopes are the ones each component declares in the registry. That tells you
**which steps need credentials and the least-privilege access they need**. This
guide is the next step: *how* to provision them.

---

## Capability → service → auth model

The route components that need credentials map to real services like this. Use
it to translate a plan step into "what do I go connect."

| Component (route step) | Typical service | Auth model | Least-privilege scope hint |
|---|---|---|---|
| `email_read` | Gmail / Outlook / IMAP | OAuth 2.0 | read-only mailbox |
| `optional_email_send` | Gmail / SMTP / SendGrid | OAuth 2.0 / API key | send-only |
| `calendar_lookup` | Google / Outlook Calendar | OAuth 2.0 | read-only events |
| `calendar_write` | Google / Outlook Calendar | OAuth 2.0 | write events |
| `crm_note_write` | HubSpot / Salesforce / Pipedrive | OAuth 2.0 / API key | notes write only |
| `external_publish` | CMS / social / blog | OAuth 2.0 / API key | publish to one channel |
| `data_scraper` | HTTP source / Stripe / Airtable | API key / OAuth | read-only on the source |
| `page_monitor` | HTTP source | usually none / API key | read-only |

> Scopes shown are *hints*. Always grant the **narrowest scope that makes the
> step work** — a read step should never hold a write token.

If a plan step mentions a service not in this table, call **`explain_component`**
with the component id — it describes, in plain language, what the step does and
what it talks to.

---

## Two ways to provision credentials

There is no single right answer — pick based on how technical you are and how
many services you need.

### Path A — DIY secret manager (you wire each service)

Best when you have one or two services and you're comfortable with API consoles.

1. **Create the credential** in each service's developer console (OAuth app or
   API key), granting the **least-privilege scope** from the table above.
2. **Store it in a named secret manager**, never in plaintext, never in the
   prompt, never in the repo:
   - **1Password**, **Doppler**, **HashiCorp Vault**, or **env vars + OIDC**.
3. **Reference it from your runtime** (the agent platform / script that actually
   *runs* the workflow) — load the secret at run time, use it, never log it.
4. Rotate on a schedule; revoke immediately if a step is removed.

This is exactly what the planner's `secret_manager_recommendation` points at.

### Path B — managed-auth broker (one place for all connections)

Best when you have **several** integrations, want a clean OAuth "Connect"
button, and don't want to babysit tokens, refresh, and rotation yourself. A
broker holds the OAuth dance and hands your runtime short-lived tokens.

- **[Nango](https://www.nango.dev/)** — **open-source, self-hostable** (the
  recommended starting point: you keep custody, no third party holds your users'
  secrets).
- **Composio** / **Pipedream Connect** — hosted alternatives with large
  connector catalogs (convenient, but a third party brokers the auth — weigh
  that trade-off).

> **OrchestrateMCP only *recommends* a broker — it never becomes one.** A broker
> is a custodian of third-party secrets; the public MCP deliberately is not (see
> the product split). If you adopt a broker, it's *your* deployment, holding
> *your* tokens.

**Rule of thumb:** 1–2 services → Path A. Several services, or you want
non-technical users to click "Connect Gmail" → Path B (start with self-hosted
Nango).

---

## Safety checklist (before you run anything)

- [ ] Every credential is **least-privilege** (read steps hold read-only tokens).
- [ ] No secret is ever pasted into the prompt, the agent, or OrchestrateMCP.
- [ ] Secrets live in a **secret manager or broker**, not in code or plaintext.
- [ ] Any **write / publish / send** step has a **human approval gate** unless
      you've *deliberately* waived it (the plan's `approval` line will say
      `❌ REQUIRED but NOT enforced` if a needed gate is missing).
- [ ] You can **rotate and revoke** every credential.
- [ ] An `auth_failure_handler` step is present for external integrations (the
      planner adds it) so an expired token fails loudly, not silently.

---

## Where this is headed

Today CTX-01 is this **guide**. The connection knowledge (per-service auth
models, scopes, broker mappings) may later be surfaced **structured** — e.g. as
registry metadata or a dedicated tool so the planner can name the exact setup
steps inline. That structuring (and which broker, if any, to feature
prominently) is an open product decision, intentionally not baked in yet. A
companion catalog of external apps + their MCP servers is tracked separately
(CTX-02).

---

*OrchestrateMCP is advisory and stores no credentials. Provision least-privilege
access in your own secret manager or broker, and gate every external write.*
