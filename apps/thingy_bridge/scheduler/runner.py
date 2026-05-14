"""Run scheduled jobs against the bridge's Thingy client.

Trimmed sibling of workshop_bot/scheduler/runner.py: no AgentRun
logging (bridge keeps job traces in bridge.log only, not a DB table),
no team orchestration complexity (one persona).
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from ..tools import discord_io
from . import jobs as jobs_module

if TYPE_CHECKING:
    from ..personas.team import TeamRegistry

logger = logging.getLogger("thingy_bridge.scheduler")


class JobContext:
    """Per-fire context handed to each job function."""

    def __init__(
        self,
        *,
        team: "TeamRegistry",
        job: jobs_module.JobSpec,
        deps: Optional[object] = None,
    ) -> None:
        self.team = team
        self.job = job
        self.deps = deps

    def channel(self, env_var: str, *, persona: Optional[str] = None):
        """Resolve a Discord channel from an env var, optionally bound
        to a persona's client so ``channel.send`` posts under that
        avatar."""
        cid_raw = (os.environ.get(env_var) or "").strip()
        if not cid_raw:
            logger.warning("scheduler: %s not set; %s skipped", env_var, self.job.id)
            return None
        try:
            cid = int(cid_raw)
        except ValueError:
            logger.warning("scheduler: %s=%r not a channel id", env_var, cid_raw)
            return None
        if persona is not None:
            bot = self.team.bots.get(persona)
            if bot is None or bot.user is None:
                logger.warning("scheduler: persona %r not available for %s", persona, self.job.id)
                return None
            ch = bot.get_channel(cid)
            if ch is None:
                logger.warning("scheduler: channel %s not visible to %s", cid, persona)
            return ch
        for bot in self.team.bots.values():
            if bot.user is None:
                continue
            ch = bot.get_channel(cid)
            if ch is not None:
                return ch
        logger.warning("scheduler: channel %s not visible to any persona", cid)
        return None

    async def post(
        self,
        channel_or_env,
        text: str,
        *,
        persona: Optional[str] = None,
        suppress_embeds: bool = True,
    ) -> bool:
        """Post ``text`` (chunked) to a channel."""
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


class Runner:
    def __init__(self, team: "TeamRegistry", *, deps: Optional[object] = None) -> None:
        self.team = team
        self.deps = deps
        self.scheduler: Optional[AsyncIOScheduler] = None

    def start(self) -> None:
        self.scheduler = AsyncIOScheduler()
        n_added = 0
        for job in jobs_module.JOBS:
            if not job.enabled:
                logger.info("scheduler: skipping disabled job %s", job.id)
                continue
            try:
                trigger = CronTrigger.from_crontab(job.cron, timezone=job.timezone)
            except ValueError as exc:
                logger.error("scheduler: bad cron %r on %s: %s", job.cron, job.id, exc)
                continue
            self.scheduler.add_job(
                self._run,
                trigger=trigger,
                id=job.id,
                args=[job],
                name=job.id,
                replace_existing=True,
                misfire_grace_time=600,
                coalesce=True,
            )
            n_added += 1
        self.scheduler.start()
        logger.info("scheduler: started with %d job(s)", n_added)

    def shutdown(self) -> None:
        if self.scheduler is not None:
            self.scheduler.shutdown(wait=False)
            logger.info("scheduler: stopped")

    async def _run(self, job: jobs_module.JobSpec) -> None:
        logger.info("scheduler: firing %s", job.id)
        ctx = JobContext(team=self.team, job=job, deps=self.deps)
        try:
            await job.func(ctx)
            logger.info("scheduler: %s ok", job.id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("scheduler: %s failed", job.id)
            # Best-effort post a notice somewhere visible.
            ch = ctx.channel("DISCORD_CHANNEL_CHATTER", persona="thingy")
            if ch is not None:
                try:
                    await ctx.post(
                        ch,
                        f"⚠️ scheduled job `{job.id}` hit an error: "
                        f"`{type(exc).__name__}: {exc}`",
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("scheduler: also failed to post error notice")
