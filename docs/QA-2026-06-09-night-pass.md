# Thingy QA Pass - 2026-06-09

Night pass focused on real auth, signed-in UX, out-of-order interactions,
mobile layout, Dispatch shaping, and stream/security failure modes.

## Surfaces Exercised

- Root landing page.
- Standalone `/signin/`.
- `/chat/` signed out, signed in, magic-link return, conversation recents, new
  chat, conversation switching, source/prompt params, and mobile rail drawer.
- `/dispatch/` signed in, sent Dispatch history, new Dispatch, clarification,
  ready-to-generate state, and mobile rail drawer.
- Live Librarian API and Stream Lambda.
- JMAP Inbox/Thingy lookup for real `thingy@thingelstad.com` magic-link login.

## Bugs Found and Fixed

- Standalone sign-in left invalid/reused `login_token` values in the URL after a
  failed magic-link redemption. It now scrubs magic-token params on success and
  failure.
- Chat stream Lambda was deployed with a cold-start import failure:
  `archive-tools.mjs` did not export `collectToolCitations`. Studio now exports
  the missing collector, the Librarian tests pass, and the Lambda was deployed.
- The web stream client treated JSON Lambda error bodies as empty successful
  streams. It now detects JSON stream responses and surfaces them as errors.
- Asking Chat while the welcome/setup message was still settling could leave
  placeholder UI behind. Welcome cancellation now removes orphaned setup
  placeholders, and empty completed streams produce a clear error instead of a
  permanent "thinking" message.
- Dispatch opened a previously sent Dispatch with the composer still enabled.
  Sent/queued/generating/sending/failed Dispatches are now read-only and point
  the user to New Dispatch.
- Signed-out redirects from sensitive app URLs could embed `email`, `prompt`,
  `from`, `scope`, or `corpus` inside `/signin/?return=...`. Sign-in now stashes
  those params in `sessionStorage` during the auth hop and keeps the visible
  sign-in URL clean.

## Verification

- Real magic-link login with `thingy@thingelstad.com` via JMAP Inbox/Thingy.
- Reused magic link fails and strips the token from the standalone sign-in URL.
- Name saved as `Codex Night QA` and persisted after reload.
- Direct post-deploy stream probe returned proper SSE:
  `meta`, `status`, `answer`, `experience`, `citations`, `done`.
- Browser Chat rendered an RSS answer with activity and rail recents.
- Fast New Chat produced a single active local shell.
- Conversation switching worked after expanding the rail.
- Dispatch sent history is read-only; New Dispatch accepts input.
- Dispatch clarification reached ready state with Generate Dispatch visible.
- Mobile chat and Dispatch rails opened correctly at `390x844` with no
  horizontal overflow.
- Web build passed.
- Studio Librarian tests passed: 105/105.

## Follow-Ups

- Browser automation text entry is awkward because the in-app browser's virtual
  clipboard is unavailable; keypress testing works but is slow.
- Some DOM text snapshots concatenate adjacent paragraphs without visible
  spacing, especially in Dispatch clarification text. The rendered layout should
  be spot-checked visually during a future polish pass.
