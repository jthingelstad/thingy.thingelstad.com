# Thingy Roadmap — from public demo to identity-aware thinking partner

Thingy is becoming two things at once: a best-in-class public agent that represents all of Jamie's
published writing, and a genuine thinking partner for Jamie himself — a way to reflect on a decade-plus
of his own writing. **Knowing who it's talking to, and understanding the writing deeply, are the two
foundations that make both audiences better.**

This roadmap has two tracks that are independent to build but **converge** at the members broadcast:

- **Track A — Identity & surfaces:** *who* Thingy is talking to (magic-link auth, SES, modes, the
  repurposed Discord bridge).
- **Track B — Intelligence:** *how deeply* Thingy understands the corpus (cross-corpus threading, theme
  clustering, authoritative corpus selection, the temporal layer).

## Architecture fit

Nothing here fights the brain/surfaces model — it confirms it. **All the auth and all the intelligence
is backend, and it lives in Studio** (the Librarian/Auth Lambda + `pipeline/corpus` + new `data/`
stores). The surfaces stay thin: web Thingy (this repo) and the bridge (this repo) consume Studio's
capabilities. The bearer-token model is unchanged — the token just carries more (verified identity +
mode); the index just carries more (corpus metadata, theme links, temporal context).

---

## Track A — Identity & surfaces

### Why this came up
Today Thingy gates access by checking that an email belongs to a subscriber — which confirms the
*address* is a subscriber, not that the *person typing* is who they claim. Thingy's evaluator flagged a
conversation where someone claimed to be Jamie and Thingy couldn't verify it. Two gaps: no real
identity verification, and no channel where Thingy can know it's truly Jamie.

### Two modes — and they live in different homes
The one-line distinction: **public mode is "help this reader understand Jamie's thinking"; private mode
is "help Jamie understand Jamie's thinking."** Same backend corpus + temporal context — completely
different engagement, and, it turns out, **different homes**:

- **Public docent → the surface (`thingy.thingelstad.com`).** Helpful, respectful, careful; answers
  strangers' and members' questions about the work. This is the *only* mode the public app ever runs.
- **Private sparring → Studio (the brain).** Less filtered, willing to push back; challenges the
  assumptions in your own writing and asks the questions you'd never pose in public: *"Where am I
  contradicting myself?"*, *"What theme am I avoiding?"*, *"What should I be writing about but aren't?"*
  It's an authoring tool — "Jamie understanding Jamie" — so it belongs with the staff (Eddy/Linky/Marky/
  Patty) and the drafts, not on the public surface.

**Why Studio is the right home for sparring mode.**
- **Stronger security posture.** The privileged mode is never reachable from the public surface — so
  impersonation in public Thingy can't escalate into a mode that isn't there. Better than gating it
  behind auth.
- **Scope follows home.** The Studio tool sits with your private blog drafts and sees unpublished
  thinking by default; the public docent only ever sees published work. The repo boundary *is* the scope
  boundary — no token claim needed.
- **No public auth branch.** In Studio the only user is you, so sparring doesn't depend on the public
  magic-link work. The shared backend (Librarian + corpus + temporal layer) serves both interfaces.

**So the auth work narrows.** Magic-link (A2) is still worth it for the *public* app — subscriber
verification, anti-impersonation, personalization — but it's no longer the gateway to sparring.

**Interface (decided): a private, owner-gated Studio Discord channel.** Studio already runs Discord — the
four personas are bots in one asyncio loop, and the old bridge already gates on `DISCORD_OWNER_USER_ID`.
Sparring Thingy is one more owner-only persona in that loop, calling the same Librarian backend in
sparring mode with full scope. It sits next to the staff and the drafts, right where you do the work — no
web auth, no public exposure.

**Required safeguard: a public/private visibility partition in the index.** For sparring Thingy to
challenge unpublished thinking, the corpus must include your private blog drafts — but the public docent
must never retrieve them. Tag drafts `visibility: private`; retrieval scope is set by *which interface is
asking* (public web app → public-only; Studio operator channel → public + private). Same "metadata stays
in the index, the asker sets scope" pattern as corpus distinction, applied to privacy — so drafts can't
leak to public Thingy by construction.

### Phase A1 — Standalone web Thingy (foundation)
Port Thingy to `thingy.thingelstad.com` at parity with the *current* auth. See `docs/history/STANDALONE_BUILD.md` (preserved as the original build brief; the port has shipped).
Don't over-polish the subscriber-check auth UI or the scope checkboxes — both get replaced later. DNS is
already set (CNAME → GitHub).

### Phase A2 — Identity: magic-link auth + SES + modes (backend-led)
- **Magic link replaces the weak subscriber-check.** Confirmed subscriber email → SES sends a signed,
  short-lived, single-use link → clicking authenticates → mint a bearer token carrying the identity
  claim. Kills impersonation, no backdoor, durable "this is really Jamie" signal. Extend the Lambda's
  existing HMAC session crypto.
- **SES infra.** New transactional path (already in AWS). Keep the friendly From
  `thingy@thingelstad.com` but DKIM-sign on a **dedicated subdomain** so auth-mail reputation stays
  isolated from newsletter deliverability. **Request SES production access early** (sandbox lead time);
  auth email is now login-critical.
- **"Is it Jamie?"** Special-case his subscriber email → identity claim → sparring mode. Generalizes to
  a small trusted allowlist later.
- **Front-end.** Two-step auth flow + magic-link landing route; a "private mode" indicator. Design a
  route that accepts an auth context + a seeded prompt now — Phase A3 needs it.

