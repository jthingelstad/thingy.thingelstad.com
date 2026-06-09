"""Minimal team registry — the bridge has one bot today.

If a second persona ever ships in this app, this is where shared
orchestration would live (claim semantics, round counters, etc).
For now it's a thin dict.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import PersonaBot

logger = logging.getLogger("thingy_bridge.team")


class TeamRegistry:
    """One entry per persona. The bridge registers just Thingy."""

    def __init__(self) -> None:
        self.bots: dict[str, "PersonaBot"] = {}

    def register(self, bot: "PersonaBot") -> None:
        self.bots[bot.persona] = bot
