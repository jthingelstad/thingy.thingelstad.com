"""Thingy bridge persona.

Unlike Eddy/Linky/Marky/Patty, Thingy is **not** a local agent — it's a
thin pass-through to the production Librarian Lambda. Each user message
in #ask-thingy is forwarded to the Lambda's /chat endpoint; the SSE
stream is collected, the answer's `#NNN` citations are rewritten into
clickable Discord links, and the result is posted back.

Thingy doesn't run the agent loop, doesn't load the corpus, doesn't have
memory tools, doesn't peer-react in #workshop, and doesn't post to
#chatter. It only listens in its home channel and only replies to direct
messages there.

After posting an answer, the bot adds 👍/👎 reactions; users can click
either to send feedback to the Lambda's /feedback endpoint, which is the
same surface the public web UI uses.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import discord

from ..tools import db, discord_io, thingy_client, thingy_render
from .base import PersonaBot

# Walking #ask-thingy history backward, stop once we hit a gap larger
# than this. Matches the bridge's conversation-grouping heuristic in
# jobs/watch.py — a >30-min pause is treated as a fresh session, so
# yesterday's CTO chat doesn't get dragged into today's RSS question.
SESSION_GAP = timedelta(minutes=30)


def _parse_sqlite_utc(raw: Optional[str]) -> Optional[datetime]:
    """Parse the ``YYYY-MM-DD HH:MM:SS`` shape sqlite's ``datetime('now')``
    produces (UTC, naive) into an aware UTC datetime. Returns ``None``
    for ``None`` / empty / malformed inputs so callers can treat the
    result as "no reset on file"."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# Status text Thingy shows next to the spinner. Indexed by the Lambda's
# tool name (lowercased, underscores intact). Anything not in the table
# falls back to a humanized form of the tool name. Keep the copy in
# Thingy's voice — "looking at" rather than "checking", "scanning"
# rather than "querying".
_TOOL_STATUS_COPY: dict[str, str] = {
    "search_archive": "Searching the archive…",
    "search_faq": "Checking the FAQ…",
    "quote_search": "Looking up the exact wording…",
    "retrieve_archive": "Pulling semantic matches from the archive…",
    "get_issue": "Loading the issue…",
    "get_section": "Loading the section…",
    "domain_history": "Tracing the domain's history…",
    "find_links": "Walking the link graph…",
    "list_issues": "Scanning issues for the pattern…",
    "compare_eras": "Comparing across eras…",
}


def _humanize_status(raw: str) -> str:
    """Turn a raw Lambda status line into Thingy-voice progress copy.

    The Lambda emits things like ``"Checking search archive..."`` or
    ``"Investigating the archive..."``. The "Investigating…" opener
    arrives once before any tool fires; everything else is derived from
    the tool name. We map the tool name to a curated phrase when we
    have one; otherwise we humanize the raw verb.
    """
    text = (raw or "").strip()
    if not text:
        return "Working on it…"
    if text.lower().startswith("checking "):
        # "Checking search archive..." -> tool_name "search archive"
        tool_phrase = text[len("Checking "):].rstrip(".").strip()
        tool_key = tool_phrase.replace(" ", "_")
        copy = _TOOL_STATUS_COPY.get(tool_key.lower())
        if copy:
            return copy
        # Unknown tool — show the humanized name so we don't lie about
        # what's happening, just dress it up a bit.
        return f"Checking {tool_phrase}…"
    # Non-tool status (opener "Investigating the archive...") — pass
    # through but normalize the trailing ellipsis.
    return text.rstrip(".") + "…"


class _Progress:
    """Single-message status display for a Thingy turn.

    Mirrors the workshop_bot ``ProgressMessage`` pattern: send a reply
    once, then edit-in-place on each status event. Failure is silent;
    a Discord edit hiccup logs and keeps the turn moving. Hands its
    message off to ``_StreamingAnswer`` once the first answer delta
    arrives so the spinner naturally becomes the first chunk.
    """

    def __init__(self, anchor: discord.Message):
        self._anchor = anchor
        self._msg: Optional[discord.Message] = None
        self._last: str = ""

    @property
    def message(self) -> Optional[discord.Message]:
        return self._msg

    async def update(self, text: str) -> None:
        text = (text or "").strip()
        if not text or text == self._last:
            return
        self._last = text
        body = text if len(text) <= 1990 else text[:1990].rstrip() + "…"
        try:
            if self._msg is None:
                self._msg = await self._anchor.reply(
                    body, mention_author=False, suppress_embeds=True,
                )
            else:
                await self._msg.edit(content=body)
        except discord.DiscordException:
            logger.warning("thingy: progress update failed", exc_info=True)

    def hand_off(self) -> Optional[discord.Message]:
        """Release ownership of the underlying message. The caller (the
        streaming-answer object) takes over editing it; this object will
        not touch it again, even on ``delete()``."""
        msg = self._msg
        self._msg = None
        return msg

    async def delete(self) -> None:
        """Remove the progress message before the real answer lands.
        Best-effort — a delete failure leaves a stale spinner line above
        the answer, which is preferable to losing the answer entirely."""
        if self._msg is None:
            return
        try:
            await self._msg.delete()
        except discord.DiscordException:
            logger.warning("thingy: progress delete failed", exc_info=True)
        finally:
            self._msg = None


