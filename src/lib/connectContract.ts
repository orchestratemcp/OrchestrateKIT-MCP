/**
 * Fast-connect contract (MAR-364 / CONNECT-01).
 *
 * export_build_brief already knows every env var the planned agent needs —
 * this module turns that knowledge into two deterministic artifacts:
 *
 *   1. `credential_manifest` — per env var: provider, the deep link to the
 *      exact page where the key is minted, a format hint, and a declarative
 *      live-probe spec (one cheap API call that proves the key works).
 *   2. `connect_script` — a zero-dependency Node script (scripts/connect.mjs)
 *      the builder writes into the built repo. It reads the embedded manifest
 *      and walks the human through: open browser → paste key → live probe →
 *      write .env → optional `gh secret set` push. v2: a real Google OAuth
 *      loopback flow (no copy-paste) for the Gmail refresh token.
 *
 * STATELESS CONTRACT: like the rest of export_build_brief this makes no
 * network calls and stores nothing — the probes run later, on the user's
 * machine, inside the generated script. v3 (registry-backed connect metadata
 * per component) is deferred; v1 derives from a fixed component→credential
 * catalog below, which covers every connectable component in the registry's
 * published playbooks.
 */

// ──────────────────────────────── types ────────────────────────────────

export type CredentialProbe =
  | {
      kind: "http";
      method: "GET" | "POST";
      /** `{{VALUE}}` is replaced with the pasted credential at probe time. */
      url: string;
      headers?: Record<string, string>;
      body?: string;
      /** Statuses that prove the credential is live (e.g. Slack returns 400
       * "no_text" for a VALID webhook probed with an empty body — the 404 is
       * the invalid case). */
      ok_statuses: number[];
      note?: string;
    }
  | {
      kind: "google_refresh";
      client_id_env: string;
      client_secret_env: string;
      /** Endpoint probed with the refreshed access token. */
      profile_url: string;
      /** Response field echoed to the user as proof (e.g. "emailAddress"). */
      success_field: string;
    }
  | { kind: "none"; note: string };

export type CredentialRequirement = {
  env: string;
  provider: string;
  label: string;
  /** false = the agent has a graceful local fallback without it. */
  required: boolean;
  /** false = safe to echo (URLs, client ids); true = mask + gh-secret it. */
  secret: boolean;
  required_by: string[];
  /** Deep link to the exact page where the key is minted. */
  mint_url: string;
  mint_hint: string;
  connect: "paste" | "google_oauth";
  format_hint?: string;
  /** Regex source string — pre-probe sanity check inside connect.mjs. */
  format_pattern?: string;
  oauth?: {
    scopes: string[];
    client_id_env: string;
    client_secret_env: string;
  };
  probe: CredentialProbe;
};

export type ConnectArtifacts = {
  /** Where the builder should write the script inside the built repo. */
  script_path: "scripts/connect.mjs";
  credential_manifest: CredentialRequirement[];
  /** Full source of scripts/connect.mjs with the manifest embedded. */
  connect_script: string;
  instructions: string;
};

type RouteStepLike = {
  component_id: string;
  model_tier?: string;
};

// ─────────────────────── component → credential catalog ───────────────────────

