# Thingy Roadmap

Thingy is evolving from an archive search surface into an authenticated archive agent: a conversational
interface to Jamie's published work that can remember context, reason across corpora, and eventually offer
different conversation modes based on who is signed in.

This document is the living roadmap for the public Thingy web surface and its relationship to the Studio
Librarian API. Historical build briefs belong under `docs/history/`; this file should reflect the current
product direction.

## Product Principles

- **Published archive first.** Thingy represents Jamie's published work. Conversation modes can change
  posture and depth, but they should not require a hidden private corpus by default.
- **Identity unlocks capability.** Magic-link authentication lets Thingy know who it is talking to, attach
  conversations to users, and grant modes by entitlement.
- **Modes are not alter egos.** A mode is a conversation-level contract: permission, tone, tool policy,
  logging, and user expectation. A conversation should not silently change modes midstream.
- **The web app is the primary experience.** Discord is useful for operator notifications and follow-up
  commands, but it is not the right home for nuanced, multi-conversation user experience.
- **The backend stays authoritative.** Auth, entitlements, conversation history, evaluation, tools, and
  corpus intelligence live in Studio/Librarian. This repo is the thin web surface and bridge client.
- **Durable source metadata over prompt cleverness.** Retrieval quality comes from the corpus and its
  link graph, not from ever-longer prompts.
- **Server-side conversations are the canonical record.** The client never owns history.
- **Operator review is asynchronous.** Discord is for notifications; it is never in the user request path.

## Shipped

### Standalone Thingy Web

- Moved Thingy to `thingy.thingelstad.com`.
- Reworked the UX from a publication-style page into a chat-client experience.
- Added responsive mobile navigation, conversation rail, conversation actions, cache-busted assets, and a
  dedicated sign-in page.
- Added richer message actions: copy, share, feedback, response audio playback, and prompt audio input.

### Real Authentication

- Replaced the old "does this email belong to a subscriber?" gate with magic-link authentication.
- Magic links are short-lived, single-use, and sent to the claimed email address.
- Auth email is sent through Fastmail JMAP as `thingy@thingelstad.com`.
- Browser sessions expire after 12 hours and return users to a dedicated sign-in flow.
- The sign-in page makes clear that Weekly Thing readers can sign in, and new addresses can start the
  subscriber path directly.

### Server-Side Conversations

- Conversations are persisted in the Librarian API instead of local storage.
- The client no longer has to send the whole chat history on every turn.
- Conversations have metadata, generated titles, deletion, rename, feedback, and operator visibility.
- Prompt parameters can seed a new conversation directly.

### Corpus Richness

- Thingy now works across The Weekly Thing, thingelstad.com, and Another Thing.
- Corpus metadata is richer and more even across sources: dates, domains, source identity, internal links,
  external links, and podcast metadata.
- The API includes tools for archive search, corpus summaries, linked domains, source exploration,
  timeline-like summaries, and curiosity map generation.
- Markdown rendering supports richer answers, including tables and horizontal rules.

### Operator Loop

- Conversation activity and evaluator results are visible outside the user flow.
- Discord webhooks provide event-driven notices without making user requests depend on the Discord bot.
- The bot remains useful for follow-up actions such as inspecting conversations.
- A local operator report provides a more grounded view of recent conversations, evaluations, feedback,
  and system behavior.

### Delight Features

- Agentic welcome behavior uses local time, conversation history, and membership context.
- Thingy can remember the user's name. The earlier AI-synthesized reader memory was deliberately
  removed: server-side conversations cover continuity, and the profile is now basic account metadata
  (name, Discord link, activity counts).
- Curiosity map creates visual trails through the archive and can seed new conversations.
- Archive work/tool activity is visible in the chat, then collapses after completion.
- Archive Sparks can surface adjacent ideas, though emission needs continued tuning.

## Current Mode Model

### Conversation Modes

Conversation modes are now the first identity-aware capability beyond default Thingy. They are stored on
the conversation, enforced by the backend, and shown clearly in the web app and operator reports.

Initial modes:

- **Thingy**: default mode for authenticated readers. Helpful, careful, grounded in the public archive.
- **Research Guide**: deeper synthesis for supporting members. Better trails, timelines, comparisons, and
  "teach me through the archive" behavior.
- **Thought Partner**: owner-only initially. More challenging and reflective; helps Jamie interrogate his
  own published thinking, contradictions, recurring themes, and avoided questions.
- **Trusted Circle**: warmer mode for explicitly invited family or close friends, still based on the
  published archive unless a separate, explicit data policy is created.

Mode rules:

- A conversation is created in exactly one mode.
- Changing mode starts a new conversation, optionally seeded with a summary or continuation prompt.
- Mode is logged on every conversation and evaluator record.
- The operator dashboard/report should filter and group by mode.
- The client may hide unavailable modes, but the API must enforce entitlement checks.

### Entitlements

Mode access should be based on backend entitlements, not UI-only state.

Entitlement sources:

- **Owner**: explicit server-side allowlist for Jamie's verified email address.
- **Supporting member**: Buttondown subscriber status or Buttondown tags.
- **Trusted circle**: Buttondown tags are the cleanest operator interface. For example,
  `thingy-trusted-circle`, `thingy-family`, or `thingy-close-friends`.
- **Reader**: any verified subscriber/reader allowed into Thingy.

Buttondown tags are attractive because they keep the permission UI where the audience already lives and
avoid building a custom admin panel too early. The Librarian API should normalize whatever Buttondown
returns into a small set of durable entitlements such as `reader`, `supporting_member`, `trusted_circle`,
and `owner`.

### Logging and Evaluation