class _StreamingAnswer:
    """Mirror the Lambda's streaming answer into a live-editing Discord
    reply chain. Deltas accumulate into ``_full_text``; on a throttled
    cadence we re-split the full text into Discord-sized chunks and
    reconcile against the messages already posted (edit-in-place where
    they differ, send a new reply for overflow).

    Citation rewriting (``WT332`` → ``[WT332](…)``) only happens in
    :meth:`finalize` since the citations array arrives after the body
    is complete. The streaming pass uses a tighter chunk limit so the
    expansion at finalize has headroom; the final pass uses the real
    Discord limit.
    """

    # During streaming the model emits raw ``WT###`` references; on
    # finalize they get rewritten to markdown links which expand the
    # text. STREAM_LIMIT is conservative; FINAL_LIMIT is the real cap.
    STREAM_LIMIT = 1700
    FINAL_LIMIT = 1950
    MIN_EDIT_INTERVAL = 1.0  # seconds — Discord edit rate is ~5/5s per channel

    def __init__(
        self,
        anchor: discord.Message,
        *,
        initial_msg: Optional[discord.Message] = None,
        site_url: str = "",
    ):
        self._anchor = anchor
        self._site_url = site_url
        self._msgs: list[discord.Message] = []
        self._msg_texts: list[str] = []
        if initial_msg is not None:
            self._msgs.append(initial_msg)
            self._msg_texts.append(initial_msg.content or "")
        self._full_text: str = ""
        self._dirty: bool = False
        self._last_edit_ts: float = 0.0

    async def append(self, delta: str) -> None:
        if not delta:
            return
        self._full_text += delta
        self._dirty = True
        if time.monotonic() - self._last_edit_ts >= self.MIN_EDIT_INTERVAL:
            await self._flush(self.STREAM_LIMIT)

    async def _flush(self, limit: int, *, force: bool = False) -> None:
        if not self._dirty and not force:
            return
        target = discord_io.split_for_discord(self._full_text, limit)
        # Empty target while we still have a spinner message — just blank
        # it out so the user isn't staring at a stale spinner during a
        # zero-delta hiccup. This is unusual; deltas almost always arrive
        # in non-empty chunks.
        if not target and self._msgs:
            target = [""]
        for i, t in enumerate(target):
            if i < len(self._msgs):
                if self._msg_texts[i] != t and t.strip():
                    try:
                        await self._msgs[i].edit(content=t)
                        self._msg_texts[i] = t
                    except discord.DiscordException:
                        logger.warning("thingy: streaming edit failed", exc_info=True)
            else:
                try:
                    new_msg = await self._anchor.reply(
                        t or "…", mention_author=False, suppress_embeds=True,
                    )
                    self._msgs.append(new_msg)
                    self._msg_texts.append(t)
                except discord.DiscordException:
                    logger.warning("thingy: streaming reply failed", exc_info=True)
        self._dirty = False
        self._last_edit_ts = time.monotonic()

    async def finalize(
        self, citations: list[dict[str, Any]],
    ) -> Optional[discord.Message]:
        """Rewrite citations into the full text, re-split at the final
        Discord limit, edit each message to its final content, and
        return the last message (for feedback reactions)."""
        if self._site_url and citations:
            self._full_text = thingy_render.inject_citations(
                self._full_text, citations, site_url=self._site_url,
            )
        self._dirty = True
        await self._flush(self.FINAL_LIMIT, force=True)
        return self._msgs[-1] if self._msgs else None

    @property
    def has_output(self) -> bool:
        return bool(self._full_text.strip())

logger = logging.getLogger("workshop.thingy")

FEEDBACK_EMOJI = {"👍": "up", "👎": "down"}
THUMBS_UP = "👍"
THUMBS_DOWN = "👎"
ACK_EMOJI = "✅"


