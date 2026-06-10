# Thingy Web Re-platform — Preact + Signals

> **Status: COMPLETE (June 2026).** All six steps below shipped, plus the
> follow-ups: shell/account components, signal-backed chat state (the
> `state` Proxy in `bootChat`), and the extracted dispatch action layer
> (`dispatch-actions.js`). Remaining intentionally-unmigrated surfaces:
> the signin and discord pages (small, self-contained vanilla modules)
> and the source picker / mode select / mobile title inside chat.
> This document is retained as the design brief and architecture map.

A build brief for moving the Thingy web app's two controller blobs
(`thingy-chat.js`, ~1,700 lines; `thingy-dispatch.js`, ~730 lines) onto
Preact + `@preact/signals`. The goal is to delete the hand-rolled
mutation→render orchestration that makes the app brittle, not to rewrite it.

## Why

- The chat controller holds ~25 mutable closure variables; every mutation must
  manually invoke the right subset of `renderRecents()` / `renderModeBanner()` /
  `updateQuestionState()` / `updateMobileConversationTitle()` /
  `refreshAccountIdentity()`. Missing one is the standard Thingy bug.
- Streaming re-renders the entire message (`innerHTML` + full markdown re-parse)
  per animation frame.
- Chat and Dispatch hand-wire the same shell/rail/account UI twice with
  parallel `getElementById` forests.
- The controllers execute on import and touch the DOM immediately, so the 43%
  of the codebase where bugs live is untestable.

## What does NOT change

- **Hosting**: static `vite build` → `_site/` → GitHub Pages. No server, no SSR.
- **Multi-page structure**: `/`, `/chat/`, `/dispatch/`, `/signin/`, `/discord/`
  remain separate Vite entry points.
- **The module layer**: `thingy-markdown.js`, `thingy-stream.js` (SSE parser),
  `thingy-modes.js`, `thingy-scope.js`, `thingy-icons.js`, `thingy-http.js`,
  `thingy-session.js`, `thingy-conversations.js` stay vanilla. They are pure
  logic and already tested. Components call them.
- **The Librarian API contract**: untouched.

## Dependencies

```
npm install preact @preact/signals
npm install -D @preact/preset-vite
```

One plugin line in `vite.config.js`. Bundle cost ≈ 4 KB gzip (Preact) + 2 KB
(signals). JSX is optional — `htm` tagged templates work if we want to avoid a
transform, but the preset is already wired into Vite, so use JSX.

## Store shape (signals)

One module, `src/shared/stores/chat-store.js`, replacing the closure variables:

```js
// identity
token, profile, preferredName, availableModes            // signals
signedIn = computed(() => Boolean(token.value) && !expired)

// conversations
conversations, activeConversationId                       // signals
activeConversation = computed(...)
conversationTitle  = computed(...)

// composer / in-flight
activeMode, activeScope, questionText                     // signals
answerInFlight, welcomeInFlight, mapInFlight,
conversationCreateInFlight                                // signals
interactionBusy = computed(() => any of the above)
stoppable = computed(() => answerInFlight.value && controller != null)

// per-message stream state lives in the message model, not the DOM:
// { role, content: signal(''), citations: signal([]), activity: signal([]),
//   status: 'streaming' | 'done' | 'stopped' | 'error' }
messages                                                   // signal of array
```

Actions (plain async functions that set signals): `submitQuestion`,
`stopAnswer`, `loadConversation`, `deleteConversation`, `renameConversation`,
`switchMode`, `signOut`, `refreshConversations`. All UI updates happen because
components read signals — no render calls anywhere in actions.

Multi-tab sync, session refresh, and storage persistence attach to the store
(effects), not to components.

## Component map

Shared (used by both apps):
- `<AppShell>` — rail collapse/scrim/mobile state (replaces `thingy-shell.js`)
- `<Rail>` / `<RailRecents>` — recents list, active highlight, delete
- `<AccountMenu>` — identity, preferred name, Discord row, logout
- `<Composer>` — textarea autosize, count, voice, send/stop morphing button
- `<Notice>` — toast surface (replaces the Phase 0 `showNotice` helper)
- `<ConfirmDialog>` / inline rename — retires `window.prompt`/`confirm`

Chat page:
- `<ChatApp>` — auth gate + bootstrap (URL params, magic link, saved conversation)
- `<MessageList>` → `<UserMessage>`, `<AssistantMessage>`
  - `<AssistantMessage>` renders `content` through the existing markdown module;
    streaming appends to the message's `content` signal — only that subtree
    re-renders, fixing the per-frame full re-parse
  - `<ActivityLog>`, `<CitationList>`, `<ExperienceCard>`, `<CuriosityMap>`
- `<SourcePicker>`, `<ModeBanner>`, `<MobileChatBar>`

Dispatch page:
- `<DispatchApp>`, `<DraftList>`, `<DraftView>` — reuses shell/composer/account

## Migration order (islands, no big-bang)

Each step ships independently; the IIFE keeps running around the islands.

1. **Scaffold** — preset plugin, store module, render one trivial island
   (`<Notice>`) from the existing controller. Proves build + deploy.
2. **Conversation rail** — `<Rail>`/`<RailRecents>`/`<AccountMenu>` read the
   store; the IIFE writes to store signals instead of calling `renderRecents()`.
   Deletes the largest manual-render cluster.
3. **Composer** — send/stop button, count, busy state from `interactionBusy`.
4. **Message list** — move message state into the store; stream renderer
   becomes signal appends. This is the biggest win and the trickiest step;
   port the Phase 0 behaviors (stop, partial-preserve, retry) as store actions.
5. **Auth gate + bootstrap** — last, because it touches redirects. After this
   the chat IIFE is gone; `chat.js` renders `<ChatApp>`.
6. **Dispatch** — port onto the shared components; delete `thingy-dispatch.js`
   and the duplicated `dispatch-*` ID namespace from its HTML.

## Test strategy

- Store actions are plain functions over signals — unit-test them in
  `node:test` like the existing leaf modules (mock `fetch`/stream). This puts
  tests on the code that has none today.
- Component smoke tests via `@testing-library/preact` only where behavior is
  subtle (composer morphing, retry flow). Don't chase coverage on markup.
- Keep `docs/QA-CHECKLIST.md` as the manual gate; add `npm test` + `npm run
  lint` to the deploy workflow (Phase 0 follow-through).

## Contract notes for the Librarian side (do alongside, not blocking)

- Structured error codes on every error response (`code` field is already
  whitelisted client-side in `thingy-url.js`; make the server always send it).
- `draft`/`auto_titled` marker on conversation rows so the client's empty-draft
  cleanup stops needing any title heuristic at all (Phase 0 added an explicit
  client-side `draft` flag; server rows still use the title fallback).
