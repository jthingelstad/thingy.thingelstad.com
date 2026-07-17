"""Job runtime — context, single-asset locking. Trimmed from
workshop_bot/jobs/_base.py: same JobContext / JobResult / job_lock /
JobLocked shape, no draft-block helpers (the bridge doesn't render
issue artifacts).
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

from ..tools import db, discord_io

logger = logging.getLogger("thingy_bridge.jobs")


# ---------- result ----------


@dataclass
class JobResult:
    """What a job hands back. ``message`` is rendered to the invoker;
    ``data`` carries structured bits a caller may want."""

    ok: bool
    message: str
    data: dict[str, Any] = field(default_factory=dict)


# ---------- context ----------


class JobContext:
    """Per-run context handed to a job. Carries the shared ``Deps``
    (team registry — the bridge's is one-bot) and a ``trigger`` label
    ('manual', 'scheduled')."""

    def __init__(self, *, deps: Any = None, trigger: str = "manual") -> None:
        self.deps = deps
        self.trigger = trigger

    @property
    def team(self):
        return getattr(self.deps, "team", None)

    def channel(self, env_var: str, *, persona: Optional[str] = None):
        """Resolve a Discord channel from an env var, optionally bound
        to a persona's client so ``channel.send`` posts under that
        avatar."""
        team = self.team
        if team is None:
            logger.warning("job: no team registry; cannot resolve %s", env_var)
            return None
        cid_raw = (os.environ.get(env_var) or "").strip()
        if not cid_raw:
            logger.warning("job: %s not set; channel unavailable", env_var)
            return None
        try:
            cid = int(cid_raw)
        except ValueError:
            logger.warning("job: %s=%r is not a channel id", env_var, cid_raw)
            return None
        if persona is not None:
            bot = team.bots.get(persona)
            if bot is None or bot.user is None:
                logger.warning("job: persona %r unavailable for channel %s", persona, env_var)
                return None
            return bot.get_channel(cid)
        for bot in team.bots.values():
            if bot.user is None:
                continue
            ch = bot.get_channel(cid)
            if ch is not None:
                return ch
        logger.warning("job: channel %s not visible to any persona", cid)
        return None

    async def post(
        self,
        channel_or_env,
        text: str,
        *,
        persona: Optional[str] = None,
        suppress_embeds: bool = True,
    ) -> bool:
        """Post ``text`` (chunked) to a channel. ``channel_or_env`` may
        be a channel object or an env-var name to resolve. Returns True
        if sent."""
        if not text or not text.strip():
            return False
        ch = channel_or_env
        if isinstance(channel_or_env, str):
            ch = self.channel(channel_or_env, persona=persona)
        if ch is None:
            return False
        for chunk in discord_io.split_for_discord(text):
            await ch.send(chunk, suppress_embeds=suppress_embeds)
        return True

    async def send_one(
        self,
        channel_or_env,
        text: str,
        *,
        persona: Optional[str] = None,
        suppress_embeds: bool = True,
    ):
        """Post ``text`` as a single Discord message (no chunk-splitting)
        and return the resulting :class:`discord.Message`."""
        if not text or not text.strip():
            return None
        ch = channel_or_env
        if isinstance(channel_or_env, str):
            ch = self.channel(channel_or_env, persona=persona)
        if ch is None:
            return None
        body = text if len(text) <= 1990 else text[:1990].rstrip() + "…"
        return await ch.send(body, suppress_embeds=suppress_embeds)


# ---------- locking ----------


class JobLocked(Exception):
    """Raised when a job can't acquire a lock because another *running*
    job holds it. Catch it and surface a friendly "already running"
    message."""

    def __init__(self, asset: str, holder: dict[str, Any]) -> None:
        self.asset = asset
        self.holder = holder
        super().__init__(
            f"asset {asset!r} is locked by job "
            f"{holder.get('job', '?')!r} (started {holder.get('started_at', '?')})"
        )

    @property
    def holder_desc(self) -> str:
        return f"`{self.holder.get('job', '?')}`, started {self.holder.get('started_at', '?')} UTC"


@contextmanager
def job_lock(assets: list[str], job: str) -> Iterator[None]:
    """Hold ``assets`` for the duration of the block; release on exit.

    Raises :class:`JobLocked` if any asset is held by another live job.
    Locks held by a dead process are stolen.
    """
    acquired: list[str] = []
    pid = os.getpid()
    try:
        for asset in assets:
            holder = db.acquire_job_lock(asset=asset, job=job, pid=pid)
            if holder is not None:
                raise JobLocked(asset, holder)
            acquired.append(asset)
        yield
    finally:
        for asset in acquired:
            try:
                db.release_job_lock(asset)
            except Exception:  # noqa: BLE001
                logger.exception("job: failed to release lock on %s", asset)
