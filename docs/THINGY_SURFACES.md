# Where Thingy Lives

This is a working alignment document for Thingy's product surfaces. It is meant
to be edited as the model changes.

## Working Thesis

Thingy is Jamie Thingelstad's archive agent. It helps people explore Jamie's
published work across The Weekly Thing, thingelstad.com, and Another Thing.

Thingy should feel like one coherent agent that appears in a few places, not a
set of unrelated bots. Each surface should have a clear job:

- The web app is the primary Thingy experience.
- Discord is the supporting-member presence and membership validation surface.
- Studio is the brain, corpus pipeline, and internal production environment.

The important boundary: Thingy answers from Jamie's published archive unless a
separate product decision explicitly adds private material. Different modes can
change posture, depth, permissions, and evaluation expectations, but they should
not quietly imply hidden knowledge.

## Surface Map

| Surface | Audience | Primary Job | Should Not Become |
|---|---|---|---|
| `thingy.thingelstad.com` | Readers, supporting members, invited users, Jamie | Full authenticated archive agent | Marketing page or thin launcher |
| Discord member server | Supporting members and Jamie | Membership validation, shared archive companion, mention-driven discussion helper | A second full web app or operator console |
| Studio / Librarian | Jamie and internal agents | Brain, retrieval, corpus, auth, memory, eval, operator loop | Public UI or reader community surface |
| Weekly Thing / blog / podcast sites | Public readers | Source properties that link into Thingy | Separate Thingy implementations |

## Thingy On The Web

The standalone web app is the canonical reader experience.

It should own:

- Standalone authentication and reader identity via `/signin/`.
- Server-side conversations.
- Conversation modes.
- Longer multi-turn work.
- Rich answer rendering.
- Source grounding and visible tool work.
- Curiosity maps and other exploratory artifacts.
- Audio input and playback.
- Conversation history, rename/delete/share/copy actions.
- Clean links from other properties using `from`, `prompt`, and optional source
  narrowing parameters.

The web app can support casual usage, but its real advantage is continuity. It
can know who is signed in, remember explicit preferences, grant supporting
member modes, and let a conversation continue without depending on a Discord
thread or local browser state.

Web Thingy should continue to feel like a standalone product. Weekly Thing,
Another Thing, and the blog are source properties in the knowledge base, not
visual themes that Thingy has to inherit.

### Dispatch

Dispatch is a supporting-member web capability: a requested, Thingy-authored
archive brief sent by email from `thingy@thingelstad.com`.

Dispatch sits beside Chat and Echoes as a named Thingy surface. It should feel
inspired by the shape of The Weekly Thing, but it must not look like Jamie wrote
or curated it. It is written by Thingy, in Thingy's own persona, from Jamie's
published archive.

Expected flow:

- Reader signs in at `thingy.thingelstad.com`.
- Reader opens a Dispatch page.
- Reader enters a topic, concept, or question.
- Thingy may ask one or two clarification questions before doing expensive
  generation work.
- Reader confirms the direction.
- Studio/Librarian checks supporting-member entitlement at the generation
  boundary. Non-supporting readers can explore the shape but must become
  supporting members before a Dispatch is generated and sent.
- Studio/Librarian generates the Dispatch asynchronously.
- Thingy emails the completed Dispatch to the member.
- The Dispatch page shows status and a recent Dispatch log.

Product boundaries:

- Dispatch is gated to supporting members.
- Generation is rate-limited at the API boundary, initially one successful
  Dispatch per supporting member per rolling 24-hour period.
- Jamie/owner can generate Dispatches without that normal member limit.
- Clarification should be cheap and should not consume the daily generation
  quota.
- Dispatches are email-only for readers. The web app can show a log/status, but
  it should not expose a public or reader-facing Dispatch archive.
- Dispatch content must still be stored server-side for delivery records,
  evaluation, debugging, and Dispatch operator reporting.
- Target length is about 1,200 words.
- The email should be polished HTML with a plain-text fallback, shaped similarly
  to The Weekly Thing without being materially fancier than The Weekly Thing.
- The email should be clearly labeled as prepared by Thingy from Jamie's
  published archive.
- Dispatch should have its own operator report because its lifecycle, cost,
  quality checks, and delivery state differ from chat conversations.

Implementation boundary:

- The static web app owns the Dispatch UI.
- Studio/Librarian owns entitlement checks, rate limiting, retrieval,
  generation, artifact storage, email delivery, and Dispatch reporting.
