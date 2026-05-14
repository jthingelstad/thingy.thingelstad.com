"""Declarative scheduled jobs for the bridge.

For the bridge there's just one job — the hourly ``thingy-watch`` that
pulls conversations from the Lambda. The actual JobSpec entry lands in
commit 4 alongside ``scheduler/handlers.py``; this module starts as a
stub so the runner can import cleanly while the supporting
infrastructure is being built.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, TYPE_CHECKING

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


JOBS: tuple[JobSpec, ...] = ()  # populated in commit 4


def by_id(job_id: str) -> JobSpec | None:
    for job in JOBS:
        if job.id == job_id:
            return job
    return None
