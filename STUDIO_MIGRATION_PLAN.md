# Studio Migration — Plan & Claude Code Brief

Splitting the overloaded `weekly.thingelstad.com` monorepo into a **brain** (Studio)
and a set of **surfaces** (newsletter, blog, podcast, Thingy). This doc is both the
architecture record and the brief to drive Claude Code through the migration safely.

---

## TL;DR — can I do this in one evening?

- **Full production cutover: no.** This system publishes weekly and has *no recovery
  flow* — a botched cutover before send day means a skipped week. Don't rush it.
- **A zero-risk evening that de-risks everything: yes.** Tonight you can write the
  docs, scaffold the new repos, and do a *history-preserving extraction in parallel*,
  without touching the live publishing path. The scary part (cutover) becomes a series
  of small, verifiable steps you do later — ideally right after a successful send.

---

## Target architecture

One brain, several surfaces. The rule that decides where anything goes:

> **If it's a publishing surface, it's its own repo/host, downstream. If it's upstream
> of publishing — capture, research, the editorial source of truth, production, or the
> staff — it lives in Studio.**

| Repo / host | Role | Class |
|---|---|---|
| **Studio** (new) | Brain: authoring staff (Eddy/Linky/Marky/Patty), production pipeline, `data/issues` + `data/episodes` source of truth, corpus, **Librarian API** | hub |
| **thingelstad.com** | Blog on Micro.blog | publish surface (no repo) |
| **another.thingelstad.com** | Podcast, custom site | publish surface (own repo, unchanged) |
| **weekly.thingelstad.com** | Newsletter site (11ty) + audio links | publish surface (own repo, **secret-free**) |
| **thingy.thingelstad.com** (new) | Thingy web UI + Discord bridge | **query surface** (own repo) |

**Two classes of surface:**
- *Publishing surfaces* (blog, newsletter, podcast) consume **static artifacts** — committed
  files and feeds. No live dependency on Studio.
- *Query surface* (Thingy) is a **live client** of the Librarian API at runtime. This is the
  first surface that depends on the brain being up, across a repo boundary — which makes the
  **Librarian API a versioned contract**, not just an internal function.

---

## Guiding principles for the migration

1. **Strangler / parallel-run.** Build the new alongside the old. Delete from `weekly`
   only after the new path is verified end-to-end.
2. **Preserve git history.** Use `git filter-repo` to extract subtrees into the new repos —
   never copy-paste. History and blame survive.
3. **Verification gate between every phase.** Don't start the next phase until the current
   one is proven.
4. **Time the cutover right after a successful send.** No recovery flow = full-week buffer.
5. **Secrets: add to the new home before removing from the old.** Never leave a window with
   no working publisher.

---

## Phases

### Phase 0 — tonight (zero production risk)
- Write this doc + a founding `README.md`/`CLAUDE.md` into the new repos.
- Create empty private repos: `studio`, `thingy`.
- Inventory the current repo and produce an exact **move-map** (which paths → Studio, which →
  Thingy, which stay in weekly).
- History-preserving extraction into `studio` and `thingy` **on branches / new repos** —
  the live `weekly` repo and its publishing path are untouched.
- Nothing is deleted from `weekly`. Nothing is deployed. Parallel existence only.