- The API `create` action only queues the Dispatch. A dedicated Dispatch Lambda
  performs the expensive generation and email send from the queued record.
- Discord is not required for Dispatch and should not gate access to it.

## Thingy In Discord

Discord can still be a meaningful home for Thingy, especially as supporting
members are invited into the server. The role should be narrower and more
social than the web app.

Thingy in Discord should be:

- The presence that validates Discord users as supporting members.
- Responsible for adding the appropriate Discord role after auth succeeds.
- Present in `#general`.
- Available when mentioned.
- Useful in the flow of member discussion.
- Concise by default.
- Grounded in source links.
- Good at saying "continue this in the web app" when the thread wants depth.
- Able to help Jamie notice questions that deserve a human response.

Good Discord behaviors:

- Authenticate a Discord user against their supporting-member identity and add
  the supporting-member role.
- Respond when mentioned in `#general`.
- Suggest related archive links for an active discussion.
- Add context when someone shares a Weekly Thing, blog, or podcast link.
- Post a new-issue companion card with discussion prompts and related older
  archive threads.
- Let members react to flag a good question for Jamie.
- Broadcast occasional archive prompts, carefully and sparingly.

Discord Thingy should not try to reproduce the full web client. In particular,
it should not own:

- A separate persistent conversation model.
- Manual corpus selection as a primary UX.
- Long research sessions.
- Rich artifact rendering.
- Mode entitlement enforcement beyond the auth/role validation needed for
  Discord access.
- Private or hidden knowledge.

The bridge can still call the same Librarian API, but the Discord behavior
should be designed around Discord's strengths: short exchanges, shared context,
reactions, mentions, threads, roles, and links back to the canonical web app.

## Thingy In Studio

Studio is where Thingy's intelligence lives.

Studio owns:

- The Librarian API.
- Corpus construction and freshness.
- Retrieval, embeddings, reranking, and archive tools.
- Magic-link auth.
- Entitlements.
- Server-side conversations.
- User profile and memory.
- Conversation modes.
- Feedback persistence.
- Evaluation and operator metadata.
- Discord webhook cards for operator visibility.
- Dispatch generation, delivery, storage, rate limits, and Dispatch-specific
  operator reporting.

Studio also uses Thingy internally as archive infrastructure. The workshop bots
can call Thingy's semantic retrieval when they need archive context:

- Linky uses archive resonance when evaluating links.
- Eddy uses archive context for draft review and Echoes.
- Compose Echoes writes a reader-visible archive note in Thingy's voice.
- Patty writes supporting-member CTA and thank-you copy in Thingy's voice, while
  Patty herself remains invisible to readers.

This means Thingy has two different kinds of Studio presence:

- Runtime intelligence for public/user-facing Thingy.
- Internal archive recall and voice reference for Jamie's production workflow.

Those should stay related but distinct. The public Thingy agent should remain
legible to readers. Internal Studio agents can use Thingy's retrieval and voice,
but they should not blur into the public Thingy identity unless the output is
intentionally signed as Thingy.

## Current Discord Bridge Implication

The existing `apps/thingy_bridge/` app is mostly stale for the new Discord
direction.

Worth keeping:

- Discord process skeleton.
- Startup/status notices.
- Gateway watchdog.
- The ability to manage roles after a successful auth flow.
- A small mention handler for `#general`.

Deprecated:

- Reader-facing `#ask-thingy` as a full second chat client.
- Operator commands such as `/thingy recent` and `/thingy show`, now replaced
  by the Operator Report.
- `/thingy scope`, because Thingy should choose sources by default.
- `/thingy new`, because server-side conversations are canonical.
- API-side conversation and evaluation visibility in Discord, now better owned
  by the Operator Report.
- Local Discord request/session storage.
- Discord-specific answer rendering that assumes Weekly Thing-only citations.
- Discord bridge auth that bypasses the normal reader identity flow.

The likely direction is not "delete the bridge." It is to turn the bridge into
a supporting-member Discord presence.

## Proposed Discord Shape

If supporting members are invited into Discord, Thingy should have a small,
intentional feature set.

### Member Validation

Thingy should validate a Discord user as a supporting member and grant the
server role that unlocks the member space.

Expected behavior:

