# AGENTS.md

Use this file as the working playbook for agents in this repo. `CLAUDE.md`
has deeper architectural context; `README.md` has user-facing operating notes;
`ROADMAP.md` explains where Thingy is going.

## What This Repo Is

Thingy is Jamie Thingelstad's public agent for interacting with his published
online archive.

This repo contains two public/client surfaces:

- `web/`: the standalone static web app at `thingy.thingelstad.com`.
- `apps/thingy_bridge/`: the current Discord bridge for Thingy.

The brain is not here. Retrieval, embeddings, corpus intelligence, auth
backend, feedback persistence, and the Librarian API live in `studio-thing`.

## First Checks

Before editing:

```sh
git status --short
```

There may be user work in progress. Do not revert unrelated changes.

For web work, also inspect:

```sh
sed -n '1,220p' README.md
sed -n '1,220p' CLAUDE.md
sed -n '1,220p' web/index.njk
sed -n '1,220p' web/_data/site.js
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
npm run build
```

Web local server:

```sh
cd web
npm run serve -- --port=8080
```

Use port `8080` when testing auth or chat against the live backend. The
Librarian CORS configuration is known to allow `http://localhost:8080`.
Other local ports may render the page but fail API calls with `Failed to fetch`.

Bridge tests:

```sh
cd apps/thingy_bridge
python -m pytest
```

Only run bridge tests when bridge code changes.

## Web App Map

Key files:

- `web/index.njk`: page markup and browser-side chat/auth logic.
- `web/css/thingy.css`: all standalone Thingy styling.
- `web/_includes/layouts/base.njk`: document head, network nav, Tinylytics
  loader, cross-site `from` handling.
- `web/_data/site.js`: site config, network links, API URLs, Tinylytics ID.
- `web/robots.njk`: `robots.txt`.
- `web/sitemap.njk`: `sitemap.xml`.

The web app is an Eleventy static site. Do not add secrets, server-only logic,
or a second backend here. Anything requiring privileged logic belongs in the
Librarian Lambda in `studio-thing`.

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

Privacy requirement: after the app reads these params, the Tinylytics loader
strips `email`, `prompt`, `from`, `scope`, and `corpus` from the browser URL
before analytics loads. Preserve this.

## Tinylytics

Thingy has its own Tinylytics site ID in `web/_data/site.js`, overridable with
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

- `web/robots.njk` allows crawling and points to the sitemap.
- `web/sitemap.njk` lists the canonical homepage.
- The layout sets canonical, Open Graph, Twitter, robots, and sitemap tags.

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

## Deployment

`main` is pushed to GitHub. GitHub Pages deploys the static site from the web
build. `web/CNAME` contains `thingy.thingelstad.com`.

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
