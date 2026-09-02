# Thingy Surfaces

Thingy has two public surfaces: the web application at
`thingy.thingelstad.com` (a static client backed by the Librarian API) and
the Librarian MCP server at `librarian.thingelstad.com/mcp` (the same tool
registry, served to third-party AI clients over OAuth 2.1).

## Surface Map

| Surface | Audience | Responsibility |
| --- | --- | --- |
| Thingy web | Readers and Jamie | Sign-in, chat, conversations, account, feedback, and the About/Connect content pages |
| Librarian MCP | Claude, ChatGPT, and other MCP clients | The archive tool registry over OAuth 2.1, with per-user quotas |
| WebMCP page tools | Agents in the reader's browser | The 16 archive-read tools, registered with the browser's model context while signed in; calls proxy same-origin to the Librarian `/tools` door on their own quota pool |
| Librarian API | Thingy web and approved internal clients | Critical retrieval, conversation, and streaming services |
| Source sites | Readers | Canonical published Weekly Thing and personal-site content |

## Web Responsibilities

The web application owns the complete reader experience:

- Authenticated chat (conversation modes retired 2026-09).
- Source and scope selection.
- Conversation history and account profile controls.
- Feedback and diagnostics exposed to the reader.

(The Dispatch surface was removed in 2026-08; its `/dispatch/` redirect stub was removed 2026-09.)

The web application is statically built and served from a private S3 bucket
behind CloudFront; the same distribution fronts the Librarian same-origin as
`/api/*`, and the session is an HttpOnly cookie the page cannot read. It does
not own private corpus ingestion, retrieval infrastructure, or server-side
conversation state.

## Librarian Boundary

The Librarian API is critical infrastructure and remains operational. It owns
the server-side contracts used by the Thingy web application, including:

- `/auth`
- `/chat`
- `/feedback`
- `/conversations`
- `/memory`
- `/retrieve` (served for `wt-builder`; the Thingy web client never calls it)
- `/tools` - the WebMCP page-tool door (session-authenticated; reached by
  the web app as `/api/tools` through its own distribution, deliberately not
  routed on librarian.thingelstad.com)
- `/mcp` plus the OAuth 2.1 endpoints (`/register`, `/token`, `/authorize`,
  `/.well-known/*`) - served to third-party MCP clients, never called by the
  Thingy web client
- streaming responses

These are covered by the generated, versioned Librarian contract (currently
3.1.0). Librarian now lives in `librarian-thing`; Studio was retired on
2026-08-28, preserving these API contracts and the data and infrastructure
behind them. (`/dispatch` was removed with the Dispatch surface in 2026-08.)

## Architecture Rules

- Keep reader interaction in the Thingy web application.
- Keep retrieval and private archive infrastructure behind Librarian.
- Treat Librarian compatibility as a release gate for Thingy changes.
- Add another user-facing surface only when it has a distinct, durable job.