class ThingyBot(PersonaBot):
    persona = "thingy"
    name = "Thingy"
    home_channel_env = "DISCORD_CHANNEL_ASK_THINGY"
    tools = ()                  # bridge: no agent_loop tools
    empty_greeting = "Ask me about the Weekly Thing archive."
    preferred_model = None      # bridge: no LLM call from this process

    async def core(
        self,
        *,
        latest: str,
        history=None,
        model=None,
    ):  # pragma: no cover — bridge persona doesn't run the agent loop
        raise NotImplementedError(
            "Thingy bridges to the Lambda; core() is unused"
        )

    async def on_message(self, message: discord.Message) -> None:  # type: ignore[override]
        """Restrict Thingy to its home channel. We override the base
        ``on_message`` (which has team-mention + peer-reaction logic that
        doesn't apply to a bridge) and route only direct, in-channel
        human questions to ``handle()``."""
        if message.author == self.user or message.author.bot:
            return
        if message.guild is None or self.user is None:
            return
        if not self._is_home_channel(message.channel.id):
            return
        # Allow @-mentions of Thingy too (won't usually happen since the
        # channel is dedicated, but doesn't hurt). Body parsing strips
        # them either way.
        body, _model = self._parse_body(message)
        try:
            attachment_text = await discord_io.read_text_attachments(message)
        except Exception:  # noqa: BLE001
            logger.exception("thingy: attachment read failed")
            attachment_text = ""

        try:
            await self.handle(
                message=message,
                body=body,
                attachment=attachment_text,
                model=None,
                history=[],  # built inside handle() from channel history
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("thingy: handler raised")
            try:
                await message.reply(
                    f"Sorry — Thingy hit a snag: `{type(exc).__name__}: {exc}`"[:1900],
                    mention_author=False,
                    suppress_embeds=True,
                )
            except discord.DiscordException:
                logger.exception("thingy: also failed to post error notice")

    async def handle(  # type: ignore[override]
        self,
        *,
        message: discord.Message,
        body: str,
        attachment: str,
        model,
        history,
    ) -> None:
        question = (attachment or body).strip()
        if not question:
            await message.reply(
                self.empty_greeting, mention_author=False, suppress_embeds=True,
            )
            return

        # Build the conversation history from this channel's recent
        # messages, mirroring how the JS frontend keeps the last few
        # turns. We only include messages between this user and Thingy
        # (skip everything else), then compact via render module.
        compact_history = await self._build_thingy_history(message)

        discord_user_id = str(message.author.id)
        run_row = db.insert_thingy_request(
            discord_user_id=discord_user_id,
            discord_message_id=str(message.id),
            question=question,
        )
        t0 = time.monotonic()
        site_url = (
            os.environ.get("WEEKLY_THING_SITE_URL")
            or "https://weekly.thingelstad.com"
        ).rstrip("/")

        try:
            auth_result = await thingy_client.get_or_refresh_token(discord_user_id)
        except thingy_client.ThingyError as exc:
            db.update_thingy_request(
                run_row,
                status="error",
                error=f"auth: {exc}",
                duration_ms=int((time.monotonic() - t0) * 1000),
            )
            await message.reply(
                f"I can't reach the archive right now: `{exc}`",
                mention_author=False,
                suppress_embeds=True,
            )
            return

        token = auth_result.token

        citations: list[dict[str, Any]] = []
        request_id: Optional[str] = None

        progress = _Progress(message)
        streamer: Optional[_StreamingAnswer] = None
        # Show something immediately — the Lambda's first status event
        # is "Investigating the archive..." but it doesn't land until
        # after the SSE handshake, so seed the spinner ourselves.
        await progress.update("🔎 Reaching the archive…")

        try:
            async for event_name, data in thingy_client.chat_stream(
                token=token, message=question, history=compact_history,
            ):
                if event_name == "meta":
                    request_id = str(data.get("request_id") or "") or None
                elif event_name == "answer_delta":
                    delta = data.get("delta")
                    if not isinstance(delta, str):
                        continue
                    if streamer is None:
                        # First delta: the spinner becomes the streaming
                        # answer's first message — no extra round trip.
                        streamer = _StreamingAnswer(
                            message,
                            initial_msg=progress.hand_off(),
                            site_url=site_url,
                        )
                    await streamer.append(delta)
                elif event_name == "citations":
                    items = data.get("citations")
                    if isinstance(items, list):
                        citations = items
                elif event_name == "status":
                    msg = data.get("message")
                    if not msg:
                        continue
                    logger.info("thingy status: %s", msg)
                    # Once we're streaming the answer, suppress further
                    # spinner edits — would clobber the in-progress text.
                    if streamer is None:
                        await progress.update(f"🔎 {_humanize_status(msg)}")
                elif event_name == "done":
                    break
        except thingy_client.ThingyError as exc:
            db.update_thingy_request(
                run_row,
                status="error",
                error=str(exc),
                duration_ms=int((time.monotonic() - t0) * 1000),
                request_id=request_id,
            )
            # If streaming had started, fall back to a fresh error reply
            # (the partial answer keeps its current text, and we don't
            # overwrite it with the error). If the spinner is still up,
            # edit it in place.
            if streamer is None:
                await progress.update(f"❌ Thingy couldn't answer: `{exc}`")
            else:
                try:
                    await message.reply(
                        f"❌ Thingy couldn't finish: `{exc}`",
                        mention_author=False, suppress_embeds=True,
                    )
                except discord.DiscordException:
                    logger.exception("thingy: failed to post stream-error reply")
            return

        if streamer is None or not streamer.has_output:
            db.update_thingy_request(
                run_row,
                status="error",
                error="empty_answer",
                duration_ms=int((time.monotonic() - t0) * 1000),
                request_id=request_id,
            )
            await progress.update("Thingy didn't return anything. Try rephrasing?")
            return

        sent_last = await streamer.finalize(citations)

        db.update_thingy_request(
            run_row,
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            request_id=request_id,
            bot_response_message_id=str(sent_last.id) if sent_last else None,
        )

        # Reactions go on the LAST chunk of the answer so they sit at
        # the visual end of the reply (long answers split into multiple
        # Discord messages — putting reactions on the first chunk made
        # users think the response had ended early).
        if sent_last is not None and request_id:
            for emoji in (THUMBS_UP, THUMBS_DOWN):
                try:
                    await sent_last.add_reaction(emoji)
                except discord.DiscordException:
                    logger.exception("thingy: failed to add %s reaction", emoji)

    async def _build_thingy_history(
        self, message: discord.Message
    ) -> list[dict[str, str]]:
        """Reconstruct prior turns in this channel between the asking
        user and Thingy. Skips messages from any other user/bot so the
        Lambda only sees a clean two-party conversation. Two cutoffs
        bound the walk so a fresh question isn't pulled into a stale
        context:

          - **Implicit:** any >30-min gap walking backward (``SESSION_GAP``).
          - **Explicit:** the user's last ``/thingy new`` timestamp;
            anything older than that is treated as a different session.
        """
        raw: list[dict[str, str]] = []
        last_ts = message.created_at
        reset_at = _parse_sqlite_utc(db.get_session_reset_at(str(message.author.id)))
        try:
            async for prior in message.channel.history(limit=20, before=message):
                if (last_ts - prior.created_at) > SESSION_GAP:
                    break
                if reset_at is not None and prior.created_at < reset_at:
                    break
                if prior.author.id == message.author.id and not prior.author.bot:
                    raw.append({"role": "user", "content": prior.content or ""})
                elif self.user is not None and prior.author.id == self.user.id:
                    raw.append({"role": "assistant", "content": prior.content or ""})
                else:
                    # Other users' messages (or other bots) are skipped —
                    # Thingy answers per-user — but they still anchor the
                    # session-gap clock so an active channel doesn't
                    # artificially stretch the window. Update last_ts and
                    # keep walking.
                    last_ts = prior.created_at
                    continue
                last_ts = prior.created_at
        except discord.DiscordException:
            logger.exception("thingy: history fetch failed; continuing with no history")
            return []
        raw.reverse()  # oldest first
        return thingy_render.compact_history(raw)

    # ---------- feedback via reactions ----------

    async def on_raw_reaction_add(
        self, payload: discord.RawReactionActionEvent
    ) -> None:  # type: ignore[override]
        if self.user is None or payload.user_id == self.user.id:
            return
        emoji = str(payload.emoji)
        reaction = FEEDBACK_EMOJI.get(emoji)
        if reaction is None:
            return
        record = db.lookup_thingy_request_by_response(str(payload.message_id))
        if record is None or not record.get("request_id"):
            return
        # Use the original asker's token for the feedback POST so the
        # Lambda attributes feedback to the user who triggered the answer.
        try:
            token = await thingy_client.get_token(str(record["discord_user_id"]))
        except thingy_client.ThingyError as exc:
            logger.warning("thingy feedback skipped — auth failed: %s", exc)
            return
        ok = await thingy_client.submit_feedback(
            token=token,
            request_id=str(record["request_id"]),
            reaction=reaction,
        )
        logger.info(
            "thingy feedback %s for request %s: %s",
            reaction, record["request_id"], "ok" if ok else "failed",
        )
        if ok:
            await self._ack_feedback(payload)

    async def _ack_feedback(
        self, payload: discord.RawReactionActionEvent
    ) -> None:
        """Add a ✅ to the answer message so the user sees the thumbs-up
        / thumbs-down was registered. Quiet failure on Discord errors —
        feedback already landed; the ack is just a visual receipt.
        """
        try:
            channel = self.get_channel(payload.channel_id)
            if channel is None:
                channel = await self.fetch_channel(payload.channel_id)
            msg = await channel.fetch_message(payload.message_id)
            await msg.add_reaction(ACK_EMOJI)
        except discord.DiscordException:
            logger.exception("thingy: failed to add ✅ acknowledgment")