- User joins Discord or requests access.
- Thingy gives them an auth path.
- User proves control of the supporting-member email/account.
- Librarian or the membership backend verifies entitlement.
- Thingy adds the configured Discord role.
- The bridge records enough state to avoid repeated validation friction, but
  Studio remains authoritative for the entitlement.

Implementation note: role assignment requires a configured guild id, role id,
and Discord bot permission to manage roles. The bot's role must be higher than
the member role in Discord's role hierarchy.

### `#general` Mentions

Thingy can respond when explicitly mentioned in `#general`.

Expected behavior:

- Read the message or thread context.
- Offer relevant archive context.
- Stay short.
- Link sources.
- Include a web continuation link when the answer wants depth.
- Avoid interrupting normal conversation.

### Related Links

A slash command, message action, or direct mention could ask Thingy for related
archive material.

Example jobs:

- "What has Jamie written that relates to this?"
- "Find a related Weekly Thing issue."
- "Is there an older thread behind this idea?"

This is likely more useful in Discord than long-form Q&A because it improves the
member discussion already happening there.

### New-Issue Companion

When a Weekly Thing issue publishes, Thingy could post a companion card for
supporting members:

- Short issue summary.
- Three discussion prompts.
- Two or three older archive connections.
- Link to continue in web Thingy.

This should be event-driven and restrained. Discord should not become a noisy
broadcast channel.

### Question Queue For Jamie

Members could react to a Thingy exchange to flag it for Jamie.

Possible behavior:

- Member reacts with a configured emoji.
- Bridge records the question/conversation id.
- Operator Report shows it as "member question for Jamie."

This gives the member Discord a useful loop without requiring Jamie to watch
every channel in real time.

## Mode Implications

Modes should stay backend-enforced.

The web app is the best home for showing and switching modes. Discord can expose
mode-shaped behavior, but should not become the source of truth for entitlements
or mode permissions.

Possible model:

- Default Discord answers use normal `thingy` mode.
- Supporting members can continue in the web app with `research_guide`.
- Discord may show a "continue in Research Guide" link when the member is
entitled.
- Jamie-only or Trusted Circle modes should stay out of shared member channels
  unless explicitly designed otherwise.

Open issue: mapping Discord members to authenticated Thingy users. If Discord
Thingy needs entitlement-aware responses, the bridge needs a durable identity
link between Discord user id and verified email/subscriber account. Without
that, keep Discord behavior conservative and use the web app for entitlement
specific work.

## Product Boundaries

Thingy should do:

- Answer from the published archive.
- Link back to sources.
- Distinguish source properties clearly.
- Remember explicit user preferences in authenticated contexts.
- Help people find trails through Jamie's work.
- Help Jamie see what readers are asking and where answers fail.

Thingy should not do:

- Pretend to be Jamie.
- Browse the live web as a general assistant.
- Invent private knowledge.
- Let Discord-local state override canonical server conversations.
- Make supporting members choose corpuses manually as a normal flow.
- Hide operational behavior from Studio/operator review.

## Open Questions

1. Should supporting members get Discord Thingy access before, after, or at the
   same time as Research Guide access on the web?
2. What is the exact auth path for linking a Discord user to a verified
   supporting-member account?
3. Should a server role be enough for mention responses, or should each
   response also check current entitlement with Studio?
4. Should Discord answers be logged as canonical conversations in the same
   server-side system as web conversations?
5. What reaction should flag a member question for Jamie?
6. Should new Weekly Thing issues automatically produce a Thingy companion card?
7. Should the existing `#ask-thingy` behavior be removed outright before
   members are invited?
8. What should the first Dispatch email be called publicly: Dispatch, Thingy
   Dispatch, Archive Dispatch, or something else?
9. Should Dispatches be viewable later in the web app, or only delivered by
   email for the first version?

## Near-Term Implementation Notes

The next bridge refactor should probably:

- Remove `/thingy recent` and `/thingy show`.
- Remove `/thingy scope`.
- Remove `/thingy new`.
- Remove the old `#ask-thingy` always-on chat path.
- Remove local request/session/scope storage that only supported the old bridge.
- Add supporting-member auth and role assignment.
- Add mention-only engagement in `#general`.
- Add concise web continuation links for Discord answers.
- Update Discord answer rendering for cross-source citations if answers remain
  in Discord.
- Add entitlement awareness only through a clean Studio/Librarian contract.
- Update bridge docs and tests to match the new surface model.
