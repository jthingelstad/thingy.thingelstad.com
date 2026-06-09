"""thingy_bridge startup self-check + #chatter announcement.

On boot, after the Discord gateway is ready and the ``/thingy`` slash
tree is synced, the bridge audits the channels it actually uses
(``#ask-thingy`` + ``#chatter``) and posts a one-line readiness card
to ``#chatter`` under Thingy's avatar — mirroring the per-persona
pattern in :mod:`apps.workshop_bot.tools.discord.startup`.

The card includes the bridge's deployment header (git short hash + a
"dirty" flag if the working tree has uncommitted changes) so a restart
is operator-visible: Jamie can tell at a glance which build is now
running, separately from workshop_bot's own header (the two processes
deploy independently).

A single-shot ``_startup_announced`` flag on the bot guards against
discord.py's reconnection-fires-on_ready behaviour, so a transient
gateway blip doesn't spam #chatter with repeat "online" cards. Post
failures (e.g. Thingy not yet permissioned into #chatter) are caught
and logged so startup problems are visible without crashing the bot.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

import discord

logger = logging.getLogger("thingy_bridge.startup")

REPO = Path(__file__).resolve().parents[3]

# (env_var, friendly_label). Thingy operates in #ask-thingy (reader-facing)
# and posts conversation cards / startup heartbeats to #chatter.
CHANNELS: list[tuple[str, str]] = [
    ("DISCORD_CHANNEL_ASK_THINGY", "primary"),
    ("DISCORD_CHANNEL_CHATTER", "chatter"),
]

REQUIRED_PERMS = ("view_channel", "send_messages", "read_message_history")

COMMANDS_SUMMARY = "/thingy new · /thingy scope"


def git_hash() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO, text=True, stderr=subprocess.DEVNULL,
        ).strip()
        return out or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def git_dirty() -> bool:
    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=REPO, text=True, stderr=subprocess.DEVNULL,
        )
        return bool(out.strip())
    except Exception:  # noqa: BLE001
        return False


def _check_one(bot, env_key: str) -> tuple[str, Optional[str], list[str]]:
    """Return ``(env_key, channel_name_or_None, list_of_issues)``."""
    cid_raw = (os.environ.get(env_key) or "").strip()
    if not cid_raw:
        return env_key, None, [f"{env_key} is not set in .env"]
    try:
        cid = int(cid_raw)
    except ValueError:
        return env_key, None, [f"{env_key}={cid_raw!r} is not a valid channel id"]

    channel = bot.get_channel(cid)
    if channel is None:
        return env_key, None, [f"channel id {cid} not visible to {bot.name} (not a member?)"]

    issues: list[str] = []
    guild = getattr(channel, "guild", None)
    me = guild.me if guild is not None else None
    if me is None:
        issues.append("could not resolve bot member in guild")
    else:
        perms = channel.permissions_for(me)
        for perm_name in REQUIRED_PERMS:
            if not getattr(perms, perm_name, False):
                issues.append(f"missing perm: {perm_name}")
    return env_key, getattr(channel, "name", None), issues


def audit(bot) -> list[tuple[str, Optional[str], list[str]]]:
    """Audit Thingy's two channels."""
    return [_check_one(bot, env_key) for env_key, _ in CHANNELS]


def format_line(
    bot,
    audit_rows: list[tuple[str, Optional[str], list[str]]],
    *,
    header: Optional[str] = None,
    commands_summary: Optional[str] = None,  # accepted, ignored — see below
) -> str:
    """Build the readiness card Thingy posts to #chatter on boot.

    Clean case: ``✓ {Name} online`` — single line. The channels audit
    only surfaces when something is broken (a missing env var, a
    channel the bot can't see, a missing permission). A healthy boot
    is one line of operator confirmation, nothing more.

    ``header`` prepends a deployment line (the bridge's git hash) so
    a restart is operator-visible.

    ``commands_summary`` is accepted for backward compatibility but
    no longer rendered — repeating the slash verb list on every boot
    is operator noise; the channel itself documents available commands."""
    issues_only: list[str] = []
    for env_key, name, issues in audit_rows:
        if not issues:
            continue
        label = f"#{name}" if name else env_key
        issues_only.append(f"{label} ({'; '.join(issues)})")
    marker = "✓" if not issues_only else "⚠️"
    if issues_only:
        line = f"{marker} **{bot.name}** online — " + " · ".join(issues_only)
    else:
        line = f"{marker} **{bot.name}** online"
    out: list[str] = []
    if header:
        out.append(header)
    out.append(line)
    return "\n".join(out)


async def announce(bot, message: str) -> None:
    """Post ``message`` to #chatter under ``bot``'s avatar.

    Discord errors (Forbidden if Thingy isn't in the channel, NotFound,
    rate limits, transient HTTP failures) are caught and logged — the
    bot must not crash ``on_ready`` because a downstream channel is
    misconfigured."""
    cid_raw = (os.environ.get("DISCORD_CHANNEL_CHATTER") or "").strip()
    if not cid_raw:
        logger.warning("DISCORD_CHANNEL_CHATTER not set; skipping startup announce")
        return
    try:
        cid = int(cid_raw)
    except ValueError:
        logger.warning("DISCORD_CHANNEL_CHATTER=%r is not a valid channel id", cid_raw)
        return
    channel = bot.get_channel(cid)
    if channel is None:
        logger.warning("chatter channel not visible to %s; skipping startup announce", bot.name)
        return
    try:
        await channel.send(message, suppress_embeds=True)
        logger.info(
            "startup announce posted to #%s by %s",
            getattr(channel, "name", "?"), bot.name,
        )
    except discord.DiscordException as exc:
        logger.warning("thingy-bridge: couldn't post startup card — %s", exc)


async def post_startup_card(bot) -> None:
    """End-to-end: audit, format, announce. Idempotent per process: the
    second call (e.g. after a gateway reconnection re-fires ``on_ready``)
    is a no-op so the bridge doesn't spam #chatter every Discord blip."""
    if getattr(bot, "_startup_announced", False):
        logger.debug("startup card already posted this process; skipping")
        return
    hash_str = git_hash()
    dirty = " (dirty)" if git_dirty() else ""
    header = f"**thingy-bridge online** — `{hash_str}`{dirty}"
    rows = audit(bot)
    # Slim card: just `✓ Thingy online` (with the deployment header above
    # it). Channels render only when there's an issue. The slash-verb
    # list is no longer surfaced per boot — operator noise.
    message = format_line(bot, rows, header=header)
    await announce(bot, message)
    bot._startup_announced = True  # type: ignore[attr-defined]
