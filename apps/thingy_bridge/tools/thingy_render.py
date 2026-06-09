"""Transform the Librarian Lambda's chat output for Discord.

The Lambda streams plain-prose answers with inline `#NNN` citations.
This module:

  1. Reassembles the streamed `answer_delta` chunks into a single string.
  2. Rewrites `WTNNN` (or legacy `#NNN`) references that match the citations
     array into Discord markdown links ``[WTNNN]({site_url}/archive/NNN/)``.
  3. Compacts conversation history the same way the JS frontend does
     (last 8 messages, 700 chars per message, 4000 chars total).

The Lambda's answer-style prompt explicitly produces plain prose with
no markdown headings/lists/bold, so for v1 we don't translate any of
that — citation rewriting is the whole job. If the Lambda starts
emitting markdown later, add a translator here.

References:
  - web/src/shared/thingy-chat-rendering.js   citation rendering patterns
  - web/src/shared/thingy-chat.js             conversation context shape
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

# The web frontend uses essentially the same citation shape.
# Matches both the canonical `WTNNN` form and the legacy bare `#NNN` form;
# either way the rewrite normalizes to `WTNNN`. Allow up to 5 digits — the
# archive will hit issue 10000 in many years but the bound is arbitrary;
# #cybersecurity-style word tags are still excluded by requiring `\d`.
CITATION_RE = re.compile(r"(^|[^\w&])(?:WT|#)(\d{1,5})\b")

DEFAULT_SITE_URL = "https://weekly.thingelstad.com"

HISTORY_MAX_MESSAGES = 8
HISTORY_MAX_PER_MESSAGE_CHARS = 700
HISTORY_MAX_TOTAL_CHARS = 4000


def assemble_answer(deltas: Iterable[str]) -> str:
    """Concat ``answer_delta`` payloads into one string. The Lambda doesn't
    add separators between deltas — they're just chunks of the same prose."""
    return "".join(deltas)


def _build_citation_map(
    citations: Optional[list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Index citations by issue_number (as string) for the rewriter."""
    if not citations:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for c in citations:
        n = c.get("issue_number")
        if n is None:
            continue
        out[str(n).strip()] = c
    return out


def inject_citations(
    answer: str,
    citations: Optional[list[dict[str, Any]]],
    *,
    site_url: str = DEFAULT_SITE_URL,
) -> str:
    """Rewrite `WTNNN` (or legacy `#NNN`) references that match a citation
    entry into Discord markdown links, always normalized to the `WT` prefix:
    ``[WTNNN](<https://weekly.thingelstad.com/archive/NNN/>)``.

    The URL is wrapped in ``<…>`` — Discord-specific syntax that
    suppresses the auto-generated link preview for that specific link.
    The message also carries ``suppress_embeds=True`` at the API
    boundary, but the angle-bracket wrap guarantees no preview even if
    that flag's behavior ever changes for markdown-style links.

    References without a matching citation are left exactly as written — we
    don't fabricate links, and we don't touch a bare ``#5`` that might be a
    non-issue reference.
    """
    if not answer:
        return answer
    citation_map = _build_citation_map(citations)
    if not citation_map:
        return answer
    base = site_url.rstrip("/")

    def _replace(match: re.Match[str]) -> str:
        prefix = match.group(1)
        number = match.group(2)
        cite = citation_map.get(number)
        if cite is None:
            return match.group(0)
        path = cite.get("url") or f"/archive/{number}/"
        if path.startswith("http://") or path.startswith("https://"):
            href = path
        else:
            href = f"{base}{path if path.startswith('/') else '/' + path}"
        return f"{prefix}[WT{number}](<{href}>)"

    return CITATION_RE.sub(_replace, answer)


def format_for_discord(
    deltas: Iterable[str],
    citations: Optional[list[dict[str, Any]]],
    *,
    site_url: str = DEFAULT_SITE_URL,
) -> str:
    """Top-level: assemble the streamed answer + rewrite citations."""
    answer = assemble_answer(deltas).strip()
    return inject_citations(answer, citations, site_url=site_url)


# ---------- conversation history compaction ----------

def compact_history(
    raw: Iterable[dict[str, str]],
) -> list[dict[str, str]]:
    """Mirror the web frontend's history compaction.

    Keep only ``user`` and ``assistant`` roles; truncate each message to
    700 chars; cap the whole list at 8 messages and 4000 total chars,
    keeping the most recent turns.
    """
    cleaned: list[dict[str, str]] = []
    for msg in raw:
        role = msg.get("role")
        content = msg.get("content")
        if role not in ("user", "assistant") or not content:
            continue
        text = str(content)[:HISTORY_MAX_PER_MESSAGE_CHARS]
        cleaned.append({"role": role, "content": text})

    # Take the most recent N messages.
    cleaned = cleaned[-HISTORY_MAX_MESSAGES:]

    # Trim from the front until the total char budget fits, but always
    # keep at least the last message so the Lambda has *some* context.
    while len(cleaned) > 1 and sum(len(m["content"]) for m in cleaned) > HISTORY_MAX_TOTAL_CHARS:
        cleaned.pop(0)

    return cleaned
