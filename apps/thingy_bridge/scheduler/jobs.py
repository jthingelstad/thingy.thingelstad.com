"""Declarative scheduled jobs for the bridge.

Thingy conversation notifications are event-driven now: the Librarian
eval Lambda posts directly to Discord via webhook after reviewing a
conversation. This bridge keeps scheduler support for future local jobs,
but no recurring Thingy poller is registered.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Awaitable, Callable

if TYPE_CHECKING:
    from .runner import JobContext

DEFAULT_TZ = "America/Chicago"


@dataclass(frozen=True)
class JobSpec:
    id: str
    cron: str  # 5-field cron (M H DOM MON DOW)
    func: "Callable[[JobContext], Awaitable[None]]"  # async (ctx) -> None
    enabled: bool = True
    timezone: str = DEFAULT_TZ


JOBS: tuple[JobSpec, ...] = ()


def by_id(job_id: str) -> JobSpec | None:
    for job in JOBS:
        if job.id == job_id:
            return job
    return None
