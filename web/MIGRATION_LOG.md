# Vite Migration Log

This file tracks the 11ty-to-Vite migration for Thingy.

## 2026-06-08

- Started migration target: Vite-only static app, no 11ty build path.
- Preserved GitHub Pages hosting and `_site` output target.
- Copied current rendered route shells for `/`, `/chat/`, `/dispatch/`, and `/signin/` as static Vite HTML entrypoints.
- Moved CSS and browser JavaScript under `src/`.
- Moved static publish assets under `public/`.
- Replaced Eleventy data/layout injection with `vite.config.js` build-time HTML config replacement.
- Added Vite page entrypoints under `src/pages/` for home, chat, dispatch, and sign-in.
- Moved Tinylytics URL scrubbing/loading into a Vite module so app URL parameters are consumed before analytics strips them.
- Verified Vite build output for `_site`, hashed assets, CNAME, `.nojekyll`, `robots.txt`, and `sitemap.xml`.
- QA checked `/`, `/chat/`, `/dispatch/`, `/signin/` redirect behavior, cross-site `from` return links, route switching, and rail collapse on `http://localhost:8080`.

## Needs Attention

- Future cleanup can continue converting shared browser modules from `window.Thingy*` globals to explicit ES module exports. The Vite cutover keeps the existing runtime contracts intact while bundling by route.
