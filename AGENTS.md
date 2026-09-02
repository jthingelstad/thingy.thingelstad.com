# AGENTS.md

Use this file as the working playbook for agents in this repo. `README.md`
has user-facing operating notes; `docs/ROADMAP.md` explains where Thingy is
going.

## What This Repo Is

Thingy is Jamie Thingelstad's public agent for interacting with his published
online archive. This repo is the query surface for Thingy.

This repo contains one public client surface: `web/`, the standalone static
web app at `thingy.thingelstad.com`.

The brain is not here. Retrieval, embeddings, corpus intelligence, auth
backend, feedback persistence, and the Librarian API currently live in
`librarian-thing` (renamed from `studio-thing` on 2026-08-28, when the Studio
application was retired and the repo was streamlined to the Librarian API and
corpus).

## Architecture Context

This repo is one of five that work together. The short version:

- **Librarian (`librarian-thing`)** is the brain: auth, retrieval,
  conversations, evaluation, and the corpus.
- **WT Builder (`wt-builder`)** authors and publishes each newsletter issue,
  and commits the canonical issue text into the Librarian's `data/issues/`.
- **Weekly (`weekly.thingelstad.com`)** renders the newsletter site from
  inputs WT Builder commits in.
- **Another (`another.thingelstad.com`)** publishes the podcast; the Librarian
  imports its episode transcripts for the podcast corpus.
- **Thingy (this repo)** is the web query surface that talks to the Librarian
  Lambda at runtime.

The repo boundary matters: because Thingy is a live client across a repo
boundary, the Librarian API `/auth`, `/chat`, `/retrieve`, `/feedback`, and
`/conversations` are versioned runtime contracts, not internal functions.
(`/retrieve` is served for `wt-builder`; the Thingy web client never calls
it. The Librarian also serves `/mcp` with OAuth 2.1 for third-party MCP
clients - the web app never calls that either; `/connect/` only documents
it.) Casual schema changes break this repo. Version before changing.

## Surface Responsibilities

`web/` is a Vite-built static app served from S3 + CloudFront. The chat at
`/chat/` is a React app built on assistant-ui (cutover 2026-09-02): a custom
`ThingyRuntime` ChatModelAdapter speaks the Librarian's contract 4.x SSE, and
assistant-ui supplies the message lifecycle (streaming, stop, edit,
regenerate, branching). There is deliberately NO Vercel AI SDK and NO
Next.js - the Librarian Lambda is the agent runtime and the site stays
static. Preact was fully removed 2026-09-02, and on 2026-09-03 the app
consolidated into ONE SPA (src/app/main.tsx, TanStack Router) serving
/chat, /signin, and /c/<token> - all three S3 shells load the same
module. Styling is Tailwind v4 on the Thingy tokens (namespace
--thingy-* in thingy-base.css; app.css layers legacy content styles
under the utilities). The marketing pages (/, /about/, /connect/) stay
static HTML for SEO. Other surfaces are
sign-in, account, and the public shared-conversation page (`/c/<token>`,
one shell for every token; the CloudFront function rewrites the path and the
page fetches `/api/share/<token>`), plus two static content pages: `/about/` (what
Thingy is, the archive inventory, architecture, and the AGENT-TEAM) and
`/connect/` (how to add the Librarian MCP server to Claude, ChatGPT, Claude
Code, or any MCP client). The app handles auth UI, streams `/chat` SSE from
the Librarian Lambda, renders citations and inline photo thumbnails,
collects feedback, and runs browser-only UX. Visitors without a session get
the guest preview lane (2026-09): the composer works, history stays
client-side and rides each request as `history`, the server enforces the
guest caps (3/visitor/day, 100/day global fail-closed breaker, kill switch
`THINGY_GUEST_CHAT=off` in the Librarian), and the banner links to
sign-in. An explicit `email` URL param still routes to sign-in. While signed in, the chat page
also registers the archive tools with the browser's model context (WebMCP,
`web/src/shared/thingy-webmcp.ts`, proxying to `/api/tools`). It has no
server of its own - static hosting only. (The Dispatch surface and its `/dispatch/` route were removed in
2026-08/2026-09. The answer text-to-speech button was removed in
2026-08 - do not reintroduce browser speechSynthesis.)

