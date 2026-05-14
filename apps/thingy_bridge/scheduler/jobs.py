"""Declarative scheduled jobs for the bridge.

One job: the hourly ``thingy-watch`` that pulls newly-logged
conversations from the Lambda's ``list_conversations`` endpoint and
mirrors them into ``thingy_conversations``. If a second cron job ever
lives here, add a second ``JobSpec`` entry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, TYPE_CHECKING

from . import handlers

if TYPE_CHECKING:
    from .runner import JobContext

DEFAULT_TZ = "America/Chicago"


@dataclass(frozen=True)
class JobSpec:
    id: str
    cron: str                                            # 5-field cron (M H DOM MON DOW)
    func: "Callable[[JobContext], Awaitable[None]]"      # async (ctx) -> None
    enabled: bool = True
    timezone: str = DEFAULT_TZ


JOBS: tuple[JobSpec, ...] = (
    JobSpec(
        id="thingy-watch",
        cron="7 * * * *",                                # Hourly at :07. Pulls newly-logged
                                                         # conversations from the Lambda, runs a
                                                         # one-shot Sonnet assessment of each new
                                                         # one, mirrors it locally, and posts a
                                                         # card to #chatter. PASSes silently when
                                                         # nothing new.
        func=handlers.thingy_watch,
    ),
)


def by_id(job_id: str) -> JobSpec | None:
    for job in JOBS:
        if job.id == job_id:
            return job
    return None
