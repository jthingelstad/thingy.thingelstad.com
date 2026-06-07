"""``thingy-watch`` + the ``/thingy …`` reads.

Jamie can't see what readers ask the public archive agent (Thingy) — it
lives in a Lambda, conversations only in DynamoDB. This module gives him a
window:

- ``watch(ctx)`` — the hourly job. Pulls logged conversation turns from
  the Lambda (``thingy_client.fetch_conversations`` → the auth endpoint's
  ``list_conversations`` action), groups them into conversations (same
  reader, turns within ~30 min / a fresh browser history), runs a
  one-shot Sonnet two-sided assessment of each *new* one, mirrors it into
  ``thingy_conversations`` (a stable local id that outlives the Lambda's
  ~60-day TTL), and posts a card to ``#chatter``. PASSes silently when
  there's nothing new. Manual re-fire = ``/thingy sync``.
- ``recent(ctx, count)`` — the last N mirrored conversations, one line each.
- ``show(ctx, conv_id)`` — one conversation: the card + the full transcript
  (returned as ``data['transcript_md']`` for the command to attach as a file).

The reader is shown as ``reader·<hash6>`` — the logged ``subscriber_hash``
is a SHA256 of their email, never the email itself; the short label is
stable per person but not reversible.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import discord

from ..tools import anthropic_client, db, thingy_client
from . import _base

logger = logging.getLogger("thingy_bridge.jobs.watch")

NAME = "thingy-watch"

_LOCAL_TZ = ZoneInfo("America/Chicago")
_GAP = timedelta(minutes=30)            # turns farther apart than this → separate conversations
_REFETCH_OVERLAP = timedelta(minutes=120)  # re-pull this far before the watermark (dedup handles it)
_FIRST_RUN_LOOKBACK = timedelta(days=7)
_FETCH_LIMIT = 250
_MAX_CONVOS_PER_RUN = 25                # drain a backlog over a few hourly runs rather than all at once
_MAX_CARDS_PER_RUN = 6
_ASSESS_MAX_TOKENS = 900


# ---------- small helpers ----------

def _parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _anon(subscriber_hash: Any) -> str:
    h = str(subscriber_hash or "").strip()
    return f"reader·{h[:6]}" if h else "reader·anon"


def _when(iso: Any) -> str:
    dt = _parse_iso(iso)
    if dt is None:
        return str(iso or "?")
    local = dt.astimezone(_LOCAL_TZ)
    hour12 = local.hour % 12 or 12
    ampm = "AM" if local.hour < 12 else "PM"
    return f"{local.strftime('%b')} {local.day}, {hour12}:{local.minute:02d} {ampm} CT"


_FEEDBACK_EMOJI = {"up": "👍", "down": "👎", "mixed": "👍/👎"}


def _feedback_rollup(turns: list[dict]) -> Optional[str]:
    reacts = {str(t.get("feedback_reaction")).strip() for t in turns if t.get("feedback_reaction")}
    reacts.discard("")
    reacts.discard("None")
    if not reacts:
        return None
    if reacts == {"up"}:
        return "up"
    if reacts == {"down"}:
        return "down"
    return "mixed"


def _source_issues(turns: list[dict]) -> list[str]:
    out: list[str] = []
    for t in turns:
        for n in t.get("source_issues") or []:
            n = str(n).strip()
            if n and n not in out:
                out.append(n)
        for c in t.get("citations") or []:
            n = str(c.get("issue_number") or "").strip()
            if n and n not in out:
                out.append(n)
        for n in _inline_issue_refs(t.get("answer")):
            if n not in out:
                out.append(n)
    return out


def _wt_list(issues: list[str]) -> str:
    return ", ".join(f"WT{n}" for n in issues) if issues else "—"


_INLINE_WT_RE = re.compile(r"(?:WT|#)(\d{1,5})\b")


def _inline_issue_refs(text: Any) -> list[str]:
    out: list[str] = []
    for match in _INLINE_WT_RE.finditer(str(text or "")):
        n = match.group(1)
        if n not in out:
            out.append(n)
    return out


def _turn_preflight(t: dict) -> dict:
    value = t.get("preflight")
    return value if isinstance(value, dict) else {}


def _preflight_label(preflight: dict) -> str:
    action = str(preflight.get("action") or "").strip()
    category = str(preflight.get("category") or "").strip()
    if not action and not category:
        return ""
    if action == "pass" and category in {"", "archive_answer"}:
        return ""
    if action and category:
        return f"{category}/{action}"
    return category or action


def _preflight_rollup(turns: list[dict]) -> list[str]:
    out: list[str] = []
    for t in turns:
        label = _preflight_label(_turn_preflight(t))
        if label and label not in out:
            out.append(label)
    return out


def _build_transcript(turns: list[dict]) -> list[dict]:
    keep = ("request_id", "conversation_id", "created_at", "question", "answer", "citations",
            "source_issues", "feedback_reaction", "feedback_at", "history_count",
            "preflight")
    return [{k: t.get(k) for k in keep} for t in turns]


# ---------- grouping ----------

def _group_legacy_turns(turns: list[dict]) -> list[list[dict]]:
    by_sub: dict[str, list[dict]] = {}
    for t in sorted(turns, key=lambda x: str(x.get("created_at") or "")):
        by_sub.setdefault(str(t.get("subscriber_hash") or ""), []).append(t)

    convos: list[list[dict]] = []
    for sub, ts in by_sub.items():
        current: list[dict] = []
        prev_dt: Optional[datetime] = None
        for i, t in enumerate(ts):
            dt = _parse_iso(t.get("created_at"))
            fresh_history = i > 0 and int(t.get("history_count") or 0) == 0
            too_far = prev_dt is not None and dt is not None and (dt - prev_dt) > _GAP
            if current and (fresh_history or too_far):
                convos.append(current)
                current = []
            current.append(t)
            prev_dt = dt
        if current:
            convos.append(current)
    convos.sort(key=lambda c: str(c[-1].get("created_at") or ""))
    return convos


def group_into_conversations(turns: list[dict]) -> list[list[dict]]:
    """Group logged turns into conversations.

    Prefer the API's canonical server-side ``conversation_id``. The old
    same-reader/time-window heuristic remains only for legacy flat rows.
    """
    canonical: dict[tuple[str, str], list[dict]] = {}
    legacy: list[dict] = []
    for turn in sorted(turns, key=lambda x: str(x.get("created_at") or "")):
        conversation_id = str(turn.get("conversation_id") or "").strip()
        if conversation_id:
            subscriber = str(turn.get("subscriber_hash") or "")
            canonical.setdefault((subscriber, conversation_id), []).append(turn)
        else:
            legacy.append(turn)
    convos = [*canonical.values(), *_group_legacy_turns(legacy)]
    convos.sort(key=lambda c: str(c[-1].get("created_at") or ""))
    return convos


# ---------- assessment (one-shot Sonnet) ----------

def _transcript_for_prompt(turns: list[dict]) -> str:
    lines: list[str] = []
    for i, t in enumerate(turns, 1):
        q = str(t.get("question") or "").strip()
        a = str(t.get("answer") or "").strip()
        cites = ", ".join(f"WT{c.get('issue_number')}" for c in (t.get("citations") or []) if c.get("issue_number"))
        preflight = _turn_preflight(t)
        metadata_line = ""
        label = _preflight_label(preflight)
        if label:
            bits = [label]
            if preflight.get("rewritten_question"):
                bits.append(f"rewrote to: {preflight['rewritten_question']}")
            if preflight.get("rationale"):
                bits.append(f"reason: {preflight['rationale']}")
            metadata_line = "\n\nOperator metadata, not shown to reader: preflight " + " · ".join(bits)
        lines.append(f"### Turn {i}\nReader: {q}\n\nThingy: {a}" + (f"\n\nThingy cited: {cites}" if cites else "") + metadata_line)
    return "\n\n".join(lines)


_JSON_PAYLOAD_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_payload(reply: str) -> Optional[dict[str, Any]]:
    """Extract and parse the first JSON object in ``reply`` (the model is
    asked to return only JSON; tolerate code fences / surrounding prose).
    Inlined from workshop_bot's ``_compose.parse_json_payload`` — the
    bridge has no other JSON-payload jobs, so a shared helper would be
    overkill."""
    if not reply:
        return None
    m = _JSON_PAYLOAD_RE.search(reply)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _bounded_list(value: Any, *, limit: int = 6, item_chars: int = 80) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            out.append(text[:item_chars])
        if len(out) >= limit:
            break
    return out


def _parse_assessment(reply: str) -> Optional[dict[str, Any]]:
    """Project the model's JSON reply down to stable human + eval fields."""
    data = _parse_json_payload(reply)
    if data is None:
        return None
    out: dict[str, Any] = {}
    for k in ("topic", "reader", "thingy", "takeaway"):
        v = data.get(k)
        out[k] = str(v).strip() if v is not None else ""
    quality = str(data.get("quality") or "").strip().lower()
    out["quality"] = quality if quality in {"clean", "watch", "problem"} else ""
    out["flags"] = _bounded_list(data.get("flags"))
    out["improvements"] = _bounded_list(data.get("improvements"), limit=4, item_chars=160)
    return out if any(out.values()) else None