Conversation modes were retired as a user-facing feature (the mode picker
went in the 2026-08 chat streamline; Jamie confirmed the retirement
2026-09-01). Every new conversation is default Thingy. Vestigial plumbing
remains - conversations store a `mode`, the backend still entitlement-checks
it, and reopening an old non-thingy conversation keeps its stored mode - but
do not build new mode UI or new modes without an explicit product decision.
The archive stays published-only; do not introduce a hidden private corpus
unless Jamie explicitly makes that a separate product decision.

## First Checks

Before editing:

```sh
git status --short
```

There may be user work in progress. Do not revert unrelated changes.

For web work, also inspect:

```sh
sed -n '1,220p' README.md
sed -n '1,220p' AGENTS.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,220p' web/vite.config.ts
sed -n '1,220p' web/src/react/ChatApp.tsx
```

## Common Commands

Web build:

```sh
cd web
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run build
```

Web lint and unit tests:

```sh
cd web
npm run lint
npm test
```

Web local server:

```sh
cd web
LIBRARIAN_API_URL=/api LIBRARIAN_STREAM_URL=/api npm run serve -- --port=8080
```

The dev server proxies `/api` to the live Librarian (see `librarianProxy` in
`vite.config.ts`), which keeps cookie sign-in same-origin on localhost.
Export `THINGY_WEB_ORIGIN_TOKEN` (from the librarian repo `.env`) so the
proxy stamps the origin marker cookie-authenticated calls require. The
legacy absolute-URL flow (`LIBRARIAN_API_URL="https://librarian..."`) still
works Bearer-only until the 2026-09-15 legacy-token sweep; port `8080` is
the CORS-approved port for it.

Web browser smoke test, with the local server already running on port `8080`:

```sh
cd web
THINGY_SMOKE_URL=http://localhost:8080 npm run smoke
```

## Web App Map

Key files:

- `web/index.html`, `web/chat/index.html`, `web/signin/index.html`,
  `web/c/index.html`, `web/about/index.html`, `web/connect/index.html`:
  static route shells.
- `web/src/pages/`: static-page boot modules (`home`, `about`, `connect`)
  - vanilla TS. The home boot also forwards `?login_token=` magic-link
  landings to `/signin/`.
- `web/src/app/main.tsx`: the SPA entry - TanStack Router serving
  `/chat`, `/signin`, and `/c/<token>` from one bundle.
- `web/src/react/`: the React app (`ChatApp.tsx`, `SignInApp.tsx`,
  `ShareApp.tsx`, `thingy-runtime.ts` - the contract-4.x
  ChatModelAdapter plus history/feedback adapters). One Vite pass builds
  everything (`vite.config.ts`, helpers in `vite.shared-config.ts`).
- `web/src/shared/`: browser-side app modules (`thingy-webmcp.ts` is the
  WebMCP registration module; kill switch `window.ThingyConfig.webmcp`).
- `web/src/styles/`: `app.css` is the SPA's single style entry - it
  declares `@layer legacy` before Tailwind's layers (so utilities always
  win), puts `thingy-base.css` in `layer(legacy)`, and the content
  stylesheets (`answer.css`, `thingy-page.css`, `share.css`) in
  `layer(components)` - above preflight, which would otherwise strip
  link colors. `thingy-base.css` owns the design tokens - the palette lives at
  `--thingy-*` (NEVER name app tokens `--color-*`: Tailwind emits
  `--color-<name>` theme variables and the collision creates circular
  var() references that silently blank the theme). `answer.css` is the
  one home for rendered-answer typography (chat + share page).
  Components style with Tailwind utilities; semantic class names on
  elements are TEST HOOKS for smoke/qa-real (e.g.
  `.thingy-app-shell.is-mobile-rail-open` is asserted by
  `qa-real-api.mjs`) - do not remove them as "dead". In-app
  confirmations and text inputs use `ThingyDialog` (`confirmDialog`/
  `promptDialog` in `stores/dialog-store.ts`) - never
  `window.confirm`/`window.prompt`. Static content pages (`/about/`,
  `/connect/`) use `thingy-page-entry.css` -> `thingy-page.css` on the
  same tokens.