Conversation modes need first-class observability.

- Store `mode`, source scope, eval status, feedback, tool traces, and artifacts on canonical server-side conversations.
- Store `mode` on every turn/evaluation event so mode-specific failures are easy to audit.
- Keep evaluator checks mode-aware: default Thingy should not overbuild, Research Guide should reason carefully across timelines, Thought Partner should challenge without inventing private context, and Trusted Circle should be warm without becoming ungrounded.
- Show mode filters in the operator report.
- Include mode in Discord webhook summaries without making the webhook verbose again.

### No Hidden Owner Corpus for Now

The earlier roadmap proposed a private/owner corpus with unpublished drafts. That is no longer the
default direction.

Thought Partner should start by challenging Jamie using the same published archive that readers can ask
about. That is both safer and conceptually cleaner: the mode changes the relationship to the material, not
the material itself.

If private material is ever introduced, it should be treated as a separate product decision with explicit
visibility guarantees, tests, and operator reporting. It should not sneak in as an implementation detail
of Thought Partner.

## Near-Term Direction

- **Mode rollout and permissions**: finish the operational path for granting Trusted Circle access
  through Buttondown tags and make the operator report clearly surface mode usage.
- **Better operator dashboard**: keep Discord webhooks as notifications, but move deeper review to a
  local/web operator interface grounded in server-side conversations.
- **Corpus freshness observability**: make it obvious when the API corpus was last built from each
  source and whether new blog/podcast content has landed.
- **Citation discipline**: keep improving evaluator checks for citation-footer mismatches,
  retrospective evidence mislabeled as contemporaneous, and title-only recommendations.
- **Runtime resilience**: continue improving timeout handling, partial-answer handling, and evaluator
  interpretation of runtime exhaustion.
- **Browser QA discipline**: keep mobile/tablet/desktop interaction tests for rail, mode selection,
  conversations, curiosity maps, source picker, and input controls.
- **Corpus coverage dashboard** (idea): show source counts, freshness, link graph health, missing
  transcript/post metadata, and source-specific search quality checks.
- **Deeper feedback loop** (idea): let downvote comments and eval notes become a structured
  improvement queue, not just passive metadata.

Backend/API follow-ups implementing these live in the Studio repo's `docs/librarian-tasks.md`.

## Intelligence Roadmap

### Temporal Layer

The temporal layer is still one of the highest-leverage ideas. It should know not only when something was
published, but what season of life, work, travel, family, and world context surrounded it.

Recommended shape:

- Publishable blog pages, not posts, owned and edited by Jamie on thingelstad.com.
- The first version should read like something Jamie is comfortable putting on the public site, not like a
  private structured database.
- Thingy should ingest those pages as part of the published blog corpus and use them as context for
  answers, curiosity map seeds, and mode-specific reasoning.
- Keep the shape loose at first: prose, headings, dates, and links are enough. Avoid schema until the
  product need is obvious.

This does not need to become a private corpus. The timeline can be context metadata. Some entries may be
personal, but the safer initial version should only include pages Jamie is comfortable letting Thingy
reference directly.

### Cross-Corpus Thematic Threading

Thingy should continue improving its ability to connect without flattening:

- Blog posts as exploratory thinking.
- Weekly Thing as curated public framing.
- Another Thing as spoken reflection.

The goal is to answer questions such as "how did this idea move from a blog observation into a newsletter
theme and then into podcast discussion?"

### Durable Theme Clusters

Curiosity map is a strong user-facing expression of this, but the backend should eventually maintain
durable clusters for recurring themes.

Potential clusters:

- IndieWeb and ownership.
- Privacy and surveillance.
- Leadership and management.
- Automation and agentic systems.
- Community, family, and rituals.
- Reading, media, and culture.

Durable clusters would help with conversation titles, related questions, Archive Sparks, operator
reporting, and temporal reasoning.

### Source Selection

The corpus selector is useful but should become less central over time. The long-term behavior should be:

- Thingy chooses the right sources by default.
- Explicit user constraints are honored: "only the blog", "in the newsletter", "on the podcast".
- Source distinction remains in the index and citations.
- Advanced users can still inspect or influence source scope when useful.

## Possible Member Features

### Supporting Member Research Guide

Supporting members could get a deeper mode that feels special without becoming private:

- Longer synthesis.
- Better timelines.
- More cross-source trails.
- Saved curiosity maps.
- "Build me a reading path" prompts.
- Early access to experimental archive features.

### Archive Broadcasts

Discord is probably not the core interaction surface, but broadcast-style moments may still be valuable:

- "On this week in 2019..."
- "A thread resurfaced across blog/newsletter/podcast..."
- "New curiosity trail available..."

Each broadcast should deep-link into authenticated web Thingy with a seeded prompt and a new conversation.

## Open Decisions

1. Should `Research Guide` be supporting-member-only, or available to all readers with usage limits?
2. Which specific people should receive Trusted Circle mode?
3. Should supporting members receive any mode beyond Research Guide?
4. Should the temporal layer include personal entries that Thingy may use but not quote?
5. How aggressive should Thought Partner be, and what should the evaluator consider "too much"?
6. Should corpus/source selectors eventually disappear entirely, or remain as an advanced control?

## Suggested Next Build Sequence

1. Use real conversations and evaluator notes to keep tuning each mode.
2. Decide whether Research Guide should stay supporting-member-only.
3. Add the Trusted Circle Buttondown tags to actual people when there is a concrete invite list.
4. Prototype one publishable timeline page and verify that Thingy can use it without over-structuring it.
5. Tune Archive Sparks and curiosity map generation against durable theme clusters.
