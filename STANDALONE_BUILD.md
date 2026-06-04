# Standalone Thingy — Historical Build Brief

> Status: completed. Thingy now runs as its own surface at
> `thingy.thingelstad.com`. This file is retained as the original build brief;
> current operating notes live in `apps/thingy_bridge/README.md` and
> `apps/thingy_bridge/CLAUDE.md`.

Promote Thingy from a page on the newsletter site (`weekly.thingelstad.com/thingy/`) to a
complete standalone app at **thingy.thingelstad.com**. Strangler approach: build to parity, run
both in parallel, redirect the Weekly page only once the standalone proves out.

> **This is Phase 1 of `THINGY_ROADMAP.md`.** Port the *current* subscriber-check auth **as-is** —
> magic-link auth, SES, and identity-aware modes are Phase 2, so don't over-invest in the current
> auth UI here. DNS is already set: `thingy.thingelstad.com` CNAME → GitHub.

## Decisions (locked)

- **Stack:** 11ty (consistent with weekly + another.thingelstad.com; zero new lock-in). The
  front-end is a thin client; "smarter Thingy" and richer auth grow in the Lambdas, not here.
- **Identity:** its own light chrome — Thingy-first hero + chat card, reusing the existing Thingy
  art, but no newsletter header/footer.
- **Backend:** unchanged. Same Librarian + Auth Lambdas. Auth is already bearer-token + email-based,
  so cross-origin "just works" (no cookie/SameSite issues).

## Why this is small

The `/thingy/` page (`weekly.thingelstad.com/apps/site/librarian.njk`, ~1,140 lines) is already a
self-contained, API-driven client. It only borrows three things from the newsletter site, all easy
to replace:
1. Layout — `layout: layouts/base.njk` → swap for Thingy's own base.
2. Styles — `thingy-*` / `librarian-*` rules live in `apps/site/css/style.css` → extract.
3. Config — API URLs from `apps/site/_data/site.js`:
   - `librarianApiUrl` → `https://k0yklt9vg3.execute-api.us-east-1.amazonaws.com` (env `LIBRARIAN_API_URL`)
   - `librarianStreamUrl` → `https://jcvud66qqpq53frvno5stoqntm0zqntw.lambda-url.us-east-1.on.aws/` (env `LIBRARIAN_STREAM_URL`)

Everything else — auth flow, SSE streaming chat, scope selector, feedback reactions — lifts over as-is.

## Proposed repo layout

```
thingy.thingelstad.com/
  apps/
    thingy_bridge/                 ← existing Discord bot, unchanged
  web/                             ← NEW standalone 11ty site
    package.json
    eleventy.config.js
    _data/site.js                  ← librarianApiUrl / librarianStreamUrl (+ env overrides)
    _includes/layouts/base.njk     ← Thingy's own chrome (light identity)
    css/thingy.css                 ← extracted thingy-* / librarian-* rules
    img/thingy.png                 ← copied asset
    index.njk                      ← ported chat (permalink "/"), newsletter chrome stripped
    CNAME                          ← thingy.thingelstad.com
  .github/workflows/deploy.yml     ← build web/ → GitHub Pages
```

## Build steps

1. **Scaffold** the `web/` 11ty site (package.json, eleventy.config.js, base layout with the light
   Thingy identity — hero + chat card only).
2. **Port** `librarian.njk` → `web/index.njk` at `permalink: "/"`. Keep all the client JS (auth,
   streaming, scope, feedback). Replace the `base.njk` dependency with Thingy's own base layout.
3. **Extract CSS** — pull the `thingy-*` / `librarian-*` rules out of `apps/site/css/style.css` into
   `web/css/thingy.css`, plus whatever shared tokens (fonts, colors, container widths) they rely on.
4. **Config** — `web/_data/site.js` carrying the two Librarian URLs above, with `LIBRARIAN_API_URL` /
   `LIBRARIAN_STREAM_URL` env overrides for local dev.
5. **Assets** — copy `img/thingy.png` (and the favicon).
6. **Deploy** — GitHub Actions: build `web/` → deploy to Pages; `CNAME` = thingy.thingelstad.com;
   add the DNS CNAME record at the registrar.

## One backend change (studio-thing)

Add the new origin to CORS in `studio-thing/apps/librarian/infra/cloudformation.yaml` — the
`AllowedOrigin` parameter (currently `https://weekly.thingelstad.com,http://localhost:8080,...`).
Append `https://thingy.thingelstad.com`, then redeploy the Librarian stack. That one parameter feeds
both the API Gateway `ALLOWED_ORIGIN` env (`shared/http.mjs`) and the Lambda Function URL's CORS, so
it covers both endpoints. No code change.

## Coexistence → cutover

- Leave `weekly.thingelstad.com/thingy/` running. Both front-ends hit the same API with bearer
  tokens — no conflict.
- Once the standalone is verified, replace weekly's `librarian.njk` with a redirect to
  `https://thingy.thingelstad.com/` — reuse the existing pattern in `apps/site/librarian-redirect.njk`
  (which already redirects `/librarian/` → `/thingy/`).

## Paste into Claude Code

```
Build the standalone Thingy web app per STANDALONE_BUILD.md in the thingy.thingelstad.com repo.
You have access to weekly.thingelstad.com (source to port from), thingy.thingelstad.com (target),
and studio-thing (the Librarian backend, for the CORS change).

Constraints:
- Do NOT modify or remove weekly's /thingy/ page — it must keep working in parallel.
- Match feature parity: subscriber-email auth gate, SSE streaming chat, scope selector, feedback.
- 11ty stack; Thingy's own light identity (hero + chat card, no newsletter header/footer).

Steps, pausing for my review after step 3 and before the CORS redeploy:
1. Scaffold web/ (11ty) per the proposed layout. Show me the base layout for the new identity.
2. Port librarian.njk → web/index.njk and extract the thingy-*/librarian-* CSS from
   apps/site/css/style.css into web/css/thingy.css.
3. Wire web/_data/site.js to the Librarian API URLs (with env overrides) and copy assets.
   Then run it locally and confirm auth + a streamed answer work against the live API.
4. Add the GitHub Actions deploy (Pages + CNAME). Don't enable DNS yet — I'll do the registrar step.
5. In studio-thing, add https://thingy.thingelstad.com to the CloudFormation AllowedOrigin parameter.
   Show me the diff; I'll approve before any redeploy.

Work in small steps; ask before anything that touches weekly or redeploys the backend.
```

## Verification checklist

- [ ] Standalone loads at the Pages URL with Thingy's own identity (no newsletter chrome).
- [ ] Subscriber-email auth completes; session token stored client-side.
- [ ] A question returns a streamed answer with citations against the live archive.
- [x] Scope selector (WT / blog / podcast / both / all) and feedback reactions work.
- [ ] CORS: requests from thingy.thingelstad.com succeed; weekly's /thingy/ still works too.
- [ ] DNS + CNAME resolve; HTTPS valid.
- [ ] Only after all green: redirect weekly's /thingy/ → thingy.thingelstad.com.
