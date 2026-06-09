"""Minimal PersonaBot base for the bridge.

The bridge runs a *single* persona (Thingy) and the persona doesn't run
an agent loop — it's a pass-through to the Lambda. So this base is much
smaller than workshop_bot's PersonaBot: just the discord.Client
plumbing, home-channel resolution, and a tiny body-parser. No agent
loop, no team orchestration, no peer reactions, no model flag parsing.

If a second persona ever lives in this app, the base is the place to
grow shared behavior.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import ClassVar, Optional

import discord

logger = logging.getLogger("thingy_bridge.persona")


def _read_env_int(key: str) -> Optional[int]:
    raw = (os.environ.get(key) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


class PersonaBot(discord.Client):
    """Discord client subclass with home-channel routing.

    Subclasses set ``persona`` / ``name`` / ``home_channel_env`` /
    ``empty_greeting`` and override ``on_message`` to do whatever they
    do. The bridge's only subclass is :class:`ThingyBot`, which
    forwards to the Lambda.
    """

    persona: ClassVar[str] = "base"
    name: ClassVar[str] = "Persona"
    home_channel_env: ClassVar[Optional[str]] = None
    empty_greeting: ClassVar[str] = "Hey — what are we looking at?"

    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True
        super().__init__(intents=intents)
        self.ready_event = asyncio.Event()
        self._home_channel_id: Optional[int] = (
            _read_env_int(self.home_channel_env) if self.home_channel_env else None
        )

    async def on_ready(self) -> None:  # type: ignore[override]
        user = self.user
        logger.info("%s online as %s (id=%s)", self.name, user, getattr(user, "id", "?"))
        self.ready_event.set()

    def _is_home_channel(self, channel_id: int) -> bool:
        return self._home_channel_id is not None and self._home_channel_id == channel_id

    def _parse_body(self, message: discord.Message) -> tuple[str, None]:
        """Strip our own user mention. Returns (body, None) — the second
        slot is a model-override placeholder kept for signature parity
        with workshop_bot's ``_parse_body`` (the bridge doesn't honor
        ``--haiku`` / ``--sonnet`` / ``--opus`` flags; model selection
        happens server-side in the Lambda)."""
        text = message.content or ""
        if self.user is not None:
            text = text.replace(f"<@{self.user.id}>", "").replace(f"<@!{self.user.id}>", "")
        return text.strip(), None
