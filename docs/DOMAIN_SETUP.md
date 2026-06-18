# Domain Setup — orchestratemcp.dev (Cloudflare DNS + Vercel + Worker)

Step-by-step for wiring the purchased domain to the two surfaces.

## Target topology

| Hostname | Points to | Serves |
|---|---|---|
| `orchestratemcp.dev` (apex) | **Vercel** | the marketing / onboarding site |
| `www.orchestratemcp.dev` | **Vercel** | redirect to apex (or vice-versa) |
| `mcp.orchestratemcp.dev` | **Cloudflare Worker** | the live MCP endpoint (`/mcp`, `/health`) |

DNS is managed at **Cloudflare** (domain registered there). Vercel and the
Worker are pointed at via DNS records.

**Prereqs:** domain in Cloudflare (done) · a Vercel project for the site
(WEB-01) · the Worker deployed (done).

---

## Part 1 — Apex + www → Vercel

1. **Vercel** → your site project → **Settings → Domains → Add Domain**.
   - Add `orchestratemcp.dev` (set as **primary**).
   - Add `www.orchestratemcp.dev` (Vercel will offer to redirect it to the apex
     — accept).
2. Vercel shows the **exact DNS records** it wants. As of writing they are:
   - Apex `orchestratemcp.dev` → **A** record → `76.76.21.21`
   - `www` → **CNAME** → `cname.vercel-dns.com`

   > Always use the values **Vercel's dashboard currently shows you** — the apex
   > IP can change. Don't trust a hardcoded value (including the one above).
3. **Cloudflare** → your domain → **DNS → Records** → add those records exactly.
4. **Set each Vercel record to "DNS only" (grey cloud), NOT proxied (orange
   cloud).** Vercel terminates its own TLS; proxying it through Cloudflare's
   orange cloud on top is the #1 cause of "too many redirects" / cert errors.
   Grey-cloud is the simple, reliable setup.
   - *(Advanced, optional:)* if you later want Cloudflare's CDN in front of the
     site, set **SSL/TLS mode = Full** and follow Vercel's "Cloudflare" guide —
     but don't do this for v1.)
5. Back in Vercel, wait for the domain to verify (it polls) → Vercel issues the
   certificate automatically.

> **Apex alternative:** Cloudflare supports CNAME flattening, so you *may*
> instead add a **CNAME at the apex → `cname.vercel-dns.com`** (Cloudflare
> flattens it to an A record). Either approach works; the A record is the
> documented Vercel path.

---

## Part 2 — mcp.orchestratemcp.dev → the Worker

The Worker custom-domain feature manages its own DNS + cert — you do **not** add
a manual record for this.

1. **Cloudflare** → **Workers & Pages** → open the OrchestrateMCP Worker.
2. **Settings → Domains & Routes** (a.k.a. Triggers → Custom Domains) → **Add
   Custom Domain** → `mcp.orchestratemcp.dev`.
3. Cloudflare auto-creates the proxied record + edge certificate and binds it to
   the Worker. **Do not also add a manual CNAME for `mcp.`** — let the
   custom-domain feature own it (a duplicate record will conflict).
4. Verify:
   ```bash
   curl https://mcp.orchestratemcp.dev/health        # → ok
   curl -X POST https://mcp.orchestratemcp.dev/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
   # → initialize result with serverInfo + top-level instructions
   ```

---

## Part 3 — SSL/TLS + final verification

1. **Cloudflare → SSL/TLS → Overview →** set mode to **Full** (or **Full
   (strict)**).
2. Verify all three hostnames:
   - `https://orchestratemcp.dev` → site loads (Vercel), padlock valid.
   - `https://www.orchestratemcp.dev` → redirects to apex.
   - `https://mcp.orchestratemcp.dev/mcp` → MCP handshake.
3. **Update the published MCP URL** everywhere to
   `https://mcp.orchestratemcp.dev/mcp` (part of the rebrand pass — replaces the
   old `*.workers.dev` and the stale `mcp.orchestratekit.dev` reference in
   `docs/CHATGPT_USAGE.md`).

---

## Gotchas checklist

- [ ] Vercel records (apex A + www CNAME) are **grey-cloud / DNS-only**.
- [ ] You did **not** hand-create a `mcp.` record — the Worker custom domain owns it.
- [ ] Apex record value matches exactly what Vercel's dashboard shows.
- [ ] SSL/TLS mode is **Full**, not Flexible (Flexible causes redirect loops).
- [ ] Give DNS a few minutes (usually fast on Cloudflare; allow up to ~1h).
- [ ] After it's live, the `wrangler.toml` / Worker can keep serving on both the
      `*.workers.dev` URL and the custom domain — update docs to the custom one.
