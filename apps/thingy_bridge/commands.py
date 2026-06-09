"""Supporting Member validation commands for Thingy's Discord bridge."""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Optional

import discord
from discord import app_commands

from .tools import thingy_client

if TYPE_CHECKING:
    from .personas.base import PersonaBot

logger = logging.getLogger("thingy_bridge.commands")


def _clip(text: str) -> str:
    return text if len(text) <= 1900 else text[:1899] + "…"


def _env_int(name: str) -> Optional[int]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _discord_identity(user: discord.abc.User, guild_id: Optional[int]) -> dict[str, str]:
    return {
        "discord_user_id": str(user.id),
        "username": str(getattr(user, "name", "") or ""),
        "global_name": str(getattr(user, "global_name", "") or ""),
        "display_name": str(getattr(user, "display_name", "") or getattr(user, "global_name", "") or getattr(user, "name", "") or ""),
        "guild_id": str(guild_id or ""),
    }


def _in_validation_channel(interaction: discord.Interaction) -> bool:
    validation_channel_id = _env_int("DISCORD_VALIDATION_CHANNEL_ID")
    if validation_channel_id is None:
        return True
    return int(getattr(interaction, "channel_id", 0) or 0) == validation_channel_id


async def _ack(interaction: discord.Interaction, text: str) -> None:
    try:
        await interaction.followup.send(_clip(text), ephemeral=True)
    except discord.HTTPException:
        logger.warning("/thingy: couldn't ack invoker (interaction expired?)")


async def _sync_supporter_role(interaction: discord.Interaction, *, add: bool) -> bool:
    guild = interaction.guild
    role_id = _env_int("DISCORD_SUPPORTER_ROLE_ID")
    if guild is None or role_id is None:
        return False
    role = guild.get_role(role_id)
    if role is None:
        return False
    member = interaction.user if isinstance(interaction.user, discord.Member) else guild.get_member(interaction.user.id)
    if member is None:
        return False
    try:
        if add and role not in member.roles:
            await member.add_roles(role, reason="Thingy Supporting Member verification")
        elif not add and role in member.roles:
            await member.remove_roles(role, reason="Thingy Supporting Member entitlement no longer verified")
    except discord.DiscordException:
        logger.exception("Thingy could not sync Discord supporter role")
        return False
    return True


def register_thingy_commands(bot: "PersonaBot") -> app_commands.CommandTree:
    """Attach the ``/thingy`` validation command tree to the host bot."""
    tree = app_commands.CommandTree(bot)

    thingy = app_commands.Group(
        name="thingy",
        description="Connect your Supporting Membership to Thingy in Discord",
    )

    @thingy.command(
        name="verify",
        description="Start Supporting Member verification for this Discord account.",
    )
    async def thingy_verify_cmd(interaction: discord.Interaction) -> None:  # type: ignore[misc]
        await interaction.response.defer(ephemeral=True, thinking=False)
        if not _in_validation_channel(interaction):
            await _ack(interaction, "Use `/thingy verify` in the validation channel so Thingy can keep the flow tidy.")
            return
        guild_id = getattr(interaction.guild, "id", None)
        try:
            result = await thingy_client.start_discord_link(_discord_identity(interaction.user, guild_id))
        except thingy_client.ThingyError as exc:
            await _ack(interaction, f"Thingy could not start Discord verification: `{exc}`")
            return
        await _ack(
            interaction,
            "Open this link, sign in with your Supporting Member email, then bring the code back here:\n"
            f"{result.get('link')}",
        )

    @thingy.command(
        name="confirm",
        description="Confirm the one-time code Thingy gave you on the website.",
    )
    @app_commands.describe(code="The one-time code from thingy.thingelstad.com/discord/")
    async def thingy_confirm_cmd(interaction: discord.Interaction, code: str) -> None:  # type: ignore[misc]
        await interaction.response.defer(ephemeral=True, thinking=False)
        if not _in_validation_channel(interaction):
            await _ack(interaction, "Use `/thingy confirm` in the validation channel.")
            return
        guild_id = getattr(interaction.guild, "id", None)
        try:
            result = await thingy_client.confirm_discord_link(
                code=code,
                identity=_discord_identity(interaction.user, guild_id),
            )
        except thingy_client.ThingyError as exc:
            await _ack(interaction, f"Thingy could not confirm that code: `{exc}`")
            return
        role_ok = await _sync_supporter_role(interaction, add=True)
        name = result.get("discord_connection", {}).get("display_name") or "your Discord account"
        suffix = "" if role_ok else "\n\nThingy verified you, but could not add the Discord role. Jamie may need to check bot permissions."
        await _ack(interaction, f"Connected {name}. Welcome in.{suffix}")

    tree.add_command(thingy)
    return tree