def _fallback_assessment(turns: list[dict]) -> dict[str, Any]:
    first_q = next((str(t.get("question") or "").strip() for t in turns if t.get("question")), "")
    topic = (first_q[:60] + "…") if len(first_q) > 60 else (first_q or "(no question text)")
    return {
        "topic": topic,
        "reader": "(assessment unavailable — the review model didn't return a usable response)",
        "thingy": "",
        "takeaway": "",
        "quality": "watch",
        "flags": ["review_unavailable"],
        "improvements": [],
    }


def _sync_assess(prompt: str, user_msg: str) -> Optional[str]:
    client = anthropic_client.client()
    resp = client.messages.create(
        model=anthropic_client.MODELS["sonnet"],
        max_tokens=_ASSESS_MAX_TOKENS,
        system=prompt,
        messages=[{"role": "user", "content": user_msg}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


async def _assess(turns: list[dict]) -> dict[str, Any]:
    try:
        base = anthropic_client.load_prompt("review-conversation")
    except Exception:  # noqa: BLE001
        logger.warning("thingy-watch: review-conversation prompt missing")
        return _fallback_assessment(turns)
    user_msg = "Here is the conversation to assess:\n\n" + _transcript_for_prompt(turns)
    try:
        reply = await asyncio.to_thread(_sync_assess, base, user_msg)
    except Exception as exc:  # noqa: BLE001
        logger.warning("thingy-watch: assessment call failed: %s", exc)
        return _fallback_assessment(turns)
    parsed = _parse_assessment(reply or "")
    if parsed is None:
        logger.warning("thingy-watch: couldn't parse assessment JSON")
        return _fallback_assessment(turns)
    # backfill a topic if the model left it blank
    if not parsed.get("topic"):
        parsed["topic"] = _fallback_assessment(turns)["topic"]
    return parsed


def _assessment_md(a: dict[str, Any]) -> str:
    bits = []
    if a.get("reader"):
        bits.append(f"**Reader:** {a['reader']}")
    if a.get("thingy"):
        bits.append(f"**Thingy:** {a['thingy']}")
    if a.get("takeaway"):
        bits.append(f"**Takeaway:** {a['takeaway']}")
    flags = a.get("flags") if isinstance(a.get("flags"), list) else []
    if flags:
        bits.append(f"**Eval flags:** {', '.join(str(flag) for flag in flags)}")
    return "\n".join(bits)


# ---------- rendering ----------

def _card(conv: dict, *, for_show: bool = False) -> str:
    fb = _FEEDBACK_EMOJI.get(conv.get("feedback") or "", "")
    preflight_labels = conv.get("preflight_labels") or _preflight_rollup(conv.get("transcript") or [])
    head = (
        f"**Thingy · #{conv['id']}** · {_when(conv.get('started_at'))} · {_anon(conv.get('subscriber_hash'))}"
        f" · {conv.get('turn_count')} turn{'s' if conv.get('turn_count') != 1 else ''}"
        + (f" · {fb}" if fb else "")
    )
    parts = [head]
    if conv.get("topic"):
        parts.append(f"**Topic:** {conv['topic']}")
    if conv.get("assessment_md"):
        parts.append(conv["assessment_md"])
    if preflight_labels:
        parts.append(f"**Preflight:** {', '.join(preflight_labels)}")
    issues = conv.get("source_issues") or []
    tail = f"Sources: {_wt_list(issues)}"
    if for_show:
        tail += "  ·  full transcript attached"
    else:
        tail += f"  ·  `/thingy show {conv['id']}` for the transcript"
    parts.append(tail)
    return "\n".join(parts)


def _transcript_md(conv: dict) -> str:
    lines = [
        f"# Thingy conversation #{conv['id']}",
        "",
        f"- Reader: {_anon(conv.get('subscriber_hash'))} (`{conv.get('subscriber_hash')}`)",
        f"- When: {_when(conv.get('started_at'))} → {_when(conv.get('ended_at'))}",
        f"- Turns: {conv.get('turn_count')}",
        f"- Feedback: {conv.get('feedback') or '—'}",
        f"- Sources cited: {_wt_list(conv.get('source_issues') or [])}",
    ]
    if conv.get("topic"):
        lines.append(f"- Topic: {conv['topic']}")
    preflight_labels = conv.get("preflight_labels") or _preflight_rollup(conv.get("transcript") or [])
    if preflight_labels:
        lines.append(f"- Preflight: {', '.join(preflight_labels)}")
    lines.append("")
    if conv.get("assessment_md"):
        lines += ["## Assessment (Eddy)", "", conv["assessment_md"].replace("**", "**"), ""]
    lines.append("## Transcript")
    lines.append("")
    for i, t in enumerate(conv.get("transcript") or [], 1):
        when = _when(t.get("created_at"))
        cites = [c for c in (t.get("citations") or []) if c.get("issue_number")]
        lines.append(f"### Turn {i} — {when}")
        lines.append("")
        lines.append(f"**Reader:** {str(t.get('question') or '').strip()}")
        lines.append("")
        lines.append(f"**Thingy:** {str(t.get('answer') or '').strip()}")
        preflight = _turn_preflight(t)
        label = _preflight_label(preflight)
        if label:
            lines.append("")
            lines.append("**Preflight:**")
            lines.append(f"- Classification: {label}")
            if preflight.get("rewritten_question"):
                lines.append(f"- Rewritten question: {preflight['rewritten_question']}")
            if preflight.get("answer_guidance"):
                lines.append(f"- Answer guidance: {preflight['answer_guidance']}")
            if preflight.get("rationale"):
                lines.append(f"- Rationale: {preflight['rationale']}")
        if cites:
            lines.append("")
            cite_strs = []
            for c in cites:
                u = c.get("url")
                s = f"WT{c.get('issue_number')}"
                if c.get("subject"):
                    s += f" — {c['subject']}"
                if u:
                    s += f" ({u})"
                cite_strs.append(s)
            lines.append("_Cited: " + "; ".join(cite_strs) + "_")
        if t.get("feedback_reaction"):
            lines.append("")
            lines.append(f"_Reader feedback: {t['feedback_reaction']}_")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------- the hourly job ----------

async def watch(ctx: "_base.JobContext") -> "_base.JobResult":
    # Whole-job lock so a slow cron run (one slow Lambda call + LLM
    # assessment per conversation can push past the hour) can't overlap
    # with the next scheduled fire or a manual `/thingy sync`.
    # Without it both instances would pay for LLM assessments on the
    # same convos — DB inserts are idempotent on turn request ids, so
    # only one card lands per convo, but the cost is real.
    try:
        with _base.job_lock([f"job:{NAME}"], NAME):
            return await _watch_locked(ctx)
    except _base.JobLocked as exc:
        logger.info("thingy-watch: skipping — already running (%s)", exc.holder_desc)
        return _base.JobResult(
            True, f"thingy-watch already running ({exc.holder_desc}); skipped.",
        )


async def _try_post_card(ctx: "_base.JobContext", conv_row: dict) -> bool:
    """Post one conversation card to ``#chatter``.

    Returns True on a successful send. Any :class:`discord.DiscordException`
    (Forbidden 50001 when the Thingy bot isn't in ``#chatter``, NotFound
    if the channel is deleted, transient rate-limit / server error) is
    caught and logged — the conversation row is the durable receipt;
    the unposted card is picked up by the orphan backfill at the top
    of the next :func:`_watch_locked` run.
    """
    try:
        return await ctx.post(
            "DISCORD_CHANNEL_CHATTER", _card(conv_row), persona="thingy",
        )
    except discord.DiscordException as exc:
        logger.warning(
            "thingy-watch: couldn't post card for conversation #%s — %s; "
            "will retry next run",
            conv_row.get("id"), exc,
        )
        return False


async def _watch_locked(ctx: "_base.JobContext") -> "_base.JobResult":
    # 1) Orphan backfill — conversations whose post failed on a previous
    #    run (e.g. the bot wasn't yet in #chatter). Capped at the same
    #    per-run budget as new cards so a
    #    long backlog drains over a few hours instead of flooding the
    #    channel in one burst.
    posted = 0
    backfilled = 0
    orphans = db.unposted_thingy_conversations(limit=_MAX_CARDS_PER_RUN * 4)
    for orphan in orphans:
        if posted >= _MAX_CARDS_PER_RUN:
            break
        if await _try_post_card(ctx, orphan):
            db.mark_thingy_conversation_posted(orphan["id"])
            posted += 1
            backfilled += 1
        else:
            # The failure is almost certainly structural (channel still
            # not accessible); don't burn the rest of the budget — let
            # the next run retry. We still proceed to ingest new turns
            # below so the local DB stays current.
            break

    # 2) Pull canonical server-side conversations from the Lambda and
    #    review only new/changed conversation ids. The API owns grouping
    #    and transcript history; the bridge owns review/posting state.
    watermark = db.latest_thingy_conversation_end()
    wm_dt = _parse_iso(watermark)
    if wm_dt is not None:
        since_dt = wm_dt - _REFETCH_OVERLAP
    else:
        since_dt = datetime.now(timezone.utc) - _FIRST_RUN_LOOKBACK
    since_iso = since_dt.astimezone(timezone.utc).isoformat()

    try:
        summaries = await thingy_client.fetch_operator_conversations(since_iso=since_iso, limit=_FETCH_LIMIT)
    except thingy_client.ThingyError as exc:
        return _base.JobResult(False, f"❌ thingy-watch: couldn't read the canonical conversation index — {exc}")

    candidates: list[dict] = []
    for summary in summaries:
        remote_id = str(summary.get("conversation_id") or summary.get("id") or "").strip()
        if not remote_id:
            continue
        existing = db.get_thingy_conversation_by_remote_id(remote_id)
        updated_at = str(summary.get("updated_at") or summary.get("last_message_at") or "")
        if existing and str(existing.get("ended_at") or "") == updated_at and int(existing.get("turn_count") or 0) == int(summary.get("turn_count") or 0):
            continue
        candidates.append(summary)

    stored = 0
    overflow = 0
    if candidates:
        overflow = max(0, len(candidates) - _MAX_CONVOS_PER_RUN)
        candidates = candidates[:_MAX_CONVOS_PER_RUN]  # drain the rest next run
        for summary in candidates:
            remote_id = str(summary.get("conversation_id") or summary.get("id") or "").strip()
            try:
                full = await thingy_client.fetch_operator_conversation(
                    conversation_id=remote_id,
                    subscriber_hash=str(summary.get("subscriber_hash") or ""),
                )
            except thingy_client.ThingyError as exc:
                logger.warning("thingy-watch: couldn't fetch canonical conversation %s — %s", remote_id, exc)
                continue
            conversation = full.get("conversation") or summary
            turns_in_convo = [t for t in (full.get("turns") or []) if str(t.get("question") or "").strip()]
            if not turns_in_convo:
                continue
            subscriber_hash = str(conversation.get("subscriber_hash") or summary.get("subscriber_hash") or "")
            for turn in turns_in_convo:
                turn.setdefault("conversation_id", remote_id)
            assess = await _assess(turns_in_convo)
            issues = _source_issues(turns_in_convo)
            preflight_labels = _preflight_rollup(turns_in_convo)
            feedback = _feedback_rollup(turns_in_convo)
            conv_id, changed = db.upsert_thingy_conversation(
                remote_conversation_id=remote_id,
                subscriber_hash=subscriber_hash,
                started_at=str(conversation.get("created_at") or turns_in_convo[0].get("created_at") or ""),
                ended_at=str(conversation.get("updated_at") or conversation.get("last_message_at") or turns_in_convo[-1].get("created_at") or ""),
                turn_count=len(turns_in_convo),
                transcript=[],
                turn_request_ids=[str(t.get("request_id")) for t in turns_in_convo if t.get("request_id")],
                source_issues=issues,
                feedback=feedback,
                topic=assess.get("topic") or None,
                assessment_md=_assessment_md(assess) or None,
                assessment_json=assess,
            )
            if not changed:
                continue
            stored += 1
            if posted < _MAX_CARDS_PER_RUN:
                conv_row = {
                    "id": conv_id,
                    "remote_conversation_id": remote_id,
                    "subscriber_hash": subscriber_hash,
                    "started_at": conversation.get("created_at") or turns_in_convo[0].get("created_at"),
                    "ended_at": conversation.get("updated_at") or conversation.get("last_message_at") or turns_in_convo[-1].get("created_at"),
                    "turn_count": len(turns_in_convo), "feedback": feedback,
                    "topic": assess.get("topic"), "assessment_md": _assessment_md(assess),
                    "assessment": assess,
                    "source_issues": issues, "preflight_labels": preflight_labels,
                }
                if await _try_post_card(ctx, conv_row):
                    db.mark_thingy_conversation_posted(conv_id)
                    posted += 1

    # Nothing at all to report — silent PASS, same as the old behaviour.
    if posted == 0 and stored == 0 and not orphans:
        return _base.JobResult(True, "(thingy-watch: no new conversations)")

    # Tail message — derived from counters (orphans-not-backfilled +
    # new-convos-not-posted + overflow-not-even-ingested). Only post the
    # tail if at least one card landed; if posted == 0 the channel is
    # unreachable and the next run will catch up.
    remaining = (len(orphans) - backfilled) + (stored - (posted - backfilled)) + overflow
    if posted > 0 and remaining > 0:
        try:
            await ctx.post(
                "DISCORD_CHANNEL_CHATTER",
                f"…and **{remaining}** more pending — `/thingy recent`.",
                persona="thingy",
            )
        except discord.DiscordException as exc:
            logger.warning("thingy-watch: couldn't post tail summary — %s", exc)

    note_parts = []
    if backfilled:
        note_parts.append(f"{backfilled} backfilled")
    if stored:
        note_parts.append(f"{stored} new reviewed")
    note_parts.append(f"{posted} card{'s' if posted != 1 else ''} posted to #chatter")
    if remaining:
        note_parts.append(f"{remaining} still pending")
    if overflow:
        note_parts.append(f"{overflow} deferred to the next run")
    return _base.JobResult(
        True,
        "thingy-watch: " + "; ".join(note_parts) + ".",
        data={"stored": stored, "posted": posted, "backfilled": backfilled},
    )


# ---------- /thingy reads ----------

def _recent_line(c: dict) -> str:
    fb = _FEEDBACK_EMOJI.get(c.get("feedback") or "", "")
    topic = (c.get("topic") or "—").strip()
    preflight = _preflight_rollup(c.get("transcript") or [])
    assessment = c.get("assessment") if isinstance(c.get("assessment"), dict) else {}
    flags = assessment.get("flags") if isinstance(assessment.get("flags"), list) else []
    return (
        f"`#{c['id']}` · {_when(c.get('started_at'))} · {_anon(c.get('subscriber_hash'))}"
        f" · {c.get('turn_count')}t" + (f" {fb}" if fb else "")
        + f" · \"{topic}\"" + (f" · {_wt_list(c.get('source_issues') or [])}" if c.get('source_issues') else "")
        + (f" · preflight: {', '.join(preflight)}" if preflight else "")
        + (f" · flags: {', '.join(str(flag) for flag in flags)}" if flags else "")
    )


async def recent(ctx: "_base.JobContext", *, count: int = 8) -> "_base.JobResult":
    count = max(1, min(int(count or 8), 25))
    rows = db.recent_thingy_conversations(count)
    if not rows:
        return _base.JobResult(
            True,
            "No Thingy conversations reviewed yet. The hourly `thingy-watch` will fill this in "
            "as readers chat — or run `/thingy sync` to pull now.",
        )
    lines = [f"**Recent Thingy conversations** (last {len(rows)}):"]
    lines += [_recent_line(c) for c in rows]
    lines.append("`/thingy show <id>` for the assessment + full transcript.")
    return _base.JobResult(True, "\n".join(lines))


async def show(ctx: "_base.JobContext", *, conv_id: int) -> "_base.JobResult":
    conv = db.get_thingy_conversation(int(conv_id))
    if conv is None:
        return _base.JobResult(False, f"No reviewed Thingy conversation `#{conv_id}`. Try `/thingy recent`.")
    remote_id = str(conv.get("remote_conversation_id") or "").strip()
    if remote_id:
        try:
            full = await thingy_client.fetch_operator_conversation(
                conversation_id=remote_id,
                subscriber_hash=str(conv.get("subscriber_hash") or ""),
            )
            turns = full.get("turns") or []
            conversation = full.get("conversation") or {}
            conv = {
                **conv,
                "subscriber_hash": conversation.get("subscriber_hash") or conv.get("subscriber_hash"),
                "started_at": conversation.get("created_at") or conv.get("started_at"),
                "ended_at": conversation.get("updated_at") or conversation.get("last_message_at") or conv.get("ended_at"),
                "turn_count": len(turns) or conv.get("turn_count"),
                "transcript": _build_transcript(turns),
                "source_issues": _source_issues(turns) or conv.get("source_issues") or [],
                "feedback": _feedback_rollup(turns) or conv.get("feedback"),
            }
        except thingy_client.ThingyError as exc:
            logger.warning("thingy-show: couldn't fetch canonical conversation %s — %s", remote_id, exc)
    return _base.JobResult(
        True,
        _card(conv, for_show=True),
        data={"transcript_md": _transcript_md(conv), "filename": f"thingy-conversation-{conv_id}.md"},
    )
