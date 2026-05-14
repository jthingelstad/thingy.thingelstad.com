"""``/thingy …`` slash commands — the operator window into reader Q&A.

Three subcommands, all gated to ``DISCORD_OWNER_USER_ID`` (the bot
``default_permissions`` is ``manage_guild`` like workshop_bot's
``/workshop`` tree; Discord enforces the role check before the handler
even fires):

- ``/thingy recent [count]`` — last N mirrored conversations, one line
  each (DB read).
- ``/thingy show <id>`` — one conversation: assessment card + the full
  transcript attached as a ``.md`` file.
- ``/thingy sync`` — manual re-fire of the hourly ``thingy-watch`` job.
"""

from __future__ import annotations

import io
import logging
from typing import TYPE_CHECKING

import discord
from discord import app_commands

from .jobs import _base as jobs_base
from .jobs import watch as thingy_job

if TYPE_CHECKING:
    from .personas.base import PersonaBot

logger = logging.getLogger("thingy_bridge.commands")

# Discord ephemeral followup cap is 2000 chars; leave headroom.
_MSG_CAP = 1900


def _ctx(bot) -> "jobs_base.JobContext":
    return jobs_base.JobContext(deps=getattr(bot, "deps", None), trigger="manual")


def _clip(text: str) -> str:
    return text if len(text) <= _MSG_CAP else text[: _MSG_CAP - 1] + "…"


def register_thingy_commands(bot: "PersonaBot") -> app_commands.CommandTree:
    """Attach the ``/thingy`` command tree to the host bot.

    Returns the ``CommandTree`` so the host bot's ``on_ready`` can sync
    it to the operator's guild (or globally).
    """
    tree = app_commands.CommandTree(bot)

    thingy = app_commands.Group(
        name="thingy",
        description="What readers ask the public archive agent",
        default_permissions=discord.Permissions(manage_guild=True),
    )

    async def _ack(interaction, text: str, *, file: discord.File | None = None) -> None:
        """Send an ephemeral followup, swallowing an expired-token error."""
        try:
            if file is not None:
                await interaction.followup.send(_clip(text), ephemeral=True, file=file)
            else:
                await interaction.followup.send(_clip(text), ephemeral=True)
        except discord.HTTPException:
            logger.warning("/thingy: couldn't ack invoker (interaction expired?)")

    async def _run_and_ack(interaction, coro_factory, label: str) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            result = await coro_factory()
        except jobs_base.JobLocked as exc:
            logger.info("/thingy %s: blocked — %s", label, exc.holder_desc)
            await _ack(interaction, f"⏳ `{label}` is already running ({exc.holder_desc}) — try again shortly.")
            return
        except Exception as exc:  # noqa: BLE001
            logger.exception("/thingy %s failed", label)
            await _ack(interaction, f"❌ `{label}` hit an error: `{type(exc).__name__}: {exc}`")
            return
        await _ack(interaction, result.message)

    @thingy.command(
        name="recent",
        description="Recent conversations readers have had with Thingy.",
    )
    @app_commands.describe(count="How many to list (default 8, max 25)")
    async def thingy_recent_cmd(  # type: ignore[misc]
        interaction: discord.Interaction, count: int = 8
    ) -> None:
        await _run_and_ack(interaction, lambda: thingy_job.recent(_ctx(bot), count=int(count)), "thingy recent")

    @thingy.command(
        name="show",
        description="One Thingy conversation — assessment + full transcript (attached).",
    )
    @app_commands.describe(id="The conversation id from `thingy recent` (the `#N`)")
    async def thingy_show_cmd(  # type: ignore[misc]
        interaction: discord.Interaction, id: int
    ) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            result = await thingy_job.show(_ctx(bot), conv_id=int(id))
        except Exception as exc:  # noqa: BLE001
            logger.exception("/thingy show failed")
            await _ack(interaction, f"❌ `thingy show` hit an error: `{type(exc).__name__}: {exc}`")
            return
        md = (result.data or {}).get("transcript_md")
        if result.ok and md:
            fname = (result.data or {}).get("filename") or f"thingy-conversation-{id}.md"
            await _ack(interaction, result.message,
                       file=discord.File(io.BytesIO(md.encode("utf-8")), filename=fname))
        else:
            await _ack(interaction, result.message)

    @thingy.command(
        name="sync",
        description="Pull new Thingy conversations now (the hourly thingy-watch, on demand).",
    )
    async def thingy_sync_cmd(interaction: discord.Interaction) -> None:  # type: ignore[misc]
        await _run_and_ack(interaction, lambda: thingy_job.watch(_ctx(bot)), "thingy sync")

    tree.add_command(thingy)
    return tree
