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
  timeline-like summaries, curiosity map generation, and user memory/profile support.
- Markdown rendering supports richer answers, including tables and horizontal rules.

### Operator Loop

- Conversation activity and evaluator results are visible outside the user flow.
- Discord webhooks provide event-driven notices without making user requests depend on the Discord bot.
- The bot remains useful for follow-up actions such as inspecting conversations.
- A local operator report provides a more grounded view of recent conversations, evaluations, feedback,
  and system behavior.

### Delight Features

- Agentic welcome behavior uses local time, user profile, conversation history, and membership context.
- Thingy can remember the user's name and profile details.
- Curiosity map creates visual trails through the archive and can seed new conversations.
- Archive work/tool activity is visible in the chat, then collapses after completion.
- Archive Sparks can surface adjacent ideas, though emission needs continued tuning.

## Current Direction

### Conversation Modes

Conversation modes are the next identity-aware capability. They should be stored on the conversation,
enforced by the backend, and shown clearly in the web app and operator reports.

Initial modes:

- **Thingy**: default mode for authenticated readers. Helpful, careful, grounded in the public archive.
- **Research Guide**: deeper synthesis for supporting members. Better trails, timelines, comparisons, and
  "teach me through the archive" behavior.
- **Sparring Partner**: owner-only initially. More challenging and reflective; helps Jamie interrogate his
  own published thinking, contradictions, recurring themes, and avoided questions.
- **Trusted Circle**: possible future mode for family or close friends. Warmer and more contextual, but
  still based on the published archive unless a separate, explicit data policy is created.

Mode rules:

- A conversation is created in exactly one mode.
- Changing mode starts a new conversation, optionally seeded with a summary or continuation prompt.
- Mode is logged on every conversation and evaluator record.
- The operator dashboard/report should filter and group by mode.
- The client may hide unavailable modes, but the API must enforce entitlement checks.

### Entitlements

Mode access should be based on backend entitlements, not UI-only state.

Recommended entitlement sources:

- **Owner**: explicit server-side allowlist for Jamie's verified email address.
- **Supporting member**: Buttondown subscriber status or Buttondown tags.
- **Trusted circle**: Buttondown tags are probably the cleanest interface. For example,
  `thingy-trusted-circle`, `thingy-family`, or `thingy-sparring-preview`.
- **Reader**: any verified subscriber/reader allowed into Thingy.

Buttondown tags are attractive because they keep the permission UI where the audience already lives and
avoid building a custom admin panel too early. The Librarian API should normalize whatever Buttondown
returns into a small set of durable entitlements such as `reader`, `supporting_member`, `trusted_circle`,
and `owner`.

### Logging and Evaluation

Conversation modes need first-class observability.

- Store `mode`, `entitlements`, `user_email_hash`, and membership tier on each conversation.
- Store `mode` on every turn/evaluation event so mode-specific failures are easy to audit.
- Add evaluator checks for mode fit: was Thingy appropriately helpful, appropriately challenging, or too
  intrusive for the selected mode?
- Show mode filters in the operator report.
- Include mode in Discord webhook summaries without making the webhook verbose again.

### No Hidden Owner Corpus for Now

The earlier roadmap proposed a private/owner corpus with unpublished drafts. That is no longer the
default direction.

Sparring Partner should start by challenging Jamie using the same published archive that readers can ask
about. That is both safer and conceptually cleaner: the mode changes the relationship to the material, not
the material itself.

If private material is ever introduced, it should be treated as a separate product decision with explicit
visibility guarantees, tests, and operator reporting. It should not sneak in as an implementation detail
of Sparring Partner.

## Intelligence Roadmap

### Temporal Layer

The temporal layer is still one of the highest-leverage ideas. It should know not only when something was
published, but what season of life, work, travel, family, and world context surrounded it.

Recommended shape:

- Plain markdown, one file per year, probably in Studio: `data/timeline/{year}.md`.
- Entries can include date ranges, tags, confidence, public/private note, and related URLs.
- The first version should be manually reviewable and owned by Jamie, not an opaque generated database.
- Thingy consumes the timeline as context for answers, curiosity map seeds, and mode-specific reasoning.

This does not need to become a private corpus. The timeline can be context metadata. Some entries may be
personal and non-public, but they can be used to improve interpretation without being quoted or exposed.
The safer initial version should only use timeline entries that Jamie is comfortable letting Thingy
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
2. Should `Trusted Circle` be a real mode, or just an entitlement that unlocks selected features?
3. What Buttondown tags should map to Thingy entitlements?
4. Should the temporal layer include personal entries that Thingy may use but not quote?
5. How aggressive should Sparring Partner be, and what should the evaluator consider "too much"?
6. Should corpus/source selectors eventually disappear entirely, or remain as an advanced control?

## Suggested Next Build Sequence

1. Add backend entitlements and expose them in the authenticated profile response.
2. Add conversation `mode` to API schema, storage, turns, evaluator records, webhook notices, and operator
   report filters.
3. Ship owner-only `Sparring Partner` using the published corpus only.
4. Ship supporting-member `Research Guide`.
5. Prototype one year of the temporal layer and wire it into answers where directly relevant.
6. Tune Archive Sparks and curiosity map generation against durable theme clusters.
