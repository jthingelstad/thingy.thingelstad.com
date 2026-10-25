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
Code, or any MCP client), with the technical MCP reference beneath it at
`/connect/reference/`. The app handles auth UI, streams `/chat` SSE from
the Librarian Lambda, renders citations and inline photo thumbnails,
collects feedback, and runs browser-only UX. Visitors without a session get
the guest preview lane (2026-09): the composer works, history stays
client-side and rides each request as `history`, the server enforces the
guest caps (3/visitor/day, 100/day global fail-closed breaker, kill switch
`THINGY_GUEST_CHAT=off` in the Librarian), and the banner links to
sign-in. An explicit `email` URL param still routes to sign-in. While signed in, the chat page
also registers the archive tools with the browser's model context (WebMCP,
`web/src/shared/thingy-webmcp.ts`, proxying to `/api/tools`). It has no
server of its own - static hosting only. The account menu's Profile
dialog also lists the reader's MCP connections (one per OAuth grant; Disconnect
revokes it on the Librarian at once) and opens their MCP request log (WebMCP
and `/mcp` calls, filterable by connection, kept for the Librarian's audit
retention) - `src/react/McpConnections.tsx` over the `/memory` actions
`mcp_connections`, `mcp_disconnect` and `mcp_log` (contract 4.13.0). Its
"Apps that ask for a client ID" block (contract 4.15.0: `mcp_clients`,
`mcp_register_client`, `mcp_delete_client`) sets up a client for an app that
does no dynamic registration (AWS DevOps Agent's 3LO form): a name and the
app's callback URL in, every form value out with copy buttons. Jamie wants it
generic - no per-app presets. (The Dispatch surface and its `/dispatch/` route were removed in
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
  `web/c/index.html`, `web/about/index.html`, `web/connect/index.html`,
  `web/connect/reference/index.html`: static route shells.
- `web/src/pages/`: static-page boot modules (`home`, `about`, `connect`,
  `reference`)
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
  `--thingy-*`, a light palette and a `prefers-color-scheme: dark` block
  that redefines it, with no `data-theme` switch (NEVER name app tokens
  `--color-*`: Tailwind emits
  `--color-<name>` theme variables and the collision creates circular
  var() references that silently blank the theme). `answer.css` is the
  one home for rendered-answer typography (chat + share page).
  `thingy-components.css` holds the Felt & Tangerine base pieces
  (`.thingy-btn` + `-primary`/`-secondary`/`-danger`/`-alt`/`-compact`,
  `.thingy-input`, `.thingy-field-label`, `.thingy-card`, `.thingy-modal`,
  `.thingy-modal-title`, `.thingy-scrim`), imported last in the
  components layer; build new controls from them rather than re-deriving
  the borders and shadows in utilities.
  Components style with Tailwind utilities; semantic class names on
  elements are TEST HOOKS for smoke/qa-real (e.g.
  `.thingy-app-shell.is-mobile-rail-open` is asserted by
  `qa-real-api.mjs`) - do not remove them as "dead". In-app
  confirmations and text inputs use `ThingyDialog` (`confirmDialog`/
  `promptDialog` in `stores/dialog-store.ts`) - never
  `window.confirm`/`window.prompt`. Static pages (`/`, `/about/`,
  `/connect/`, `/connect/reference/`) are plain CSS on the same tokens,
  no Tailwind: `thingy-home-entry.css` (home) and `thingy-page-entry.css`
  (the rest) import `thingy-base.css`, `thingy-page.css` (the shared
  `.thingy-page-nav` header, also used by the share page, plus the
  reference prose), `thingy-static.css` (the `body.thingy-static` chrome:
  sites strip, `.is-site` header, navy footer, name tag, pocket cards, ask
  chips, icon tiles), then the page sheet (`thingy-home.css`,
  `thingy-about.css`, `thingy-connect.css`) and `thingy-components.css`.
  Small page behaviours live in `web/src/shared/`: `thingy-say-hi.ts`
  (home mascot hop and bubble) and `thingy-copy-buttons.ts` (Connect's
  Copy buttons - progressive enhancement: the stubs stay `hidden` without
  JS or the clipboard API, and copies are announced through
  `#thingy-copy-status`).
- `web/vite.page-data.ts`: build-time data for the static pages. It
  replaces a `<!--sites-strip-->` marker on `/`, `/about/`, `/connect/` and
  `/connect/reference/` with the sites strip from
  `web/contracts/sites.json` (entries with `in_sites_strip: true`, in file
  order; every site shows its `strip_label`, Thingy too, so the strip reads
  the same as on every other site; Thingy, the current site, differs only
  in `sites-strip__item--current` and `aria-current`; every link carries
  `?ref=sites-strip-thingy` for Tinylytics), a vendored copy of the domain's `shared/sites.json` -
  refresh with `npm run sites:sync`, check with `npm run sites:check` (the
  same two commands vendor the shared type; see "Shared type"). The
  markup, classes and values are the shared contract in the domain
  `AGENTS.md` ("The sites strip"), identical on every one of Jamie's sites;
  only the inner width and side padding follow Thingy's header frame, and
  dark mode takes the contract's dark values. Change
  the contract there first. The same file's `owner` block renders the
  footer h-card (`<!--owner-hcard-->`, the bird avatar, so the CSP allows
  `https://avatars.micro.blog`) and the head's `<link rel="me">` links
  (`<!--rel-me-->`) on the four static pages, never on chat, sign-in,
  share or 404; `{{site.<id>.<field>}}` prints a sites.json value (the
  home family tiles). It also renders `{{archive.<path>}}` tokens
  from `web/content/archive-stats.json`, the ONE source for every archive
  count the static pages quote (issues, posts, links, photos); update its
  numbers and `as_of` from the Librarian's `corpus_stats` rather than
  editing page copy. An unknown or leftover token fails the build.
  `tests/page-data.test.mjs` pins both.
- `web/public/robots.txt`: `robots.txt`.
- `web/public/sitemap.xml`: `sitemap.xml`.
- `web/vite.llms-txt.ts`: emits `/llms.txt` at build time (and serves it
  in dev) from `content/archive-stats.json` and the vendored MCP surface,
  so it quotes the pages' counts and names exactly the tools the `/mcp`
  door serves. The four static pages link it as
  `<link rel="alternate" type="text/markdown">`; `tests/llms-txt.test.mjs`
  pins both. It keeps the shape the llms.txt reference parser reads: prose
  only above the first `##`, no `###`, and every line under a `##` one
  `- [name](https://...): notes` link (tools and prompts link their
  `/connect/reference/` anchors, facts like auth and budget their section);
  `llmsTxtShapeProblems` fails the build and the test on anything else.
- `web/vite.mcp-reference.ts`: renders `/connect/reference/` at build time
  from the vendored `web/contracts/mcp-surface.json` (the Librarian's
  exported MCP surface: tools exactly as `tools/list` declares them, doors,
  resources, prompts, errors, budgets, OAuth). The page shell holds a
  `<!--mcp-reference-->` marker that the plugin replaces with real static
  HTML; the plugin refuses a checksum mismatch. Refresh with
  `npm run mcp-surface:sync` (`-- --local` for the sibling checkout);
  `npm run mcp-surface:check` runs in the daily drift workflow. Never
  hand-edit the tool text on the page - change the Librarian's declarations
  and re-export.
- `web/public/manifest.webmanifest` + `web/public/img/icons/`: PWA
  install config (add-to-home-screen). `start_url` is `/chat/`, scope
  `/`, standalone display; icons are the Thingy robot composited onto
  the cream ground `#F6EEDC` (regenerated 2026-10-01 from
  `public/img/thingy.png` with sharp: trimmed to the robot, 84% of the
  canvas height on the any-purpose icons; the maskable variant keeps every
  opaque pixel inside the central 80% safe circle). Regenerate the same
  way when the artwork changes.
  Every shell links the manifest, apple-touch-icon, two `theme-color`s
  (cream `#f6eedc` for light, matching the manifest, and `#1c1914` for
  dark, each behind its `prefers-color-scheme` media query) and the same
  favicon, `/favicon.svg?v=2`: the static mascot screen face
  (2026-10-21). SVGs cache for a week in browsers, so bump `?v=` on every
  shell together when the artwork changes (`tests/one-look.test.mjs`
  guards all of this). No service worker -
  deliberate: the app is a thin client over live APIs and stale-asset
  caching bugs outweigh offline value.
- `web/vite.config.ts`: multi-page build config and build-time public config
  injection for Librarian API URLs, network links, and Tinylytics ID.

The web app is a Vite-built static app served from `web/_site` via the
`thingy-web` CloudFormation stack (`infra/`): private S3 bucket + CloudFront,
deployed by CI through the `ThingyWebDeployOidc` role. Do not add secrets,
server-only logic, or a second backend here. Anything requiring privileged
logic belongs in the Librarian Lambda in `librarian-thing`.

## Design Direction

Thingy should feel like its own standalone agent/product, with a personality:
the "Felt & Tangerine" look, decided 2026-10-01. The design canvas is the
reference: https://claude.ai/artifact/RMsX3mnEYKLuZc9fk2BFBs (brand kit,
every screen, phone boards). When code and canvas disagree, ask before
inventing a third look.

Do:

- Build on the warm palette in `thingy-base.css`: cream ground, paper
  surfaces, ink text and borders, tangerine fills (navy text only on
  tangerine), clay links. Dark mode follows the system setting (Jamie,
  2026-10-23: "Approved: add system-following dark mode to Thingy and drop
  its "one look only" rule"); there is no theme switch. The dark block in
  `thingy-base.css` turns the ground near-black and ink cream; borders and
  hard shadows ride `--thingy-edge` (ink in light, a warm grey in dark), the
  navy grounds (footer, navy cards, active rail) ride `--thingy-navy` and
  stay navy, and the source fills (cobalt, crimson, green, the tangerine
  buttons) keep their light values. Text in a source colour uses its
  `-text` token (`--thingy-weekly-text` and friends, the shared
  `--jt-*-text` values). A fill under white text never uses a token that
  lightens in dark (`--thingy-clay-fill`, not `--thingy-clay`). Check new
  colours in both schemes.
- Type: Archivo 800 (wide, upright) for display, Thingy's own costume; Inter
  for UI and body, Inter Tight 800 for smaller headings, the shared mono for
  real code only. These are the shared faces of Jamie's sites; see "Shared
  type".
- Toy-like components: 2px ink borders, hard offset shadows, pill buttons that
  lift on hover and press on click, 44px minimum targets.
- Let the mascot carry the personality: the screen face and its moods (idle,
  thinking, found-it, oops) in the avatar, loaders, empty and error states.
- Motion is CSS only and only when it says something (the blinking face, the
  three thinking dots). No PixiJS, no confetti, no ambient animation; all of it
  off under `prefers-reduced-motion`.
- Use the source colours (Weekly cobalt, Another Thing crimson `#b3123f`,
  blog clay, Things I've built green `#1d7348`) only to identify sources:
  citation chips, source cards, the home family tiles and About's source
  bands. They are labels, not themes. Crimson and green are the shared
  `shared/tokens.css` values (2026-10-22, Jamie: "Approved: phase 2 colours,
  Another Thing to crimson and thingelstad.xyz to green across their sites,
  favicons and the sites strip"). The slate `--thingy-slate` and the
  slate/red kicker and thinking dots are Thingy's own look, not Another
  Thing's label.
- Make the chat/auth surface the primary object.
- Put the shared sites strip (the blog v2 strip, from
  `shared/sites.json`, exactly as the domain `AGENTS.md` contract sets it)
  on the static pages only (`/`, `/about/`, `/connect/`,
  `/connect/reference/`) - never on chat, sign-in, share, or 404 (Jamie,
  2026-10-01: "Chat should NOT get the bar.").
- Preserve responsive/mobile layout and avoid horizontal overflow.

Do not:

- Revert to Weekly Thing's serif/editorial page style.
- Make Thingy look like the blog's stock Micro.blog theme.
- Hide the actual chat below large marketing sections.
- Put text on tangerine in any colour but navy `#1B2540`.

## Shared type

Since 2026-10-22 Thingy reads on the type Jamie's sites share (the domain's
`shared/tokens.css`, built from the blog's), the way Weekly Thing does.

- `npm run sites:sync` copies `shared/tokens.css` and `shared/fonts/` byte
  for byte into `web/public/shared/`; `npm run sites:check` fails on any
  drift or extra file. Edit them in the domain's `shared/`, never here.
  Every shell links `/shared/tokens.css` before the app CSS and preloads
  Inter and Archivo.
- Everything is self-hosted: no Google Fonts anywhere, and every CSP has
  `font-src 'self'`. `tests/one-look.test.mjs` and the smoke fail on a
  Google Fonts reference or request.
- Archivo (variable, roman, width axis, latin and latin-ext, with its OFL
  licence) lives in `web/public/fonts/` as Thingy's own font, declared at the
  top of `thingy-base.css`. It is the only display face; add no others.
- Roles: body and UI `--thingy-font-ui` (Inter), headings below display
  `--thingy-font-heading` (Inter Tight, `--thingy-heading-weight` 800),
  labels `--thingy-font-label` with `--thingy-label-tracking` (Tailwind:
  `font-label tracking-label`, `font-heading`), code `--thingy-font-mono`.
  Mono is for real code (tool names, URLs to copy, arguments, the build id),
  never for eyebrows, dates or meta.
- Sizes follow the blog's scale: body and answers `--jt-size-base` (19px,
  18px on phones), labels `--jt-size-label`, nothing below 14px (em-relative
  sizes are floored with `max(0.875rem, ...)`). The smoke fails on visible
  text under 14px. The marketing frame is `--jt-frame` (1120px) with
  `--jt-gutter`.
- The Weekly W in the discs, family tiles and citation chips is Weekly
  Thing's SVG mark (`--thingy-w-glyph`), not a font.

## Runtime URL Parameters

Document behavior changes in `README.md` when touching these.

- `from`: Prefer an actual sending URL, URL-encoded. Thingy matches the host
  against known properties, highlights the matching nav item, labels it
  `Return`, and rewrites that link to the exact source URL. The known
  properties are `SITE.networkLinks` in `vite.shared-config.ts`: the blog,
  Weekly Thing, Another Thing, and Things I've built (thingelstad.xyz,
  label and URL read from `contracts/sites.json`).
- `prompt`: Seeds the question. Signed-in readers auto-submit only when
  the visit came from a trusted referrer; everyone else (guests always) gets
  the composer prefilled and must press send (crawler protection - the
  blog's explore links were auto-firing a model call for every
  JS-executing crawler, 2026-09-02; and any page can link
  `?prompt=<attacker text>`, audit W3). Trusted
  (`src/shared/thingy-referrer.ts`, pinned by `tests/referrer.test.mjs`):
  Thingy's own host, `thingelstad.com` and its subdomains (by host), and
  exactly the origin `https://thingelstad.xyz` (Jamie, 2026-10-21: "Yes" -
  no http, no www, no subdomains). Add no wildcard and no other host
  without Jamie.
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
- `ref`: the cross-site origin tag (`ref=weekly-issue`). Never read, never
  stripped; the chat's first URL sync keeps it (Tinylytics may load after
  that sync), Back to that entry keeps it, and later conversation pushes
  drop it. This is Jamie's decision (2026-10-21: "Keep the ref. Don't
  remove it."). Outbound links Thingy renders to the
  sister sites get `?ref=thingy-<placement>` through `withRef`
  (`src/shared/thingy-refs.ts`; `tests/refs.test.mjs` pins its hosts to
  `contracts/sites.json`): `thingy-source` on source cards and citation
  links, `thingy-about`, `thingy-family`, `thingy-return`. Identity links
  (h-card, rel=me) never carry one.

Privacy requirement: after the app reads these params, the Tinylytics loader
strips `email`, `prompt`, `from`, `explore`, `issue`, `scope`, `corpus`,
`login_token`, and `magic_token` from the browser URL before analytics loads.
Preserve this.

## Tinylytics

Thingy has its own Tinylytics site ID in `web/vite.config.ts`, overridable with
`TINYLYTICS_SITE_UID`.

Current Tinylytics usage:

- minified embed script, loaded on every page except `/signin/` (magic
  tokens ride that URL; `librarian.signin_*` events are that page's only
  signal) (2026-09-01; previously homepage-only, which silenced all app
  events)
- `events`, `beacon`, `hits`, `countries`, Webmention endpoint (kudos
  removed at Jamie's request 2026-09-03)
- homepage footer hit/country display
- declarative `data-tinylytics-event` hooks (the embed's click delegation
  handles React-rendered elements): `home.start_chat`, `network.return`,
  `librarian.source_click` (inline WT autolinks and the source cards,
  value = `WT<N>`/`Blog`/`Podcast`/`Project`/`Saved link`, `Project` for
  Things I've built and `Saved link` for Linking Things),
  `librarian.guest_signin_click` (both
  guest banners), `librarian.share_cta`
- programmatic events posted straight to the collector
  (`src/shared/thingy-analytics.ts` `trackEvent`), all `librarian.*`:
  - visits: `chat2_visit` (value `guest`/`reader`, with `.standalone`
    appended when running as the installed PWA; name predates the
    chat2→chat rename, kept for continuity), `signin_visit`
    (`magic_link`/`form`/`active`)
  - sign-in funnel: `signin_request` (`ok`/`error`), `signin_success`
    (`magic_link`/`code`/`direct`), `signin_error`
  - welcome: `welcome_success`/`welcome_error`, `welcome_suggestion`
    (value = chip ordinal)
  - answers: `answer_success`/`answer_error`/`answer_stop` (value leads
    with the lane: `guest`/`reader`/`share_guest`/`share_reader`;
    errors append a class, e.g. `reader.malformed_stream`)
  - conversations: `conversation_create`
  - feedback: `feedback_submit` (`up`/`down`, fired only after a
    successful POST), `feedback_comment`, `feedback_error`
  - shares: `share_link_create`/`share_link_revoke` in chat;
    `share_view` (`signed_in`/`signed_out`/`gone`/`error`) on `/c/`
  - message actions: `prompt_copy`, `share_copy`, `share_native`,
    `answer_share_native`
  - voice: `voice_input_start`, `voice_input_error`
  - WebMCP: `webmcp_register` (value `native|polyfill.N.of.M` - fires on
    every signed-in chat load, NOT a usage signal), `webmcp_call`
    (value = tool name; the real usage signal), `webmcp_error`
  - `client_error` (global error/unhandledrejection handlers, value
    `<surface>.<ErrorCtor>`)
- the auth Lambda's magic-link emails carry a 1x1 pixel that lands as a
  page hit at path `/email/thingy/login` (open counts only, no
  per-recipient identifier; `THINGY_TINYLYTICS_EMAIL_SITE_UID` can point
  it at a separate site)

Event values never carry reader text - error events report only status
classes and error constructor names.

The Tinylytics script and the programmatic events intentionally do not run
on localhost, and both honor the `tinylytics_ignore` opt-out.

## SEO / Crawlers

The public pages - `/`, `/about/`, `/connect/`, `/connect/reference/` - are indexable; the chat and
sign-in app shells and the shared-conversation page (`/c/<token>` - reader
content, never indexed) are `noindex, follow` (no crawlable content, and crawl
equity should concentrate on the real pages).

Current files:

- `web/public/robots.txt` allows crawling and points to the sitemap.
- `web/public/sitemap.xml` lists `/`, `/about/`, `/connect/`, and
  `/connect/reference/`.
- `/llms.txt` (built by `web/vite.llms-txt.ts`) is the site for agents and
  LLMs: what Thingy is, the pages, and the MCP server's endpoint, auth,
  tools, prompts and resources.
- The route HTML files set canonical, Open Graph, Twitter, robots, and sitemap
  tags. Structured data: home carries WebSite/WebApplication/Person JSON-LD,
  `/about/` an AboutPage, `/connect/` a TechArticle about the MCP server,
  `/connect/reference/` a TechArticle whose `softwareVersion` is the
  vendored server version.

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
native Librarian archive Web Function and every other `/api/*` path to its
native auth Web Function,
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