### Phase A3 — Repurpose the Discord bridge → members broadcast
- **Retire** the request/response relay + conversation mirror. Dissolves the two problems with today's
  bridge: Discord user IDs have no link to subscriber emails (auth can't extend there), and public
  conversations feel wrong for a reflective personal tool.
- **New shape:** a one-way broadcast channel for Supporting Members where Thingy shares scheduled
  archive insights — an "on this week in 2019 you wrote…" moment, powered by the **temporal + theme work
  (Track B)**.
- **Each share carries a deep-link** to authenticated web Thingy with a predefined prompt to continue.
  The channel becomes a funnel toward the private interface, not a competitor.
- **Depends on** A1 + A2 + the temporal layer (B).

---

## Track B — Intelligence

A richer semantic index spanning the published corpora powers all of this. It makes both the public
docent and the private sparring partner sharper.

### Cross-corpus thematic threading
Thingy navigates distinct corpora — the Weekly Thing newsletter (curated, subscriber-facing), the
thingelstad.com blog (exploratory), and Another Thing podcast transcripts (spoken/audio-native).
**Keep them distinct** — different voices, rhythms, purposes; don't blend them in a way that makes any
source worse. Threading **connects without merging**: surface how an idea explored on the blog in 2019
resurfaces in a newsletter essay in 2024, or gets talked through in Another Thing — tracing the arc of
the thinking across sources without flattening them into one thing.

### Semantic clustering around persistent themes
Same underlying index. Map the throughlines (Web3, IndieWeb values, agentic systems, the book-club lens)
as interconnected ideas rather than scattered mentions, so Thingy can answer *"what has Jamie actually
been thinking about for a decade?"*

### Drop the corpus checkboxes
Remove the user-facing scope toggle — something smart enough shouldn't need it. Make Thingy
**authoritative** about which corpus to pull from, drawing on the best of both, with prompt nudges that
honor explicit constraints ("on the blog", "in the newsletter"). **Crucially, the corpus-distinction
metadata stays in the index** even as the toggle goes away — that's what lets Thingy respect constraints
and preserve the two voices. (Front-end: the scope selector stays in Phase A1's port and is removed when
authoritative selection ships.)

---

## The temporal layer (Track B's keystone — and a standalone asset)

A layer that knows not just *when* something was written, but *what was happening* in Jamie's life,
work, and the world at that moment — so when Thingy surfaces a piece it can color it with context
("written during the Agentic Transformation ramp-up at SPS", "the week you got back from Switzerland").

**How it exists.** It lives across the corpora but is **anchored to time, not to any one corpus**. You
mark a moment; any piece from any corpus written in that window gets enriched by it. The corpora don't
cross-reference each other — they all just get richer from understanding the moment.

**Granularity.** Big life events (marriages, births, board appointments), annual rhythms (Olson Family
Vacation, book-club cadence, escape-room spurts), and professional cycles (SPS initiatives, Minnebar,
newsletter milestones).

**A timeline of your life, valuable on its own.** Independent of Thingy, this is a map of the seasons of
your life — fitting the IndieWeb instinct to own your own timeline. Triple-value: it enriches Thingy,
it's a standalone owned asset, and forward-filling it makes it a **planning artifact**, not just a
record.

**Build & maintain.**
- **Retrospective scaffolding:** derive a draft year-file per year *from the corpus* (life/work/travel/
  thematic signals from what you actually wrote), then augment by hand — the corpus means you're not
  starting from scratch.
- **Format:** plain markdown, **one file per year** (`data/timeline/{year}.md` in Studio). All entries
  **private for now** (possibly-published later only if it proves useful).
- **Decoupled implementation:** generating and refining the markdown files is its own **immediate
  track**; Thingy consumption comes later and separately.

---

## How the tracks converge

The two tracks meet at **two points**:

1. **The private sparring partner** is where identity (A) and intelligence (B) fuse. Identity gates the
   mode; intelligence supplies the material. The hard questions only work because of Track B:
   - *"Where am I contradicting myself?"* → cross-corpus threading + temporal context.
   - *"What theme am I avoiding?"* → theme clustering pointed inward.
   - *"What should I be writing about but aren't?"* → gaps across the mapped throughlines.

   Private mode is what makes the Track B work pay off for *Jamie*, not just for readers.

2. **The members broadcast (A3)** needs the standalone web app (A1) + auth deep-links (A2) + the temporal
   layer (B) — and it funnels members from an ambient public-to-members channel into the private,
   authenticated dialog.

## Sequencing

- **Temporal layer (B): start now.** Decoupled by design, the corpus to derive it from already exists in
  Studio, and it's the dependency that unblocks A3. Highest-leverage immediate move.
- **Standalone web Thingy (A1):** the surface foundation; independent of the migration cutover.
- **Identity (A2):** backend-led; unlocks the sparring partner and authenticated deep-links.
- **Authoritative corpus selection + threading/clustering (B):** index work; ships the checkbox removal.
- **Bridge broadcast (A3):** last — it depends on A1, A2, and the temporal layer.

## Open decisions

1. **Sequencing** — recommend A1 + the temporal layer in parallel as the two immediate tracks. (Confirm.)
2. **DKIM subdomain** for the SES sender.
3. **Verified-Jamie corpus scope** — decided: yes, sparring Thingy reads private blog drafts, enforced by
   the index `visibility` partition (drafts never reach the public docent). Interface decided: a private,
   owner-gated Studio Discord channel.
4. **Timeline granularity & privacy** — confirm the year-file shape on a prototype year before scaling to 20.
