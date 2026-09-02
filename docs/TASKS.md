# Thingy Tasks

Concrete follow-ups for the web surface. Backend/API tasks live with the
Librarian implementation in `librarian-thing`
(`docs/librarian-tasks.md`).

## Access

(Conversation modes were retired 2026-09; the mode rollout tasks that lived
here went with them. See `docs/ROADMAP.md` for the retirement record.)

## Web UX

- [ ] Keep the mobile/tablet/desktop QA checklist current for rail, New Chat, voice input, feedback comments, expired sessions, and prompt links.
- [x] Conversation share links shipped 2026-09 (`/c/<token>`, share/unshare in the conversation menu).

## Operator Experience

- [ ] Decide whether the static operator report is enough or whether a real authenticated dashboard should be built after owner/admin auth is stronger.
- [ ] Make sure operator reports show mode clearly without becoming noisy.
- [ ] Turn repeated evaluator findings and downvote comments into a concise improvement queue.

## Docs

- [ ] Keep this repo's `docs/ROADMAP.md` (the single Thingy product roadmap) aligned with `librarian-thing`'s `docs/librarian-tasks.md` and `reference/librarian.md` when backend capabilities change.
- [ ] Keep URL parameter docs aligned with `web/vite.config.ts` and the route HTML files in `web/`.
