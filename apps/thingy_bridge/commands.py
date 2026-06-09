"""Reader-facing ``/thingy …`` slash commands.

The bridge keeps the Discord command surface intentionally small:

- ``/thingy new`` — clear this user's #ask-thingy session boundary so
  their next question is not pulled into the prior conversation.
- ``/thingy scope`` — choose which public sources Thingy searches for
  that user's questions.

Operator review now lives in the API-side Operator Report and Dispatch
webhooks. This module should never expose other readers' conversation
content.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import discord
from discord import app_commands

from .tools import db

if TYPE_CHECKING:
    from .personas.base import PersonaBot

logger = logging.getLogger("thingy_bridge.commands")

def _clip(text: str) -> str:
    # Discord ephemeral followup cap is 2000 chars; leave headroom.
    _MSG_CAP = 1900
    return text if len(text) <= _MSG_CAP else text[: _MSG_CAP - 1] + "…"


def register_thingy_commands(bot: "PersonaBot") -> app_commands.CommandTree:
    """Attach the ``/thingy`` command tree to the host bot.

    Returns the ``CommandTree`` so the host bot's ``on_ready`` can sync it.
    """
    tree = app_commands.CommandTree(bot)

    thingy = app_commands.Group(
        name="thingy",
        description="Manage your Thingy Discord chat session",
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

    @thingy.command(
        name="new",
        description="Start a fresh Thingy session — your next question won't carry prior context.",
    )
    async def thingy_new_cmd(interaction: discord.Interaction) -> None:  # type: ignore[misc]
        await interaction.response.defer(ephemeral=True, thinking=False)
        ok = db.mark_session_reset(str(interaction.user.id))
        if ok:
            await _ack(
                interaction,
                "🆕 Started a fresh session. Your next question to Thingy starts clean.",
            )
        else:
            await _ack(
                interaction,
                "There's nothing to reset yet — you haven't talked to Thingy in this server. "
                "Ask anything in #ask-thingy and we'll start clean from there.",
            )

    @thingy.command(
        name="scope",
        description="Choose which sources Thingy searches for your questions.",
    )
    @app_commands.describe(source="Weekly Thing issues, Jamie's blog, Another Thing, or all sources")
    @app_commands.choices(source=[
        app_commands.Choice(name="Weekly Thing", value="weekly_thing"),
        app_commands.Choice(name="Jamie's blog", value="blog"),
        app_commands.Choice(name="Another Thing", value="podcast"),
        app_commands.Choice(name="Both", value="both"),
        app_commands.Choice(name="All sources", value="all"),
    ])
    async def thingy_scope_cmd(  # type: ignore[misc]
        interaction: discord.Interaction,
        source: app_commands.Choice[str],
    ) -> None:
        await interaction.response.defer(ephemeral=True, thinking=False)
        db.set_thingy_scope(str(interaction.user.id), source.value)
        label = db.SCOPE_LABELS.get(source.value, source.value)
        await _ack(
            interaction,
            f"🔭 Thingy will now search **{label}** for your questions. "
            "Run `/thingy scope` again any time to change it.",
        )

    tree.add_command(thingy)
    return tree
