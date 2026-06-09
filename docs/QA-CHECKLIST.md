# Thingy QA Checklist

Use this for a quick confidence pass after auth, chat, Dispatch, or shell UI
changes.

## Local Setup

Run the web app on the CORS-approved local port:

```sh
cd web
LIBRARIAN_API_URL="$LIBRARIAN_API_URL" LIBRARIAN_STREAM_URL="$LIBRARIAN_STREAM_URL" npm run serve -- --port=8080
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

## Auth

- Visit `/chat/` signed out; it should redirect or show auth without leaking
  `email`, `prompt`, `from`, `scope`, or `corpus` in `/signin/?return=...`.
- Request a magic link for `thingy@thingelstad.com`.
- Use JMAP Inbox/Thingy to open the latest magic link.
- Confirm successful auth lands on `/chat/` and removes `login_token`.
- Reuse the same magic link; it should fail and remove `login_token`.
- Log out from Chat and Dispatch; both should clear privileged UI.

## Chat

- Ask a short question with Return.
- Ask while the welcome/setup message is still starting; no orphaned
  "getting oriented" message should remain.
- Confirm the answer renders, activity collapses, and the conversation appears
  active in the rail.
- Fast-click New Chat; only one active local "New chat" shell should remain.
- Expand/collapse the rail and switch conversations.

## Dispatch

- Open a sent Dispatch from the rail; the composer should be disabled.
- Click New Dispatch; the composer should enable and Return should submit.
- Answer one clarification; the draft should reach Generate Dispatch without
  sending unless Generate is clicked.
- Delete a draft/history row and confirm the rail selects the next sensible
  item.

## Mobile

At `390x844`:

- Chat rail drawer opens without horizontal overflow.
- Dispatch rail drawer opens without horizontal overflow.
- The Chat/Dispatch switcher aligns and shows the active surface.
- Composer and mobile header do not overlap.

## Studio Backend

From `studio-thing`:

```sh
npm --prefix apps/librarian/lambda test
make librarian-deploy ARGS="--skip-corpus-upload"
```

After deploy, make one direct or browser Chat request and confirm Stream Lambda
returns SSE events: `meta`, `status`, `answer`, `citations`, `done`.