### Phase 1 — stand Studio up in parallel (low risk)
- Studio CI: stats → audio → archive build → corpus → Librarian deploy → status.
- **Add** secrets to Studio (`BUTTONDOWN_API_KEY`, `STRIPE_API_KEY`, `OPENAI_API_KEY`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Leave them in `weekly` for now.
- Studio produces the generated 11ty inputs and **pushes them to the `weekly` repo** via the
  GitHub Git Data API — the *same* commit mechanism workshop_bot already uses, just retargeted.
- Run both paths in parallel for a cycle and **diff the artifacts** Studio pushes vs. what the
  old path produced. They should match byte-for-byte.

### Phase 2 — cutover (do this right after a successful send)
- Flip workshop_bot's commit target to the `weekly` repo (generated inputs only); canonical
  `data/issues` now lives in Studio.
- Slim `weekly`: remove the migrated code, the production steps from `deploy.yml`, and the
  secrets. `weekly`'s workflow shrinks to *receive content → 11ty + Pagefind → deploy*.
- Verify a full publish cycle end-to-end.

### Phase 3 — promote Thingy (independent, additive — no migration risk)
- DNS: `thingy.thingelstad.com`.
- Deploy the Thingy front-end + Discord bridge from the `thingy` repo against the Librarian API.
- **Version `/retrieve`** and treat it as a stable contract (an external repo now depends on it).

### Phase 4 — new features (independent, additive)
- Blog draft → **Micropub** publish pipeline (`post-status: draft`, category tag for syndication).
- `data/episodes/{N}/` audio-native source contract for Another Thing.
- Ingest podcast transcripts into the corpus → Thingy becomes universal over all content.

> Phases 3 and 4 are purely additive and carry **no migration risk** — they can happen anytime,
> even before the full cutover.

---

## Paste this into Claude Code (Phase 0 only)

```
We are splitting this monorepo into a "Studio" brain repo and surface repos, per
STUDIO_MIGRATION_PLAN.md in this repo. Read that plan first.

Tonight is PHASE 0 ONLY. Hard constraints:
- Do NOT modify the live publishing path. Do NOT touch deploy.yml's behavior.
- Do NOT delete anything from this (weekly) repo.
- Do NOT deploy anything or move secrets.

Tasks:
1. Inventory this repo and produce a MOVE-MAP table: for every top-level app/dir,
   state its destination (Studio / Thingy / stays in weekly) and a one-line reason.
   Confirm the exact paths for: workshop_bot, librarian, thingy_bridge, the pipeline,
   data/issues, data/audio, blog drafts, and the Thingy web front-end.
2. Show me the move-map and STOP for my approval before any extraction.
3. After I approve, use `git filter-repo` (history-preserving) to produce two new repos
   locally — `studio` and `thingy` — containing only their mapped paths. Leave this repo
   untouched. Do not push until I've inspected them.
4. Draft a founding README.md + CLAUDE.md for the Studio repo from the architecture
   section of the plan.

Work in small steps and pause at each gate. Ask before anything destructive.
```

---

## Move-map starting point (confirm exact sub-paths during inventory)

| Component (current) | Destination | Notes |
|---|---|---|
| `apps/workshop_bot/` | **Studio** | Becomes the Studio core; rename Workshop → Studio |
| `apps/librarian/` | **Studio** | Librarian API + corpus tooling; deployed from Studio |
| `apps/thingy_bridge/` | **Thingy** | Query surface; keep it a separate *process* |
| Thingy web front-end (`weekly/thingy`) | **Thingy** | New subdomain `thingy.thingelstad.com` |
| `pipeline/` | **Studio** | Production: build, stats, status, audio |
| `data/issues/` | **Studio** | Editorial source of truth |
| `data/episodes/` (new) | **Studio** | Podcast audio-native source |
| Blog drafts | **Studio** | Feeds the Micropub publish pipeline |
| `apps/site/` (11ty) | **stays in weekly** | Pure render surface |
| Generated `archive/*.md`, `_data/*.json` | **stays in weekly** | Pushed in by Studio |

---

## Risks & blind spots

- **No recovery flow.** The single biggest constraint. Sequence the cutover for the day after a
  send, never before one.
- **Secrets gap.** Add-then-remove, never remove-then-add. A window with no valid key = a missed send.
- **The content handoff is the crux.** Phase 1's artifact diff is the most important test in the
  whole migration — if Studio's pushed inputs match the old path exactly, cutover is safe.
- **Thingy's live dependency.** Once `thingy.thingelstad.com` is a separate repo calling the
  Librarian API, casual changes to `/retrieve` break it. Version the contract before Phase 3.
- **Don't over-split.** Librarian stays in Studio for now. Extract it to its own repo *only* if it
  later needs independent scaling or a second backend — keep the API clean so that's a non-event.
