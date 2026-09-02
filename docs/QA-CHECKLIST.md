# Thingy QA Checklist

Use this for a quick confidence pass after auth, chat, or shell UI changes.

## Local Setup

Run the web app with the same-origin `/api` config; the dev server proxies
`/api` to the live Librarian (export `THINGY_WEB_ORIGIN_TOKEN` from the
librarian `.env` so cookie-authenticated calls carry the origin marker):

```sh
cd web
LIBRARIAN_API_URL=/api LIBRARIAN_STREAM_URL=/api npm run serve -- --port=8080
```

Build and tests:

```sh
cd web
npm run lint
npm test
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run build
```

Browser smoke, with the local server already running:

```sh
cd web
THINGY_SMOKE_URL=http://localhost:8080 npm run smoke
```

Real API QA, with the local server already running and `LIBRARIAN_API_URL`,
`LIBRARIAN_STREAM_URL`, and either `THINGY_SESSION_TOKEN` or a Fastmail JMAP
token exported:

```sh
cd web
THINGY_QA_EMAIL=thingy@thingelstad.com npm run qa:real
```

Cleanup only for QA-prefixed conversations:

```sh
cd web
npm run qa:real -- --cleanup-only
```

## Auth

- Visit `/chat/` signed out; it should redirect or show auth without leaking
  `email`, `prompt`, `from`, `scope`, or `corpus` in `/signin/?return=...`.
- Request a sign-in code for `thingy@thingelstad.com`.
- Use JMAP Inbox/Thingy to read the latest code; enter it on `/signin/`
  (the field offers macOS/iOS code autofill).
- Confirm successful auth lands on `/chat/` and removes `login_token`.
- Reuse the same code; it should fail.
- Sessions are 9 days, sliding: any page visit while signed in re-confirms
  the HttpOnly session cookie server-side. Confirm a visit to `/` while
  signed in does not sign you out.
- Log out; privileged UI should clear.
- WebMCP (beta): signed in on `/chat/`, the browser model context lists the
  archive tools (visible via a WebMCP inspector/bridge extension); they
  disappear on sign-out, and a tool call moves only the `web_tools` quota.

## Chat

- Ask a short question with Return.
- Ask while the welcome/setup message is still starting; no orphaned
  "getting oriented" message should remain.
- Confirm the answer renders, activity collapses, and the conversation appears
  active in the rail.
- Ask a photo question ("photos from bike rides"); inline thumbnails should
  render and click through to the source page in a new tab.
- Use the message actions: copy, share, thumbs up/down. There is no audio
  playback button and no email button (retired for share links, 2026-09).
- Share a conversation from the conversation menu: confirm dialog states the
  whole conversation becomes readable, the link lands on the clipboard, and
  opening it in a private window renders the snapshot with citations and the
  sign-in CTA. Stop sharing; the same link now shows the unavailable state.
- Re-share an already-shared conversation; the URL stays the same and newer
  turns appear at the link.
- Fast-click New Chat; only one active local "New chat" shell should remain.
- Expand/collapse the rail and switch conversations.
- Account panel shows "Today's usage" (chat pool; MCP pool once used).

## Static Pages

- `/about/` and `/connect/` render in light and dark with the top nav; the
  current page is highlighted; brand mark returns home.
- `/connect/` instructions match the live MCP endpoint
  (`https://librarian.thingelstad.com/mcp`).

## Mobile

At `390x844`:

- Chat rail drawer opens without horizontal overflow.
- Composer and mobile header do not overlap.
- Static pages have no horizontal scroll.

## Librarian Backend

From `librarian-thing`:

```sh
npm --prefix apps/librarian/lambda test
make librarian-deploy ARGS="--skip-corpus-upload"
```

After deploy, make one direct or browser Chat request and confirm Stream Lambda
returns SSE events: `meta`, `status`, `answer`, `citations`, `done`. The
deploy workflow also runs the tool-surface eval (invariants + known answers)
and blocks on failure.
