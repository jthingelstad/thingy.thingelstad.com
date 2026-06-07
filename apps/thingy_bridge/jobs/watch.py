"""Thingy operator conversation views.

The API owns Thingy's server-side conversations, summaries, tool traces, and
background evals. Discord notifications are pushed directly by the API's
background evaluator webhook; the bridge only reads canonical records on demand:

- ``recent`` lists recent reviewed conversations from the API.
- ``show`` fetches one canonical transcript from the API and attaches it.

No local transcript mirror or local assessment layer lives here anymore.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from ..tools import thingy_client
from . import _base

_LOCAL_TZ = ZoneInfo("America/Chicago")
_LOOKBACK = timedelta(days=30)
_FEEDBACK_EMOJI = {"up": "👍", "down": "👎", "mixed": "👍/👎"}


def _parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _when(iso: Any) -> str:
    dt = _parse_iso(iso)
    if dt is None:
        return str(iso or "?")
    local = dt.astimezone(_LOCAL_TZ)
    hour12 = local.hour % 12 or 12
    ampm = "AM" if local.hour < 12 else "PM"
    return f"{local.strftime('%b')} {local.day}, {hour12}:{local.minute:02d} {ampm} CT"


def _anon(subscriber_hash: Any) -> str:
    h = str(subscriber_hash or "").strip()
    return f"reader·{h[:6]}" if h else "reader·anon"


def _conversation_id(c: dict[str, Any]) -> str:
    return str(c.get("conversation_id") or c.get("id") or "").strip()


def _feedback_rollup(turns: list[dict[str, Any]]) -> Optional[str]:
    reacts = {str(t.get("feedback_reaction")).strip() for t in turns if t.get("feedback_reaction")}
    reacts.discard("")
    if not reacts:
        return None
    if reacts == {"up"}:
        return "up"
    if reacts == {"down"}:
        return "down"
    return "mixed"


def _source_labels(turns: list[dict[str, Any]], limit: int = 12) -> list[str]:
    out: list[str] = []
    for t in turns:
        for c in t.get("citations") or []:
            label = ""
            if c.get("issue_number"):
                label = f"WT{c['issue_number']}"
            elif c.get("subject"):
                label = str(c["subject"])
            elif c.get("url"):
                label = str(c["url"])
            if label and label not in out:
                out.append(label)
            if len(out) >= limit:
                return out
    return out


def _assessment_md(c: dict[str, Any]) -> str:
    bits: list[str] = []
    if c.get("eval_reader"):
        bits.append(f"**Reader:** {c['eval_reader']}")
    if c.get("eval_thingy"):
        bits.append(f"**Thingy:** {c['eval_thingy']}")
    if c.get("eval_takeaway"):
        bits.append(f"**Takeaway:** {c['eval_takeaway']}")
    flags = c.get("eval_flags") if isinstance(c.get("eval_flags"), list) else []
    if flags:
        bits.append(f"**Eval flags:** {', '.join(str(flag) for flag in flags)}")
    improvements = c.get("eval_improvements") if isinstance(c.get("eval_improvements"), list) else []
    if improvements:
        bits.append("**Improvements:** " + "; ".join(str(item) for item in improvements))
    return "\n".join(bits)


def _card(c: dict[str, Any], *, for_show: bool = False, turns: Optional[list[dict[str, Any]]] = None) -> str:
    cid = _conversation_id(c)
    fb = _FEEDBACK_EMOJI.get(_feedback_rollup(turns or []) or "", "")
    quality = str(c.get("eval_quality") or "watch")
    head = (
        f"**Thingy · `{cid}`** · {_when(c.get('created_at'))} · {_anon(c.get('subscriber_hash'))}"
        f" · {c.get('turn_count')} turn{'s' if c.get('turn_count') != 1 else ''}"
        f" · {quality}"
        + (f" · {fb}" if fb else "")
    )
    parts = [head]
    topic = c.get("eval_topic") or c.get("topic") or c.get("title")
    if topic:
        parts.append(f"**Topic:** {topic}")
    assessment = _assessment_md(c)
    if assessment:
        parts.append(assessment)
    if turns is not None:
        labels = _source_labels(turns)
        parts.append(f"Sources: {', '.join(labels) if labels else '—'}")
    parts.append("full transcript attached" if for_show else f"`/thingy show id:{cid}` for the transcript")
    return "\n".join(parts)


def _transcript_md(c: dict[str, Any], turns: list[dict[str, Any]]) -> str:
    lines = [
        f"# Thingy conversation { _conversation_id(c) }",
        "",
        f"- Reader: {_anon(c.get('subscriber_hash'))} (`{c.get('subscriber_hash')}`)",
        f"- Created: {_when(c.get('created_at'))}",
        f"- Updated: {_when(c.get('updated_at') or c.get('last_message_at'))}",
        f"- Turns: {c.get('turn_count')}",
        f"- Quality: {c.get('eval_quality') or '—'}",
    ]
    if c.get("eval_topic"):
        lines.append(f"- Topic: {c['eval_topic']}")
    flags = c.get("eval_flags") if isinstance(c.get("eval_flags"), list) else []
    if flags:
        lines.append(f"- Eval flags: {', '.join(str(flag) for flag in flags)}")
    lines += ["", "## Assessment", "", _assessment_md(c) or "—", "", "## Transcript", ""]
    for i, t in enumerate(turns, 1):
        lines.append(f"### Turn {i} — {_when(t.get('created_at'))}")
        lines.append("")
        lines.append(f"**Reader:** {str(t.get('question') or '').strip()}")
        lines.append("")
        lines.append(f"**Thingy:** {str(t.get('answer') or '').strip()}")
        if t.get("feedback_reaction"):
            lines.append("")
            comment = f" — {t.get('feedback_comment')}" if t.get("feedback_comment") else ""
            lines.append(f"_Reader feedback: {t['feedback_reaction']}{comment}_")
        if t.get("preflight"):
            pf = t["preflight"]
            label = "/".join(str(pf.get(k) or "") for k in ("category", "action")).strip("/")
            if label:
                lines += ["", f"_Preflight: {label}_"]
        if t.get("tool_names"):
            lines += ["", "_Tools: " + ", ".join(str(x) for x in t.get("tool_names") or []) + "_"]
        cites = _source_labels([t])
        if cites:
            lines += ["", "_Cited: " + "; ".join(cites) + "_"]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _recent_line(c: dict[str, Any]) -> str:
    cid = _conversation_id(c)
    topic = c.get("eval_topic") or c.get("topic") or c.get("title") or "—"
    quality = c.get("eval_quality") or "watch"
    flags = c.get("eval_flags") if isinstance(c.get("eval_flags"), list) else []
    flag_text = f" · {', '.join(str(flag) for flag in flags[:3])}" if flags else ""
    return f"`{cid}` · {_when(c.get('updated_at') or c.get('created_at'))} · {quality}{flag_text} · {topic}"


async def recent(ctx: "_base.JobContext", *, count: int = 8) -> "_base.JobResult":
    del ctx
    count = max(1, min(int(count or 8), 25))
    since = (datetime.now(timezone.utc) - _LOOKBACK).isoformat()
    try:
        rows = await thingy_client.fetch_operator_conversations(
            since_iso=since,
            limit=count,
            eval_status="reviewed",
        )
    except thingy_client.ThingyError as exc:
        return _base.JobResult(False, f"❌ couldn't read reviewed Thingy conversations — {exc}")
    if not rows:
        return _base.JobResult(True, "No reviewed Thingy conversations in the recent window.")
    lines = ["**Recent reviewed Thingy conversations**", ""]
    lines += [_recent_line(row) for row in rows[-count:]]
    lines.append("Use `/thingy show id:<conversation_id>` for the assessment + full transcript.")
    return _base.JobResult(True, "\n".join(lines))


async def show(ctx: "_base.JobContext", *, conv_id: str) -> "_base.JobResult":
    del ctx
    conversation_id = str(conv_id or "").strip()
    if not conversation_id:
        return _base.JobResult(False, "Conversation id is required.")
    try:
        data = await thingy_client.fetch_operator_conversation(conversation_id=conversation_id)
    except thingy_client.ThingyError as exc:
        return _base.JobResult(False, f"❌ couldn't fetch Thingy conversation `{conversation_id}` — {exc}")
    conv = data.get("conversation") or {}
    turns = data.get("turns") or []
    md = _transcript_md(conv, turns)
    return _base.JobResult(
        True,
        _card(conv, for_show=True, turns=turns),
        data={
            "transcript_md": md,
            "filename": f"thingy-conversation-{conversation_id[:12]}.md",
        },
    )
