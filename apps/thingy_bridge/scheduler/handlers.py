"""Scheduler handlers for the bridge.

No recurring jobs are registered today. Thingy conversation review
notifications are emitted by the Librarian API's evaluator Lambda via
Discord webhook, so the bridge has no polling handler to run.
"""

from __future__ import annotations

__all__: tuple[str, ...] = ()