- `web/public/robots.txt`: `robots.txt`.
- `web/public/sitemap.xml`: `sitemap.xml`.
- `web/vite.config.ts`: multi-page build config and build-time public config
  injection for Librarian API URLs, network links, and Tinylytics ID.

The web app is a Vite-built static app served from `web/_site` via the
`thingy-web` CloudFormation stack (`infra/`): private S3 bucket + CloudFront,
deployed by CI through the `ThingyWebDeployOidc` role. Do not add secrets,
server-only logic, or a second backend here. Anything requiring privileged
logic belongs in the Librarian Lambda in `librarian-thing`.

## Design Direction

Thingy should feel like its own standalone agent/product.

Do:

- Keep the UI neutral and product-like.
- Treat Weekly Thing, Another Thing, and the blog as source properties, not as
  visual themes to copy.
- Make the chat/auth surface the primary object.
- Keep source cards and cross-site nav useful but secondary.
- Preserve responsive/mobile layout and avoid horizontal overflow.

Do not:

- Revert to Weekly Thing's serif/editorial page style.
- Make Thingy look like the blog's stock Micro.blog theme.
- Hide the actual chat below large marketing sections.

## Runtime URL Parameters

Document behavior changes in `README.md` when touching these.

- `from`: Prefer an actual sending URL, URL-encoded. Thingy matches the host
  against known properties, highlights the matching nav item, labels it
  `Return`, and rewrites that link to the exact source URL.
- `prompt`: Seeds the question and submits after auth/beta notice.
- `email`: Prefills the auth field and starts subscriber auth.
- `explore`: Canonical https URL of a source page; Thingy composes the
  exploration question itself (`src/shared/thingy-explore.ts`) and uses the
  URL as the return link. Explicit `prompt` wins.
- `issue`: Weekly Thing issue number; composes a guided-look question and
  defaults the return link to the archive page.
- `conversation`: id of the open conversation. The chat app keeps this in
  sync via pushState (back/forward walk visited conversations; reload
  restores the same one). Signed-in only - guests never adopt a
  deep-linked id. Deliberately NOT stripped before analytics loads.

Privacy requirement: after the app reads these params, the Tinylytics loader
strips `email`, `prompt`, `from`, `explore`, `issue`, `scope`, `corpus`,
`login_token`, and `magic_token` from the browser URL before analytics loads.
Preserve this.

## Tinylytics

Thingy has its own Tinylytics site ID in `web/vite.config.ts`, overridable with
`TINYLYTICS_SITE_UID`.

Current Tinylytics usage:

- minified embed script, loaded on every page (2026-09-01; previously
  homepage-only, which silenced all app events)
- `events`
- `beacon`
- `hits`
- `countries`
- `kudos=🤖`
- Webmention endpoint
- public footer hit/country display
- homepage kudos button
- declarative `data-tinylytics-event` hooks for prompts, source links, and
  network navigation
- programmatic app events posted straight to the collector
  (`src/shared/thingy-analytics.ts`): auth/session, answer
  success/error/stop, feedback, shares, conversations, share links
  (`librarian.share_link_create`/`_revoke` in chat;
  `librarian.share_view`/`share_cta` on the public page), guest lane
  (`librarian.guest_visit`, `guest_answer`, `guest_signin_click`), plus
  `librarian.client_error` (global error/unhandledrejection handlers on
  chat and sign-in) and `librarian.webmcp_*` (registration and
  unreachable-tool counters)

Event values never carry reader text - error events report only status
classes and error constructor names.

The Tinylytics script and the programmatic events intentionally do not run
on localhost, and both honor the `tinylytics_ignore` opt-out.

## SEO / Crawlers

The public pages - `/`, `/about/`, `/connect/` - are indexable; the chat and
sign-in app shells and the shared-conversation page (`/c/<token>` - reader
content, never indexed) are `noindex, follow` (no crawlable content, and crawl
equity should concentrate on the real pages).