const GMAIL_OAUTH_SCOPES = [
  // Read leads + create drafts. The demo agent is draft-only by contract, so
  // gmail.send is deliberately NOT requested.
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const GMAIL_COMPONENTS = ["email_read", "optional_email_send", "email_send"];
const SLACK_COMPONENTS = ["slack_notification"];
const CRM_COMPONENTS = ["crm_note_write", "crm_update"];

function gmailCredentials(requiredBy: string[]): CredentialRequirement[] {
  return [
    {
      env: "GMAIL_CLIENT_ID",
      provider: "google",
      label: "Google OAuth client ID",
      required: true,
      secret: false,
      required_by: requiredBy,
      mint_url: "https://console.cloud.google.com/apis/credentials",
      mint_hint:
        "Create an OAuth client ID of type 'Desktop app' (Desktop clients accept the loopback " +
        "redirect connect.mjs uses). Enable the Gmail API for the project first: " +
        "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
      connect: "paste",
      format_hint: "ends with .apps.googleusercontent.com",
      format_pattern: "\\.apps\\.googleusercontent\\.com$",
      probe: {
        kind: "none",
        note: "Validated together with GMAIL_REFRESH_TOKEN by the OAuth token exchange.",
      },
    },
    {
      env: "GMAIL_CLIENT_SECRET",
      provider: "google",
      label: "Google OAuth client secret",
      required: true,
      secret: true,
      required_by: requiredBy,
      mint_url: "https://console.cloud.google.com/apis/credentials",
      mint_hint: "Shown on the same OAuth client page as the client ID.",
      connect: "paste",
      format_hint: "starts with GOCSPX-",
      format_pattern: "^GOCSPX-",
      probe: {
        kind: "none",
        note: "Validated together with GMAIL_REFRESH_TOKEN by the OAuth token exchange.",
      },
    },
    {
      env: "GMAIL_REFRESH_TOKEN",
      provider: "google",
      label: "Gmail OAuth refresh token",
      required: true,
      secret: true,
      required_by: requiredBy,
      mint_url: "https://accounts.google.com/o/oauth2/v2/auth",
      mint_hint:
        "connect.mjs mints this itself: it opens the Google consent screen and receives the " +
        "token on a localhost loopback — no copy-paste. (Fallback: paste an existing refresh " +
        "token with gmail.readonly + gmail.compose scope.)",
      connect: "google_oauth",
      oauth: {
        scopes: GMAIL_OAUTH_SCOPES,
        client_id_env: "GMAIL_CLIENT_ID",
        client_secret_env: "GMAIL_CLIENT_SECRET",
      },
      probe: {
        kind: "google_refresh",
        client_id_env: "GMAIL_CLIENT_ID",
        client_secret_env: "GMAIL_CLIENT_SECRET",
        profile_url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        success_field: "emailAddress",
      },
    },
  ];
}

function anthropicCredential(requiredBy: string[]): CredentialRequirement {
  return {
    env: "ANTHROPIC_API_KEY",
    provider: "anthropic",
    label: "Anthropic API key",
    required: true,
    secret: true,
    required_by: requiredBy,
    mint_url: "https://console.anthropic.com/settings/keys",
    mint_hint: "Create Key → copy once. Scope it to this workspace if you use multiple.",
    connect: "paste",
    format_hint: "starts with sk-ant-",
    format_pattern: "^sk-ant-",
    probe: {
      kind: "http",
      method: "GET",
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": "{{VALUE}}", "anthropic-version": "2023-06-01" },
      ok_statuses: [200],
    },
  };
}

function slackCredential(requiredBy: string[]): CredentialRequirement {
  return {
    env: "SLACK_WEBHOOK_URL",
    provider: "slack",
    label: "Slack incoming webhook URL",
    required: true,
    secret: true,
    required_by: requiredBy,
    mint_url: "https://api.slack.com/apps",
    mint_hint:
      "Pick (or create) your app → Incoming Webhooks → Activate → 'Add New Webhook to Workspace' " +
      "→ choose the channel → copy the URL.",
    connect: "paste",
    format_hint: "https://hooks.slack.com/services/…",
    format_pattern: "^https://hooks\\.slack\\.com/services/",
    probe: {
      kind: "http",
      method: "POST",
      url: "{{VALUE}}",
      headers: { "content-type": "application/json" },
      body: "{}",
      // A VALID webhook rejects the empty body with 400 ("no_text") — that
      // still proves the webhook exists without posting channel noise. An
      // invalid/revoked webhook returns 404/410.
      ok_statuses: [200, 400],
      note: "400 from a hooks.slack.com URL means 'webhook live, empty payload rejected' — no message is posted.",
    },
  };
}

function hubspotCredential(requiredBy: string[]): CredentialRequirement {
  return {
    env: "HUBSPOT_PRIVATE_APP_TOKEN",
    provider: "hubspot",
    label: "HubSpot private-app token",
    // The demo agent falls back to a local crm_notes.json when absent.
    required: false,
    secret: true,
    required_by: requiredBy,
    mint_url: "https://app.hubspot.com/private-apps",
    mint_hint:
      "Create a private app with scopes crm.objects.contacts.read, crm.objects.contacts.write " +
      "→ copy the access token. (Free tier is enough.)",
    connect: "paste",
    format_hint: "starts with pat-",
    format_pattern: "^pat-",
    probe: {
      kind: "http",
      method: "GET",
      url: "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
      headers: { authorization: "Bearer {{VALUE}}" },
      ok_statuses: [200],
    },
  };
}

function dashCredentials(): CredentialRequirement[] {
  const shared = {
    provider: "dash",
    required: false,
    required_by: ["observability"],
    mint_url: "http://localhost:3000/agents",
    connect: "paste" as const,
    probe: {
      kind: "none",
      note: "Optional monitoring target — validated on first agent run, not at connect time.",
    } as CredentialProbe,
  };
  return [
    {
      ...shared,
      env: "DASH_INGEST_URL",
      label: "DASH/LAB ingest endpoint (optional monitoring)",
      secret: false,
      mint_hint:
        "Your LAB/DASH instance's ingest base URL. Leave blank to keep events in the local " +
        "dash_events.jsonl fallback.",
    },
    {
      ...shared,
      env: "DASH_INGEST_TOKEN",
      label: "DASH/LAB ingest bearer token (optional monitoring)",
      secret: true,
      mint_hint: "Static per-agent bearer token from your LAB/DASH instance. Blank = local fallback.",
    },
  ];
}

/**
 * Derive the credential manifest from the planned route. Deterministic:
 * fixed catalog order (gmail → anthropic → slack → hubspot → dash), one entry
 * per env var, `required_by` merged across steps.
 */
export function buildCredentialManifest(routeSteps: RouteStepLike[]): CredentialRequirement[] {
  const byComponent = (ids: string[]) =>
    routeSteps.filter((s) => ids.includes(s.component_id)).map((s) => s.component_id);

  const manifest: CredentialRequirement[] = [];

  const gmailBy = byComponent(GMAIL_COMPONENTS);
  if (gmailBy.length > 0) manifest.push(...gmailCredentials(gmailBy));

  // Any step with a real model tier is an LLM call — the built agents call
  // the Claude API directly, so one Anthropic key covers all of them.
  const llmBy = routeSteps
    .filter((s) => s.model_tier !== undefined && s.model_tier !== "none")
    .map((s) => s.component_id);
  if (llmBy.length > 0) manifest.push(anthropicCredential(llmBy));

  const slackBy = byComponent(SLACK_COMPONENTS);
  if (slackBy.length > 0) manifest.push(slackCredential(slackBy));

  const crmBy = byComponent(CRM_COMPONENTS);
  if (crmBy.length > 0) manifest.push(hubspotCredential(crmBy));

  // Every brief carries the DASH monitoring contract (§9), so the optional
  // ingest pair is always offered.
  manifest.push(...dashCredentials());

  return manifest;
}

// ─────────────────────────── connect.mjs template ───────────────────────────
//
// NOTE ON STYLE: the generated script uses ONLY single-quoted strings and
// concatenation (no template literals), so this TS template literal needs no
// escaping and stays diff-readable. Zero dependencies, Node >= 18 (fetch).

const CONNECT_SCRIPT_TEMPLATE = `#!/usr/bin/env node
// scripts/connect.mjs — fast credential connect for "__AGENT_NAME__"
// Generated by orchestratekit-mcp export_build_brief (MAR-364).
// Registry fingerprint: __FINGERPRINT__
//
// What it does, per credential in the embedded manifest:
//   1. opens your browser at the exact page where the key is minted
//   2. you paste the key (input is masked; Gmail uses a real OAuth consent
//      flow on a localhost loopback instead — no copy-paste)
//   3. validates it with one cheap live API probe
//   4. writes it into .env next to this agent (never committed)
//   5. optionally pushes GitHub Actions secrets via 'gh secret set'
//
// Usage:
//   node scripts/connect.mjs             guided connect (skips already-valid vars)
//   node scripts/connect.mjs --check     probe existing values only; exit 1 if a required one fails
//   node scripts/connect.mjs --secrets   also push connected secret vars to GitHub Actions
//   node scripts/connect.mjs --only A,B  limit to specific env vars
//   node scripts/connect.mjs --yes       no confirmation prompts (browser tabs, gh push)
//
// Zero dependencies. Node >= 18. Values can also be piped on stdin (one per
// prompt) for non-interactive use.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MANIFEST = __MANIFEST_JSON__;

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(AGENT_ROOT, '.env');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const PUSH_SECRETS = args.includes('--secrets');
const ASSUME_YES = args.includes('--yes');
const onlyArg = args[args.indexOf('--only') + 1];
const ONLY = args.includes('--only') && onlyArg ? onlyArg.split(',').map(function (s) { return s.trim(); }) : null;

// ─── .env read/write (merge, never clobber unrelated lines) ───

function readEnvFile() {
  const map = new Map();
  if (!fs.existsSync(ENV_PATH)) return map;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\\r?\\n/)) {
    const m = line.match(/^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function writeEnvVar(name, value) {
  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split(/\\r?\\n/) : [];
  // drop one trailing blank line so appends stay tidy
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let replaced = false;
  lines = lines.map(function (line) {
    if (line.match(new RegExp('^\\\\s*' + name + '\\\\s*='))) { replaced = true; return name + '=' + value; }
    return line;
  });
  if (!replaced) lines.push(name + '=' + value);
  fs.writeFileSync(ENV_PATH, lines.join('\\n') + '\\n', 'utf8');
}

function ensureGitignored() {
  // walk up from the agent root looking for the repo's .gitignore
  let dir = AGENT_ROOT;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      const gi = path.join(dir, '.gitignore');
      const content = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      if (!/^\\s*\\*{0,2}\\/?\\.env\\b/m.test(content) && !/^\\.env$/m.test(content)) {
        fs.appendFileSync(gi, (content.endsWith('\\n') || content === '' ? '' : '\\n') + '.env\\n');
        console.log('  added .env to ' + path.relative(AGENT_ROOT, gi));
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

// ─── prompts ───

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  else if (platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
  else spawnSync('xdg-open', [url], { stdio: 'ignore' });
}

function ask(question, mask) {
  return new Promise(function (resolve) {
    // Piped/non-TTY stdin can already be exhausted from an earlier prompt — a
    // readline created on an ended stream never resolves its question, so Node
    // would exit 0 with the summary (and the failure exit code) silently
    // skipped. Treat exhausted stdin as an empty answer instead.
    if (!process.stdin.isTTY && (process.stdin.readableEnded || process.stdin.destroyed)) {
      process.stdout.write(question + '(stdin exhausted)\\n');
      resolve('');
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    let done = false;
    const finish = function (answer) {
      if (done) return;
      done = true;
      rl.close();
      if (mask && process.stdin.isTTY) process.stdout.write('\\n');
      resolve(answer.trim());
    };
    // Piped/non-TTY stdin can be exhausted mid-run — without this, a pending
    // question never resolves and Node exits 0 with the summary (and the
    // failure exit code) silently skipped.
    rl.on('close', function () { finish(''); });
    rl.question(question, finish);
  });
}

async function confirm(question) {
  if (ASSUME_YES || !process.stdin.isTTY) return true;
  const a = await ask(question + ' [Y/n] ', false);
  return a === '' || a.toLowerCase() === 'y' || a.toLowerCase() === 'yes';
}

// ─── probes ───

async function probeHttp(spec, value) {
  const sub = function (s) { return s.split('{{VALUE}}').join(value); };
  const headers = {};
  for (const k of Object.keys(spec.headers || {})) headers[k] = sub(spec.headers[k]);
  try {
    const res = await fetch(sub(spec.url), {
      method: spec.method,
      headers: headers,
      body: spec.body !== undefined ? sub(spec.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (spec.ok_statuses.includes(res.status)) return { ok: true, detail: 'HTTP ' + res.status };
    return { ok: false, detail: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
  } catch (err) {
    return { ok: false, detail: String(err && err.message || err) };
  }
}

async function googleAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'token endpoint HTTP ' + res.status);
  return data.access_token;
}

async function probeGoogleRefresh(spec, value, envMap) {
  const clientId = envMap.get(spec.client_id_env);
  const clientSecret = envMap.get(spec.client_secret_env);
  if (!clientId || !clientSecret) return { ok: false, detail: 'needs ' + spec.client_id_env + ' + ' + spec.client_secret_env + ' first' };
  try {
    const accessToken = await googleAccessToken(clientId, clientSecret, value);
    const res = await fetch(spec.profile_url, {
      headers: { authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, detail: 'profile HTTP ' + res.status };
    return { ok: true, detail: String(data[spec.success_field] || 'connected') };
  } catch (err) {
    return { ok: false, detail: String(err && err.message || err) };
  }
}

async function probe(cred, value, envMap) {
  if (cred.format_pattern && !new RegExp(cred.format_pattern).test(value)) {
    return { ok: false, detail: 'format check failed — expected: ' + (cred.format_hint || cred.format_pattern) };
  }
  if (cred.probe.kind === 'http') return probeHttp(cred.probe, value);
  if (cred.probe.kind === 'google_refresh') return probeGoogleRefresh(cred.probe, value, envMap);
  return { ok: true, detail: 'not probed (' + cred.probe.note + ')' };
}

// ─── v2: Google OAuth loopback (no copy-paste) ───

async function googleOauthLoopback(cred, envMap) {
  const clientId = envMap.get(cred.oauth.client_id_env);
  const clientSecret = envMap.get(cred.oauth.client_secret_env);
  if (!clientId || !clientSecret) return null;

  return new Promise(function (resolve) {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const redirectUri = 'http://127.0.0.1:' + port + '/oauth/callback';
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: cred.oauth.scopes.join(' '),
      }).toString();

      const timer = setTimeout(function () { server.close(); resolve(null); }, 180000);

      server.on('request', async function (req, res) {
        const url = new URL(req.url, 'http://127.0.0.1:' + port);
        if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
        const code = url.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(code
          ? '<h2>Connected — you can close this tab and go back to the terminal.</h2>'
          : '<h2>No code received — go back to the terminal and retry.</h2>');
        clearTimeout(timer);
        server.close();
        if (!code) { resolve(null); return; }
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: code, client_id: clientId, client_secret: clientSecret,
              redirect_uri: redirectUri, grant_type: 'authorization_code',
            }).toString(),
          });
          const data = await tokenRes.json();
          resolve(data.refresh_token || null);
        } catch (err) {
          console.error('  token exchange failed: ' + String(err && err.message || err));
          resolve(null);
        }
      });

      console.log('  opening Google consent screen (loopback on port ' + port + ', 3 min timeout)…');
      openBrowser(authUrl);
    });
  });
}

// ─── gh secret push ───

function pushGithubSecrets(connected) {
  const secrets = connected.filter(function (c) { return c.cred.secret && c.value; });
  if (secrets.length === 0) { console.log('no secret vars to push.'); return; }
  const ghCheck = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (ghCheck.error || ghCheck.status !== 0) {
    console.log('gh CLI not available/authenticated — skipping GitHub secrets push.');
    return;
  }
  for (const c of secrets) {
    // value via stdin so it never appears in the process arg list
    const r = spawnSync('gh', ['secret', 'set', c.cred.env], {
      input: c.value, encoding: 'utf8', shell: process.platform === 'win32',
    });
    console.log((r.status === 0 ? '  pushed ' : '  FAILED to push ') + c.cred.env + (r.status === 0 ? '' : ': ' + (r.stderr || '').trim()));
  }
}

// ─── main ───

async function main() {
  const wanted = ONLY ? MANIFEST.filter(function (c) { return ONLY.includes(c.env); }) : MANIFEST;
  console.log('connect — __AGENT_NAME__');
  console.log((CHECK_ONLY ? 'probe-only mode: ' : 'guided connect: ') + wanted.length + ' credential(s) in manifest\\n');

  const envMap = readEnvFile();
  for (const [k, v] of Object.entries(process.env)) {
    if (!envMap.has(k) && MANIFEST.some(function (c) { return c.env === k; })) envMap.set(k, v);
  }

  const results = [];
  for (const cred of wanted) {
    const existing = envMap.get(cred.env);
    process.stdout.write('› ' + cred.env + ' (' + cred.label + ')' + (cred.required ? '' : ' [optional]') + '\\n');

    if (existing) {
      const r = await probe(cred, existing, envMap);
      if (r.ok) {
        console.log('  ✅ existing value valid — ' + r.detail + '\\n');
        results.push({ cred: cred, status: 'connected', value: existing, detail: r.detail });
        continue;
      }
      console.log('  ⚠️ existing value FAILED probe — ' + r.detail);
      if (CHECK_ONLY) { results.push({ cred: cred, status: 'failed', value: existing, detail: r.detail }); console.log(''); continue; }
    } else if (CHECK_ONLY) {
      console.log('  ' + (cred.required ? '❌ missing' : '⏭️ not set (optional)') + '\\n');
      results.push({ cred: cred, status: cred.required ? 'failed' : 'skipped', value: '', detail: 'not set' });
      continue;
    }

    if (!cred.required && !process.stdin.isTTY) {
      console.log('  ⏭️ optional — skipping (non-interactive)\\n');
      results.push({ cred: cred, status: 'skipped', value: '', detail: 'optional, non-interactive' });
      continue;
    }
    if (!cred.required) {
      const want = await confirm('  optional — connect it now?');
      if (!want) { console.log('  ⏭️ skipped\\n'); results.push({ cred: cred, status: 'skipped', value: '', detail: 'skipped by user' }); continue; }
    }

    let value = '';
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      if (cred.connect === 'google_oauth' && process.stdin.isTTY) {
        value = await googleOauthLoopback(cred, envMap) || '';
        if (!value) {
          console.log('  loopback flow did not return a refresh token — falling back to paste.');
          console.log('  mint: ' + cred.mint_url + '\\n  hint: ' + cred.mint_hint);
          value = await ask('  paste ' + cred.env + ': ', cred.secret);
        }
      } else {
        if (attempt === 1) {
          console.log('  mint: ' + cred.mint_url + '\\n  hint: ' + cred.mint_hint);
          if (process.stdin.isTTY && await confirm('  open browser?')) openBrowser(cred.mint_url);
        }
        value = await ask('  paste ' + cred.env + (cred.format_hint ? ' (' + cred.format_hint + ')' : '') + ': ', cred.secret);
      }
      if (!value) { console.log('  empty — skipping.'); break; }

      const r = await probe(cred, value, envMap);
      if (r.ok) {
        writeEnvVar(cred.env, value);
        envMap.set(cred.env, value);
        console.log('  ✅ connected — ' + r.detail + ' (written to .env)\\n');
        results.push({ cred: cred, status: 'connected', value: value, detail: r.detail });
        value = '__DONE__';
        break;
      }
      console.log('  ❌ probe failed — ' + r.detail + (attempt < 3 ? ' (retry ' + attempt + '/3)' : ''));
    }
    if (value !== '__DONE__') {
      results.push({ cred: cred, status: cred.required ? 'failed' : 'skipped', value: '', detail: 'no valid value provided' });
      console.log('');
    }
  }

  if (!CHECK_ONLY && results.some(function (r) { return r.status === 'connected'; })) ensureGitignored();

  const connected = results.filter(function (r) { return r.status === 'connected'; });
  const failed = results.filter(function (r) { return r.status === 'failed'; });
  const requiredTotal = wanted.filter(function (c) { return c.required; }).length;
  const requiredOk = connected.filter(function (r) { return r.cred.required; }).length;

  console.log('──────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'connected' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    console.log(icon + ' ' + r.cred.env + ' — ' + r.detail);
  }
  console.log('──────────────────────────────');
  console.log(requiredOk + '/' + requiredTotal + ' required credential(s) connected' + (connected.length > requiredOk ? ' (+' + (connected.length - requiredOk) + ' optional)' : ''));

  if (PUSH_SECRETS) {
    if (ASSUME_YES || await confirm('push connected secrets to GitHub Actions via gh?')) pushGithubSecrets(connected);
  } else if (!CHECK_ONLY && connected.length > 0) {
    console.log("re-run with --secrets to push these to GitHub Actions ('gh secret set').");
  }

  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch(function (err) {
  console.error('connect.mjs crashed: ' + (err && err.stack || err));
  process.exitCode = 1;
});
`;

/** Build the connect.mjs source with the manifest embedded. Deterministic —
 * no timestamps, so generated scripts can be sync-tested against checked-in
 * copies. */
export function buildConnectScript(
  manifest: CredentialRequirement[],
  opts: { agent_name: string; registry_fingerprint: string },
): string {
  return CONNECT_SCRIPT_TEMPLATE
    .split("__AGENT_NAME__").join(opts.agent_name)
    .split("__FINGERPRINT__").join(opts.registry_fingerprint)
    .replace("__MANIFEST_JSON__", () => JSON.stringify(manifest, null, 2));
}

export function buildConnectArtifacts(input: {
  route_steps: RouteStepLike[];
  agent_name: string;
  registry_fingerprint: string;
}): ConnectArtifacts {
  const credential_manifest = buildCredentialManifest(input.route_steps);
  const connect_script = buildConnectScript(credential_manifest, {
    agent_name: input.agent_name,
    registry_fingerprint: input.registry_fingerprint,
  });
  const required = credential_manifest.filter((c) => c.required);
  const instructions =
    `Write the \`connect_script\` field verbatim to \`scripts/connect.mjs\` in the built repo, ` +
    `then run \`node scripts/connect.mjs\` — it opens each provider's key page, live-probes every ` +
    `pasted value, writes .env itself, and can push GitHub Actions secrets with \`--secrets\`. ` +
    `${required.length} required credential(s): ${required.map((c) => c.env).join(", ")}. ` +
    `Use \`node scripts/connect.mjs --check\` in CI or before a demo to prove all credentials are live.`;
  return {
    script_path: "scripts/connect.mjs",
    credential_manifest,
    connect_script,
    instructions,
  };
}

/** §11 section for the brief markdown. */
export function s11Connect(artifacts: ConnectArtifacts): string {
  const lines = [
    "**§11 Connect — fast credential setup** _(MAR-364 — deterministic manifest, probes run on the user's machine)_",
    "",
    `Write \`connect_script\` to \`${artifacts.script_path}\` and run \`node ${artifacts.script_path}\`: ` +
      "deep-link → paste (or Google OAuth loopback) → live probe → .env → optional `gh secret set`.",
    "",
  ];
  for (const c of artifacts.credential_manifest) {
    const req = c.required ? "required" : "optional";
    lines.push(
      `- \`${c.env}\` (${c.label}, ${req}) — mint at ${c.mint_url} — needed by ${c.required_by.map((r) => `\`${r}\``).join(", ")}`,
    );
  }
  lines.push(
    "",
    "> The MCP never sees these values — the manifest is metadata (env names, mint links, probe " +
      "specs); the script runs locally and writes only your local .env / GitHub secrets.",
  );
  return lines.join("\n");
}
