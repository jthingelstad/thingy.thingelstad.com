# Thingy Surfaces

Thingy has one public surface: the web application at
`thingy.thingelstad.com`. It is a static client backed by the Librarian API.

## Surface Map

| Surface | Audience | Responsibility |
| --- | --- | --- |
| Thingy web | Readers and Jamie | Sign-in, chat, Research Guide, conversations, curiosity map, account, and feedback |
| Librarian API | Thingy web and approved internal clients | Critical retrieval, conversation, and streaming services |
| Source sites | Readers | Canonical published Weekly Thing and personal-site content |

## Web Responsibilities

The web application owns the complete reader experience:

- Authenticated chat and Research Guide modes.
- Source and scope selection.
- Conversation history and account profile controls.
- Curiosity map generation and review.
- Feedback and diagnostics exposed to the reader.

(The Dispatch surface was removed in 2026-08; `/dispatch/` is a redirect stub.)

The web application is statically built and hosted. It does not own private
corpus ingestion, retrieval infrastructure, or server-side conversation state.

## Librarian Boundary

The Librarian API is critical infrastructure and remains operational. It owns
the server-side contracts used by the Thingy web application, including:

- `/auth`
- `/chat`
- `/feedback`
- `/conversations`
- `/retrieve` (served for `wt-builder`; the Thingy web client never calls it)
- streaming responses

These are covered by the generated, versioned Librarian contract (currently
2.0.0). Librarian now lives in `librarian-thing`; Studio was retired on
2026-08-28, preserving these API contracts and the data and infrastructure
behind them. (`/dispatch` was removed with the Dispatch surface in 2026-08.)

## Architecture Rules

- Keep reader interaction in the Thingy web application.
- Keep retrieval and private archive infrastructure behind Librarian.
- Treat Librarian compatibility as a release gate for Thingy changes.
- Add another user-facing surface only when it has a distinct, durable job.
