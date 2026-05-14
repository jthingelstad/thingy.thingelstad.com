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
from typing import Any, Optional

import discord

from ..tools import db, discord_io, thingy_client, thingy_render
from .base import PersonaBot

logger = logging.getLogger("workshop.thingy")

FEEDBACK_EMOJI = {"👍": "up", "👎": "down"}
THUMBS_UP = "👍"
THUMBS_DOWN = "👎"
ACK_EMOJI = "✅"


def _profile_is_returning(profile: dict[str, Any]) -> bool:
    return bool(profile) and bool(profile.get("returning"))


def _format_welcome_back(profile: dict[str, Any]) -> str:
    """Compose a short welcome-back message for a returning user.

    Pulls from the auth response's `profile` field. Mentions the most
    recent Bedrock-synthesized session summary if there is one;
    otherwise notes the recent question count and offers to pick up
    from there. Always under 400 chars so it doesn't bury the answer.
    """
    summaries = profile.get("prior_session_summaries") or []
    recent_qs = profile.get("current_session_questions") or []
    if summaries:
        last = summaries[-1].get("summary", "").strip()
        if last:
            preview = last if len(last) <= 220 else last[:217] + "…"
            return (
                f"👋 Welcome back. Last time we were on: _{preview}_\n"
                "Want to keep going there, or something fresh?"
            )
    if recent_qs:
        last_q = (recent_qs[-1].get("question") or "").strip()
        if last_q:
            preview = last_q if len(last_q) <= 180 else last_q[:177] + "…"
            return (
                "👋 Welcome back. The last thing you asked me was: "
                f"_\"{preview}\"_  — want to pick up from there?"
            )
    return "👋 Welcome back. What can I dig up for you today?"


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
        # Welcome-back applies only on fresh-token mints (token cache is
        # ~12h, so this naturally rate-limits to once per session). Sent
        # as a separate message before the answer so it reads as a
        # personal "hey" rather than appearing inline with the response.
        if auth_result.fresh and _profile_is_returning(auth_result.profile):
            try:
                await message.channel.send(
                    _format_welcome_back(auth_result.profile),
                    suppress_embeds=True,
                )
                db.mark_thingy_welcomed(discord_user_id)
            except discord.DiscordException:
                logger.exception("thingy: failed to post welcome-back")

        deltas: list[str] = []
        citations: list[dict[str, Any]] = []
        request_id: Optional[str] = None

        async with message.channel.typing():
            try:
                async for event_name, data in thingy_client.chat_stream(
                    token=token, message=question, history=compact_history,
                ):
                    if event_name == "meta":
                        request_id = str(data.get("request_id") or "") or None
                    elif event_name == "answer_delta":
                        delta = data.get("delta")
                        if isinstance(delta, str):
                            deltas.append(delta)
                    elif event_name == "citations":
                        items = data.get("citations")
                        if isinstance(items, list):
                            citations = items
                    elif event_name == "status":
                        # Status updates are intentionally not posted to
                        # Discord — the channel would get noisy. Log only.
                        msg = data.get("message")
                        if msg:
                            logger.info("thingy status: %s", msg)
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
                await message.reply(
                    f"Thingy couldn't answer: `{exc}`",
                    mention_author=False,
                    suppress_embeds=True,
                )
                return

        answer = thingy_render.format_for_discord(
            deltas, citations, site_url=site_url,
        )
        if not answer:
            db.update_thingy_request(
                run_row,
                status="error",
                error="empty_answer",
                duration_ms=int((time.monotonic() - t0) * 1000),
                request_id=request_id,
            )
            await message.reply(
                "Thingy didn't return anything. Try rephrasing?",
                mention_author=False,
                suppress_embeds=True,
            )
            return

        sent_last = await self._send_answer(message, answer)

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

    async def _send_answer(
        self, message: discord.Message, answer: str
    ) -> Optional[discord.Message]:
        """Send the answer chunked. Every chunk is a reply to the user's
        original message so the chain visually holds together. Returns
        the LAST chunk so the caller can attach feedback reactions
        there — reactions land at the visual end of the response.

        ``suppress_embeds=True`` keeps Discord from auto-previewing
        archive URLs in the citations — those previews crowd the answer.
        """
        if not answer.strip():
            return None
        last_msg: Optional[discord.Message] = None
        for chunk in discord_io.split_for_discord(answer):
            last_msg = await message.reply(
                chunk, mention_author=False, suppress_embeds=True,
            )
        return last_msg

    async def _build_thingy_history(
        self, message: discord.Message
    ) -> list[dict[str, str]]:
        """Reconstruct prior turns in this channel between the asking
        user and Thingy. Skips messages from any other user/bot so the
        Lambda only sees a clean two-party conversation.
        """
        raw: list[dict[str, str]] = []
        try:
            async for prior in message.channel.history(limit=20, before=message):
                if prior.author.id == message.author.id and not prior.author.bot:
                    raw.append({"role": "user", "content": prior.content or ""})
                elif self.user is not None and prior.author.id == self.user.id:
                    raw.append({"role": "assistant", "content": prior.content or ""})
                # Other users' messages (or other bots) are skipped — Thingy
                # answers per-user, not channel-wide.
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
