# Thingy

Thingy is the standalone web home for Jamie Thingelstad's archive agent:
`https://thingy.thingelstad.com/`.

## URL Parameters

These parameters are intentionally small affordances for links from Jamie's
other properties, newsletters, and future broadcast surfaces.

### `from`

Highlights where the visitor came from in the cross-site navigation. Prefer
passing the actual sending URL so Thingy can return the visitor to the specific
page they came from.

Examples:

- `https://thingy.thingelstad.com/?from=https%3A%2F%2Fwww.thingelstad.com%2F`
- `https://thingy.thingelstad.com/?from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F`
- `https://thingy.thingelstad.com/?from=https%3A%2F%2Fanother.thingelstad.com%2Fepisodes%2F`

Known hostnames and legacy word aliases:

- `thingelstad.com`, `www.thingelstad.com`, `blog`, `jamie`
- `Weekly Thing`, `weekly.thingelstad.com`, `newsletter`
- `Another Thing`, `another.thingelstad.com`, `podcast`

When `from` matches one of the known properties, that navigation link is
highlighted and labeled `Return`. If `from` is a URL, the matching link points
back to that exact URL. Unknown values are ignored.

### `scope` / `corpus`

Corpus narrowing for edge cases and power use. Thingy searches across
everything by default, but the chat UI also exposes a small source selector for
direct Weekly Thing, blog, podcast, or multi-source testing.

Use either `scope` or `corpus`; `scope` wins when both are valid.

Supported values:

- `all` or `everything`
- `weekly_thing`, `wt`, `weeklything`, `newsletter`, `issues`, `archive`
- `blog`, `thingelstad`, `thingelstad_com`
- `podcast`, `podcasts`, `another_thing`, `anotherthing`, `another`
- `both` for Weekly Thing plus blog
- `weekly_thing_podcast` or `wt_podcast` for Weekly Thing plus Another Thing
- `blog_podcast` or `podcast_blog` for the blog plus Another Thing

`corpus` can also accept comma, plus, or pipe-separated values. For example:

- `https://thingy.thingelstad.com/?corpus=blog`
- `https://thingy.thingelstad.com/?scope=podcast`
- `https://thingy.thingelstad.com/?corpus=weekly%20thing,blog`
- `https://thingy.thingelstad.com/?scope=blog_podcast`

### `prompt`

Seeds the question box and auto-submits once the visitor is authenticated. When
`prompt` is present, Thingy skips the generated welcome and starts with the
prompt instead.

Example:

- `https://thingy.thingelstad.com/?prompt=What%20has%20Jamie%20written%20about%20AI%3F`

Shared prompt links generated inside Thingy include `scope` so the recipient
gets the same corpus boundary used for that answer.

### `email`

Prefills the subscriber email field and starts the auth check.

Example:

- `https://thingy.thingelstad.com/?email=reader@example.com`

### `login_token`

One-time magic-link token created by the Librarian API. When present, Thingy
redeems it with `/auth` and removes it from the browser URL after the attempt.
These links are sent by email from `thingy@thingelstad.com`.

## Local Development

```sh
cd web
npm install
npm run serve
```

Build:

```sh
cd web
npm run build
```

## Tinylytics

Thingy uses its own Tinylytics site ID via `TINYLYTICS_SITE_UID`, falling back to
the production ID in `web/_data/site.js`.

Enabled Tinylytics features:

- Page hits with the minified embed script.
- Click/event tracking with `events`.
- Beacon delivery for outbound links with `beacon`.
- Tinylytics Webmention endpoint in the document head.

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

This keeps Tinylytics page URLs clean and avoids recording typed emails or
prompts in analytics.
