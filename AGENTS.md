# AGENTS.md

Use this file as the working playbook for agents in this repo. `README.md`
has user-facing operating notes; `docs/ROADMAP.md` explains where Thingy is
going.

## What This Repo Is

Thingy is Jamie Thingelstad's public agent for interacting with his published
online archive. This repo is the query surface for Thingy.

This repo contains two public/client surfaces:

- `web/`: the standalone static web app at `thingy.thingelstad.com`.
- `apps/thingy_bridge/`: the current Discord bridge for Thingy.

The brain is not here. Retrieval, embeddings, corpus intelligence, auth
backend, feedback persistence, and the Librarian API live in `studio-thing`.
Both apps are live clients of the Librarian API.

## Architecture Context

This repo is one of four that work together. The short version:

- **Studio (`studio-thing`)** is the brain: authoring agents, production
  pipeline, editorial source of truth, the Librarian Lambda, and the corpus.
- **Weekly (`weekly.thingelstad.com`)** renders the newsletter site from inputs
  Studio commits in.
- **Another (`another.thingelstad.com`)** publishes the podcast; Studio imports
  its episode transcripts for the podcast corpus.
- **Thingy (this repo)** is the query surface, web plus Discord, that talks to
  Studio's Librarian Lambda at runtime.

The repo boundary matters: because Thingy is a live client across a repo
boundary, the Librarian API `/auth`, `/chat`, `/retrieve`, `/feedback`,
`/conversations`, and `/dispatch` are versioned runtime contracts, not internal
functions. Casual schema changes break this repo. Version before changing.

## Surface Responsibilities

`web/` is a Vite-built static app served by GitHub Pages. It handles auth UI,
streams `/chat` SSE from the Librarian Lambda, shapes Dispatch drafts, renders
citations, collects feedback, and runs browser-only UX. It has no server beyond
GitHub Pages.

`apps/thingy_bridge/` is the Discord side of Thingy. It is a standalone Python
process running one `discord.py` client plus APScheduler support. It answers
questions in the configured member channel and provides member session/source
commands. Conversation eval cards, Dispatch cards, and operator visibility are
posted by API-side webhooks/reports, not by bridge polling.

Conversation modes are backend-enforced and conversation-scoped. Current modes
are default Thingy, Research Guide, Thought Partner, and Trusted Circle. Start
with the published archive only; do not introduce a hidden private corpus unless
Jamie explicitly makes that a separate product decision.

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
sed -n '1,220p' web/src/pages/chat.ts
sed -n '1,220p' web/src/pages/dispatch.ts
```

For bridge work, read:

```sh
sed -n '1,220p' apps/thingy_bridge/CLAUDE.md
sed -n '1,220p' apps/thingy_bridge/README.md
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
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run serve -- --port=8080
```

Use port `8080` when testing auth or chat against the live backend. The
Librarian CORS configuration is known to allow `http://localhost:8080`.
Other local ports may render the page but fail API calls with `Failed to fetch`.

Web browser smoke test, with the local server already running on port `8080`:

```sh
cd web
THINGY_SMOKE_URL=http://localhost:8080 npm run smoke
```

Bridge tests:

```sh
uv run python -m unittest discover -s apps/thingy_bridge/tests -t .
```

Only run bridge tests when bridge code changes.

## Web App Map

Key files:

- `web/index.html`, `web/chat/index.html`, `web/dispatch/index.html`,
  `web/signin/index.html`: static route shells.
- `web/src/pages/`: Vite page entrypoints.
- `web/src/shared/`: browser-side app modules.
- `web/src/styles/thingy.css`: stylesheet manifest imported by page entries.
- `web/public/robots.txt`: `robots.txt`.
- `web/public/sitemap.xml`: `sitemap.xml`.
- `web/vite.config.ts`: multi-page build config and build-time public config
  injection for Librarian API URLs, network links, and Tinylytics ID.

The web app is a Vite-built static app served by GitHub Pages from `web/_site`.
Do not add secrets, server-only logic, or a second backend here. Anything
requiring privileged logic belongs in the Librarian Lambda in `studio-thing`.

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
- `scope` / `corpus`: Hidden source narrowing for edge cases. Normal behavior
  is cross-corpus search with `all`.
- `prompt`: Seeds the question and submits after auth/beta notice.
- `email`: Prefills the auth field and starts subscriber auth.
- `dispatch_test`: Hidden owner-only Dispatch testing mode. Use
  `dispatch_test=template` on `/dispatch/` to exercise queue/status/email
  template flow without invoking the expensive Dispatch writer.

Privacy requirement: after the app reads these params, the Tinylytics loader
strips `email`, `prompt`, `from`, `scope`, `corpus`, `dispatch_test`, and
`test`, plus Discord verification params such as `state` and `code`, from the
browser URL before analytics loads. Preserve this.

## Tinylytics

Thingy has its own Tinylytics site ID in `web/vite.config.ts`, overridable with
`TINYLYTICS_SITE_UID`.

Current Tinylytics usage:

- minified embed script
- `events`
- `beacon`
- `hits`
- `countries`
- `kudos=🤖`
- Webmention endpoint
- public footer hit/country display
- homepage kudos button
- event hooks for auth, prompts, answers, feedback, source links, and network
  navigation

The Tinylytics script intentionally does not load on localhost.

## SEO / Crawlers

The public app should be indexable at `/`.

Current files:

- `web/public/robots.txt` allows crawling and points to the sitemap.
- `web/public/sitemap.xml` lists the canonical homepage.
- The route HTML files set canonical, Open Graph, Twitter, robots, and sitemap
  tags.

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

Backend changes belong in `studio-thing`, not here.

Hard constraints:

- `web/` is a static site. No server-side runtime, no secrets in the client.
  Anything that needs a secret goes through the Lambda, not the page.
- CORS is configured in Studio, not here. The
  `apps/librarian/infra/cloudformation.yaml` `AllowedOrigin` parameter must
  include `https://thingy.thingelstad.com`.
- Do not grow a second backend here. If a feature needs server logic, add it to
  the Librarian Lambda in Studio. This repo stays front-ends only.

When you do need to deploy Studio's Librarian Lambdas, use Studio's locked uv
environment:

```sh
cd ../studio-thing
make librarian-deploy ARGS="--skip-corpus-upload"
# or directly:
uv run --locked python pipeline/deploy/aws.py --skip-corpus-upload
```

Do not use plain `python`/`python3` for that deploy unless you have confirmed
the active interpreter has Studio's requirements installed; otherwise it will
typically fail on missing packages such as `boto3`.

## Deployment

`main` is pushed to GitHub. GitHub Pages deploys the static site from the web
build. `web/public/CNAME` contains `thingy.thingelstad.com`.

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

- changing the public/private Thingy mode boundary
- adding new server infrastructure in this repo
- changing auth behavior beyond UI copy/flow
- touching deployment/DNS/CORS outside this repo
- removing Tinylytics public hits/countries
- changing URL parameter semantics

Private/sparring Thingy belongs in Studio's owner-gated Discord surface, not
on the public web app.

When in doubt, start at `docs/ROADMAP.md` for direction and
`../studio-thing/ALIGNMENT.md` for the cross-repo map. If a task would alter the
Librarian API contract, add a new conversation mode, or change entitlement
behavior, make sure the backend remains authoritative and the API-side reports
can see what happened.
