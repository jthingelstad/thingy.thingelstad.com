# AGENTS.md

This website is the home of Thingy, Jamie Thingelstad's public agent for
interacting with his published online archive.

## Repo Shape

- `web/` is the standalone Thingy web app at `thingy.thingelstad.com`.
  It is an Eleventy static site and a thin client for the Librarian API.
- `apps/thingy_bridge/` is the Discord bridge for Thingy. Read
  `apps/thingy_bridge/AGENTS.md` or `apps/thingy_bridge/CLAUDE.md` if present
  before doing bridge work.
- The actual retrieval, corpus intelligence, auth backend, and feedback API
  live in the `studio-thing` Librarian Lambda, not this repo.

## Web App Notes

- Work in `web/` for the public site.
- Build with `npm run build` from `web/`.
- Use `npm run serve -- --port=8080` for local testing against the live API;
  the backend CORS configuration is known to allow `http://localhost:8080`.
- Do not add secrets or server-side behavior to the static site.
- Keep Thingy visually neutral as its own standalone agent/product, not styled
  as Weekly Thing, Another Thing, or the blog.

## Runtime URL Parameters

The public app intentionally supports a few URL parameters:

- `from` should preferably be the actual sending URL. Thingy highlights the
  matching cross-site nav item and rewrites that item as a return link.
- `scope` / `corpus` are hidden source-narrowing controls for edge cases.
  The normal UI should let Thingy search across everything.
- `prompt` seeds and submits a question after auth.
- `email` prefills the auth field and starts the subscriber check.

Keep these documented in `README.md` if their behavior changes.

## Analytics

Thingy has its own Tinylytics site ID in `web/_data/site.js`, overridable with
`TINYLYTICS_SITE_UID`.

The page uses Tinylytics for:

- page hits
- public hit counter
- public visitor countries
- click/events
- beacon delivery for outbound links
- homepage kudos
- Webmention endpoint

The app strips `email`, `prompt`, `from`, `scope`, and `corpus` from the
browser URL before Tinylytics loads, after Thingy has read them. Preserve that
privacy behavior.

## Boundaries

- This repo is the public docent surface. Private/sparring Thingy belongs in
  Studio, not here.
- If a task would change the Librarian API contract, CORS, auth semantics, or
  private/public corpus visibility, stop and confirm with Jamie.
- Read `CLAUDE.md` and `THINGY_ROADMAP.md` for deeper architecture context.
