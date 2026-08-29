# Thingy

Thingy is the standalone web home for Jamie Thingelstad's archive agent:
`https://thingy.thingelstad.com/`.

For product-surface alignment across the web app and Librarian API, see
[`docs/THINGY_SURFACES.md`](docs/THINGY_SURFACES.md).

## URL Parameters

These parameters are intentionally small affordances for links from Jamie's
other properties, newsletters, and future broadcast surfaces.

### `from`

Highlights where the visitor came from in the cross-site navigation. Prefer
passing the actual sending URL so Thingy can return the visitor to the specific
page they came from.

Examples:

- `https://thingy.thingelstad.com/chat/?from=https%3A%2F%2Fwww.thingelstad.com%2F`
- `https://thingy.thingelstad.com/chat/?from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F`
- `https://thingy.thingelstad.com/chat/?from=https%3A%2F%2Fanother.thingelstad.com%2Fepisodes%2F`

Known hostnames and legacy word aliases:

- `thingelstad.com`, `www.thingelstad.com`, `blog`, `jamie`
- `Weekly Thing`, `weekly.thingelstad.com`, `newsletter`
- `Another Thing`, `another.thingelstad.com`, `podcast`

When `from` matches one of the known properties, that navigation link is
highlighted and labeled `Return`. If `from` is a URL, the matching link points
back to that exact URL. Unknown values are ignored.

### `prompt`

Seeds the question box and auto-submits once the visitor is authenticated. When
`prompt` is present, Thingy skips the generated welcome and starts with the
prompt instead.

Example:

- `https://thingy.thingelstad.com/chat/?prompt=What%20has%20Jamie%20written%20about%20AI%3F`

### `email`

Prefills the subscriber email field and starts the auth check.

Example:

- `https://thingy.thingelstad.com/chat/?email=reader@example.com`

### `login_token`

One-time magic-link token created by the Librarian API. When present, Thingy
redeems it with `/auth` and removes it from the browser URL after the attempt.
These links are sent by email from `thingy@thingelstad.com`.

## Local Development

The web app is a Vite-built static app. GitHub Pages serves the generated
`web/_site` directory; there is no Node server in production.

```sh
cd web
npm install
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run serve -- --port=8080
```

Build:

```sh
cd web
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run build
```

`LIBRARIAN_API_URL` and `LIBRARIAN_STREAM_URL` are required at build time.
Production gets them from GitHub repository variables; local shells can export
the same values from the Librarian stack outputs (`librarian-thing`).

Key web files:

- `web/index.html`, `web/chat/index.html`, `web/signin/index.html`: static
  route shells. (`web/dispatch/index.html` is a redirect stub to `/chat/`
  kept for old links; the Dispatch surface was removed in 2026-08.)
- `web/src/pages/`: Vite entrypoints for each route.
- `web/src/shared/`: browser-side app modules.
- `web/src/styles/`: shared styles imported by the page entrypoints.
- `web/public/`: static files copied as-is to `_site`.
- `web/vite.config.ts`: build-time config injection and multi-page inputs.

### Librarian contract

`librarian-thing` owns the versioned Librarian request, response, and SSE contract. Thingy
vendors `web/contracts/librarian-api.json` (synced from `librarian-thing`'s
`apps/librarian/contracts/librarian-api.json`) and validates successful responses directly
against that generated artifact. The Librarian repo publishes the artifact and its SHA-256
checksum; Thingy generates CSP-safe runtime validators and TypeScript contract types from
the same JSON. Requests carry `x-librarian-contract-version`; the backend also returns it so
an incompatible deployment fails clearly instead of being accepted through TypeScript casts.

After changing the authoritative contract in `librarian-thing`:

```sh
cd web
npm run contract:sync
```

`contract:sync` fetches the Librarian repo's published `main` artifact by default, so it
works in a clean checkout without a sibling repository. Set `LIBRARIAN_CONTRACT_SOURCE` to a local JSON path
when developing both repositories together. `npm run contract:check` verifies the checksum,
the vendored artifact, and the generated client; the scheduled drift workflow
(`.github/workflows/drift.yml`) runs it daily against upstream `main`, and the Pages deploy
gate runs `contract:generate:check` inside `npm run verify` before building. The Librarian's
contract test also verifies its generated checksum.

## Tinylytics

Thingy uses its own Tinylytics site ID via `TINYLYTICS_SITE_UID`, falling back to
the production ID in `web/vite.config.ts`.

Enabled Tinylytics features:

- Page hits with the minified embed script.
- Click/event tracking with `events`.
- Beacon delivery for outbound links with `beacon`.
- Tinylytics Webmention endpoint in the document head.

The executable Tinylytics embed only loads on the public homepage. Chat
and sign-in deliberately do not execute third-party JavaScript
because those routes handle browser-held bearer credentials or one-time login
values. Existing event hooks remain safe no-ops when the embed is absent.

Public hit counters, country flags, and kudos are intentionally not shown in
the current chat-client UI.

Before loading Tinylytics, the app strips Thingy control parameters from the
browser URL after the app has read them:

- `email`
- `prompt`
- `from`
- `scope`
- `corpus`
- `login_token`
- `magic_token`

This keeps Tinylytics page URLs clean and avoids recording typed emails or
prompts in analytics.
