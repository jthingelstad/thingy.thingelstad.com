# Thingy Surfaces

Thingy has one public surface: the web application at
`thingy.thingelstad.com`. It is a static client backed by the Librarian API.

## Surface Map

| Surface | Audience | Responsibility |
| --- | --- | --- |
| Thingy web | Readers and Jamie | Sign-in, chat, Research Guide, conversations, Dispatch, and feedback |
| Librarian API | Thingy web and approved internal clients | Critical retrieval, conversation, dispatch, and streaming services |
| Source sites | Readers | Canonical published Weekly Thing and personal-site content |

## Web Responsibilities

The web application owns the complete reader experience:

- Authenticated chat and Research Guide modes.
- Source and scope selection.
- Conversation history and account profile controls.
- Dispatch draft review.
- Feedback and diagnostics exposed to the reader.

The web application is statically built and hosted. It does not own private
corpus ingestion, retrieval infrastructure, or server-side conversation state.

## Librarian Boundary

The Librarian API is critical infrastructure and remains operational. It owns
the server-side contracts used by the Thingy web application, including:

- `/auth`
- `/chat`
- `/feedback`
- `/conversations`
- `/dispatch`
- `/retrieve`
- streaming responses

Librarian is implemented alongside Studio today, but its lifecycle is
independent. Retiring Studio and its agents is separate work and must preserve
these API contracts and the data and infrastructure behind them.

## Architecture Rules

- Keep reader interaction in the Thingy web application.
- Keep retrieval and private archive infrastructure behind Librarian.
- Treat Librarian compatibility as a release gate for Thingy changes.
- Do not couple Librarian availability to Studio's future retirement.
- Add another user-facing surface only when it has a distinct, durable job.
