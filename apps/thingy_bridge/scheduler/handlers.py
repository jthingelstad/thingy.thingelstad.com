"""Scheduler handlers for the bridge.

Just the one — ``thingy-watch`` invoked hourly from
``scheduler/jobs.py``. The handler shape mirrors workshop_bot's
``content_job`` but only routes the single ``watch`` entrypoint.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("thingy_bridge.scheduler.handlers")


async def thingy_watch(ctx) -> None:
    """Fire the hourly conversation-mirror job. Lazy import so this
    module loads without pulling the watch graph at startup."""
    from ..jobs import watch as watch_job
    result = await watch_job.watch(ctx)
    logger.info("scheduler thingy-watch: %s", result.message)