Current files:

- `web/public/robots.txt` allows crawling and points to the sitemap.
- `web/public/sitemap.xml` lists `/`, `/about/`, and `/connect/`.
- The route HTML files set canonical, Open Graph, Twitter, robots, and sitemap
  tags. Structured data: home carries WebSite/WebApplication/Person JSON-LD,
  `/about/` an AboutPage, `/connect/` a TechArticle about the MCP server.

Query-param app states should canonicalize to `/`, not become separate indexed
pages.

## API Boundaries

This repo consumes the Librarian API. Treat it as a versioned runtime contract.

Stop and confirm before changing anything that affects:

- `/auth`
- `/chat`
- `/feedback`
- request/response JSON shape
- streaming event names or payloads
- CORS origins
- subscriber/auth semantics
- public/private corpus visibility

Backend changes belong in `librarian-thing`, not here.

Hard constraints:

- `web/` is a static site. No server-side runtime, no secrets in the client.
  Anything that needs a secret goes through the Lambda, not the page.
- CORS is configured in the Librarian repo, not here. Production is
  same-origin (`/api` through the thingy distribution) and needs no CORS;
  the `AllowedOrigin` allow-list in
  `apps/librarian/infra/cloudformation.yaml` remains load-bearing for
  `http://localhost:8080` dev flows that call the Librarian directly.
- Do not grow a second backend here. If a feature needs server logic, add it to
  the Librarian Lambda in `librarian-thing`. This repo stays front-ends only.

When you do need to deploy the Librarian Lambdas, use `librarian-thing`'s
locked uv environment:

```sh
cd ../librarian-thing
make librarian-deploy ARGS="--skip-corpus-upload"
# or directly:
uv run --locked python pipeline/deploy/aws.py --skip-corpus-upload
```

Do not use plain `python`/`python3` for that deploy; run it through the
Librarian's locked uv environment so dependencies such as `boto3` are
guaranteed present.

## Deployment

`main` is pushed to GitHub. CI builds the site and deploys it to AWS: the
`deploy-aws` workflow job assumes `ThingyWebDeployOidc`, syncs the `thingy-web`
CloudFormation stack (`infra/template.yaml`), uploads `web/_site` to the private
web bucket with per-file cache headers, and invalidates CloudFront.
`thingy.thingelstad.com` is a Namecheap CNAME to the distribution. (GitHub
Pages was retired 2026-09-01; migration record in projects-sysadmin#37.)

Production is same-origin: `LIBRARIAN_API_URL`/`LIBRARIAN_STREAM_URL` are
`/api`, and the distribution routes `/api/chat|welcome|feedback` to the
Librarian stream Lambda and every other `/api/*` path to its HTTP API,
stripping the `/api` prefix at the edge and stamping the `X-Thingy-Origin`
marker. CSP `connect-src` is `'self'` in production builds. Local dev
against the live backend still uses absolute URLs (see Common Commands);
the librarian CORS allow-list continues to cover `http://localhost:8080`.

Before committing web changes:

```sh
cd web
npm run build
cd ..
git diff --check
```

When asked to publish:

```sh
git status --short
git add <specific files>
git commit -m "<message>"
git push origin main
```

If push is rejected because `origin/main` moved, fetch and rebase rather than
force-pushing:

```sh
git fetch origin main
git log --oneline --left-right HEAD...origin/main
git rebase origin/main
```

Resolve conflicts carefully and rerun the build before pushing.

## When To Ask Jamie

Ask before:

- changing the public/private boundary of what Thingy can see or serve
- adding new server infrastructure in this repo
- changing auth behavior beyond UI copy/flow
- touching deployment/DNS/CORS outside this repo
- removing Tinylytics public hits/countries
- changing URL parameter semantics

When in doubt, start at `docs/ROADMAP.md` for direction and
`../librarian-thing/ALIGNMENT.md` for the cross-repo map. If a task would alter the
Librarian API contract or change entitlement
behavior, make sure the backend remains authoritative and the API-side reports
can see what happened.
