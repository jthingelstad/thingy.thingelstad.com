"""Thingy's Supporting Member Discord presence.

The bridge does two things now:

- slash commands in the validation channel connect a Supporting Member's
  web Thingy account to their Discord user and grant the member role.
- explicit mentions in #general get short, archive-grounded answers through
  the Librarian Discord mention endpoint.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import discord

from ..tools import discord_io, thingy_client
from .base import PersonaBot

logger = logging.getLogger("thingy_bridge.thingy")


def _env_int(name: str) -> Optional[int]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _identity(user: discord.abc.User, guild_id: Optional[int]) -> dict[str, str]:
    return {
        "discord_user_id": str(user.id),
        "username": str(getattr(user, "name", "") or ""),
        "global_name": str(getattr(user, "global_name", "") or ""),
        "display_name": str(getattr(user, "display_name", "") or getattr(user, "global_name", "") or getattr(user, "name", "") or ""),
        "guild_id": str(guild_id or ""),
    }


async def _remove_supporter_role(message: discord.Message) -> None:
    guild = message.guild
    role_id = _env_int("DISCORD_SUPPORTER_ROLE_ID")
    if guild is None or role_id is None:
        return
    role = guild.get_role(role_id)
    member = message.author if isinstance(message.author, discord.Member) else guild.get_member(message.author.id)
    if role is None or member is None or role not in member.roles:
        return
    try:
        await member.remove_roles(role, reason="Thingy Supporting Member entitlement no longer verified")
    except discord.DiscordException:
        logger.exception("Thingy could not remove supporter role")


class ThingyBot(PersonaBot):
    persona = "thingy"
    name = "Thingy"
    home_channel_env = "DISCORD_GENERAL_CHANNEL_ID"
    tools = ()
    empty_greeting = "Mention me in #general when the archive can help."
    preferred_model = None

    async def core(self, *, latest: str, history=None, model=None):  # pragma: no cover
        raise NotImplementedError("Thingy bridges to the Lambda; core() is unused")

    def _mentioned(self, message: discord.Message) -> bool:
        if self.user is None:
            return False
        return any(getattr(user, "id", None) == self.user.id for user in getattr(message, "mentions", []) or [])

    async def _context(self, message: discord.Message) -> list[dict[str, str]]:
        channel = message.channel
        rows: list[dict[str, str]] = []
        try:
            async for prior in channel.history(limit=8, before=message):
                if prior.author.bot:
                    continue
                content = (prior.content or "").strip()
                if not content:
                    continue
                rows.append({
                    "author": getattr(prior.author, "display_name", None) or getattr(prior.author, "name", "member"),
                    "content": content,
                })
        except discord.DiscordException:
            logger.warning("thingy: could not read Discord context", exc_info=True)
        rows.reverse()
        return rows

    async def on_message(self, message: discord.Message) -> None:  # type: ignore[override]
        if message.author == self.user or message.author.bot:
            return
        if message.guild is None or self.user is None:
            return
        if not self._is_home_channel(message.channel.id):
            return
        if not self._mentioned(message):
            return

        body, _model = self._parse_body(message)
        try:
            attachment_text = await discord_io.read_text_attachments(message)
        except Exception:  # noqa: BLE001
            logger.exception("thingy: attachment read failed")
            attachment_text = ""
        question = (attachment_text or body).strip()
        if not question:
            await message.reply(self.empty_greeting, mention_author=False, suppress_embeds=True)
            return

        try:
            await message.channel.trigger_typing()
        except discord.DiscordException:
            pass

        try:
            result = await thingy_client.discord_mention(
                identity=_identity(message.author, getattr(message.guild, "id", None)),
                message=question,
                context=await self._context(message),
            )
        except thingy_client.ThingyError as exc:
            await message.reply(
                f"Thingy could not answer that in Discord: `{exc}`",
                mention_author=False,
                suppress_embeds=True,
            )
            return

        if result.get("remove_role"):
            await _remove_supporter_role(message)

        answer = str(result.get("answer") or "").strip()
        sources = [
            source for source in (result.get("sources") or [])
            if isinstance(source, dict) and source.get("url")
        ][:3]
        if sources:
            links = []
            for source in sources:
                title = str(source.get("title") or "Source").replace("[", "").replace("]", "")
                url = str(source.get("url") or "")
                links.append(f"[{title}](<{url}>)")
            answer = f"{answer}\n\nSources: {' · '.join(links)}".strip()
        continuation = str(result.get("continuation_url") or "").strip()
        if continuation:
            answer = f"{answer}\n\nContinue in Thingy: <{continuation}>".strip()
        if not answer:
            answer = "I could not find a useful archive thread for that from here. Try continuing in Thingy on the web."
        for chunk in discord_io.split_for_discord(answer):
            await message.reply(chunk, mention_author=False, suppress_embeds=True)
