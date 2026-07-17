"""thingy_bridge entrypoint.

Run with ``uv run python -m apps.thingy_bridge.bot``
from the repo root.

Spins up a single discord.py Client (the Thingy bot), runs DB
migrations, registers the ``/thingy`` slash tree, and starts the
bridge scheduler if any local jobs are registered. The reader-facing
answering behavior lives in
:class:`apps.thingy_bridge.personas.thingy.ThingyBot` — ``on_message``
forwards each question to the Lambda's ``/chat`` SSE endpoint and posts
the streamed answer.

Author-facing personas (Eddy, Linky, Marky, Patty) run in the separate
``apps.workshop_bot.bot`` process. See ``apps/thingy_bridge/README.md``
for the two-process launch story.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import signal
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from .commands import register_thingy_commands
from .personas.team import TeamRegistry
from .personas.thingy import ThingyBot
from .scheduler.runner import Runner as SchedulerRunner
from .tools import db

logger = logging.getLogger("thingy_bridge.bot")

# Per-persona ceiling on waiting for on_ready before declaring the persona
# missing. Discord login + gateway + READY typically lands in <60s; 90s is
# slack so a transient blip doesn't cancel the scheduler.
READY_WAIT_SECONDS = 90.0

# Gateway-watchdog thresholds. discord.py's KeepAlive should detect a
# dead gateway and reconnect, but we've seen it fall into a silent-
# zombie state (lib thinks WS is open, Discord disagrees). The watchdog
# tracks gateway-heartbeat health: ``bot.latency`` updates on every
# HEARTBEAT_ACK (~every 41s for Discord). When ACKs stop, the value
# stops changing — that's our signal the connection is dead regardless
# of whether the guild has any activity. 120s = ~3× the heartbeat
# interval, with margin for jitter. Activity-based watchdogs false-fire
# on quiet private guilds; heartbeat-based does not.
WATCHDOG_ACK_STALE_SECS = 120.0
WATCHDOG_CHECK_SECS = 30.0
# Grace period after on_ready before we start enforcing — first
# heartbeat ACK can take a moment, and reconnects briefly show
# latency=inf.
WATCHDOG_GRACE_SECS = 90.0


def configure_logging() -> None:
    level_name = os.environ.get("THINGY_BRIDGE_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    log_file = os.environ.get(
        "THINGY_BRIDGE_LOG_FILE",
        str(Path(__file__).resolve().parent / "logs" / "bridge.log"),
    )
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)

    fmt = logging.Formatter(
        fmt="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    handlers: list[logging.Handler] = [logging.FileHandler(log_file)]
    if sys.stderr.isatty():
        handlers.append(logging.StreamHandler(sys.stderr))

    root = logging.getLogger()
    root.setLevel(level)
    for h in handlers:
        h.setFormatter(fmt)
        root.addHandler(h)

    # Quiet discord.py's gateway noise unless DEBUG is on.
    if level > logging.DEBUG:
        logging.getLogger("discord").setLevel(logging.WARNING)


async def _gateway_watchdog(
    bot: ThingyBot,
    stop_event: asyncio.Event,
    *,
    ack_stale_secs: float = WATCHDOG_ACK_STALE_SECS,
    grace_secs: float = WATCHDOG_GRACE_SECS,
    check_secs: float = WATCHDOG_CHECK_SECS,
) -> None:
    """Detect a silent-zombie gateway via heartbeat-ACK staleness.

    Discord's gateway sends our bot a HEARTBEAT every ~41s; discord.py
    updates ``bot.latency`` on each HEARTBEAT_ACK. When ACKs stop, the
    value stops changing — that's our signal the connection is
    silently dead regardless of guild activity. We watch
    ``bot.latency`` change-events and exit when no change has been
    seen for ``ack_stale_secs`` (default 120s, ~3× Discord's heartbeat
    interval).

    Activity-based watchdogs (track on_socket_event_type) false-fire
    on quiet private guilds, since PRESENCE_UPDATE requires the
    privileged presences intent (which we don't request) and a small
    guild may go many minutes with no TYPING_START or MESSAGE_CREATE.
    Heartbeats fire regardless of activity.

    We ``os._exit(1)`` rather than ``sys.exit`` because the asyncio
    loop may itself be wedged — we want the process gone immediately
    so launchd's KeepAlive respawns it.
    """
    last_latency: float | None = None
    last_change_at = time.monotonic()

    # Don't enforce until the bot has had time to connect + receive a
    # first ACK. Reconnect cycles briefly show latency=inf.
    try:
        await asyncio.wait_for(bot.ready_event.wait(), timeout=READY_WAIT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning(
            "watchdog: bot didn't become ready within %.0fs; arming anyway",
            READY_WAIT_SECONDS,
        )
    armed_at = time.monotonic()
    last_change_at = armed_at
    logger.info(
        "watchdog: armed (no-ack threshold %.0fs, grace %.0fs)",
        ack_stale_secs,
        grace_secs,
    )

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=check_secs)
            return  # stop requested — clean shutdown path
        except asyncio.TimeoutError:
            pass

        if bot.is_closed():
            logger.error("watchdog: bot.is_closed() is True; exiting so launchd restarts us")
            os._exit(1)

        current = bot.latency  # float seconds, or inf when no WS / no ACK yet
        now = time.monotonic()
        since_armed = now - armed_at
        if not math.isfinite(current):
            # No heartbeat yet (or mid-reconnect). Tolerate during the
            # grace window. After that, treat it as a zombie signal.
            if since_armed > grace_secs + ack_stale_secs:
                logger.error(
                    "watchdog: bot.latency has been non-finite for %.0fs "
                    "(grace %.0fs + threshold %.0fs); exiting so launchd "
                    "restarts us",
                    since_armed,
                    grace_secs,
                    ack_stale_secs,
                )
                os._exit(1)
            continue

        if last_latency is None or current != last_latency:
            last_latency = current
            last_change_at = now
            continue

        stale = now - last_change_at
        if since_armed > grace_secs and stale > ack_stale_secs:
            logger.error(
                "watchdog: bot.latency hasn't changed in %.0fs "
                "(threshold %.0fs); HEARTBEAT_ACKs have stopped — "
                "exiting so launchd restarts us",
                stale,
                ack_stale_secs,
            )
            os._exit(1)


async def run() -> int:
    token = os.environ.get("DISCORD_TOKEN_THINGY")
    if not token:
        logger.error("DISCORD_TOKEN_THINGY is not set")
        return 2

    db.run_migrations()

    team = TeamRegistry()
    bot = ThingyBot()
    # Mirror the workshop_bot pattern: a tiny `deps` object whose only
    # field the bridge uses is `team` (so JobContext.post can route
    # `persona="thingy"` through the team registry).

    class _Deps:
        pass

    deps = _Deps()
    deps.team = team  # type: ignore[attr-defined]
    bot.deps = deps  # type: ignore[attr-defined]
    team.register(bot)

    # Register the /thingy slash tree on the bot. Discord syncs it on
    # the first ready.
    tree = register_thingy_commands(bot)

    @bot.event
    async def on_ready() -> None:  # type: ignore[no-redef]
        # PersonaBot.on_ready already logs + sets ready_event; chain it.
        user = bot.user
        logger.info("Thingy online as %s (id=%s)", user, getattr(user, "id", "?"))
        bot.ready_event.set()
        try:
            synced = await tree.sync()
            logger.info("slash sync: %d command(s) registered", len(synced))
        except Exception:  # noqa: BLE001
            logger.exception("slash sync failed (commands won't appear until sync succeeds)")
        # Per-boot startup card in #chatter, matching the workshop_bot
        # personas. Idempotent across discord.py's reconnection-fires-
        # on_ready behaviour (single-shot flag on the bot).
        try:
            from .tools import startup

            await startup.post_startup_card(bot)
        except Exception:  # noqa: BLE001
            logger.exception("startup announce failed")

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _request_stop() -> None:
        if not stop_event.is_set():
            logger.info("stop requested; closing client...")
            stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # Windows
            pass

    async def _start() -> None:
        """Login + gateway loop. discord.py handles reconnection
        internally with `reconnect=True`; we only re-enter on harder
        failures (login refused, fatal gateway error)."""
        while not stop_event.is_set():
            try:
                await bot.login(token)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Thingy login failed")
                _request_stop()
                return
            try:
                await bot.connect(reconnect=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Thingy gateway dropped; will re-login in 30s")
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=30)
                    return
                except asyncio.TimeoutError:
                    continue
            return  # clean disconnect

    persona_task = asyncio.create_task(_start(), name="persona:thingy")

    scheduler_enabled = os.environ.get("THINGY_BRIDGE_SCHEDULER_ENABLED", "1").strip() not in (
        "0",
        "false",
        "",
    )
    runner = SchedulerRunner(team, deps=deps) if scheduler_enabled else None

    async def _post_ready() -> None:
        try:
            await asyncio.wait_for(bot.ready_event.wait(), timeout=READY_WAIT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning(
                "Thingy not ready after %ds; scheduler will start anyway", READY_WAIT_SECONDS
            )
        if runner is not None:
            try:
                runner.start()
            except Exception:  # noqa: BLE001
                logger.exception("scheduler: failed to start")

    ready_task = asyncio.create_task(_post_ready(), name="post-ready")
    watchdog_task = asyncio.create_task(
        _gateway_watchdog(bot, stop_event),
        name="gateway-watchdog",
    )

    try:
        await stop_event.wait()
    finally:
        if runner is not None:
            try:
                runner.shutdown()
            except Exception:  # noqa: BLE001
                logger.exception("scheduler: error during shutdown")
        try:
            await bot.close()
        except Exception:  # noqa: BLE001
            logger.exception("error while closing client")
        for task in (persona_task, ready_task, watchdog_task):
            task.cancel()
        await asyncio.gather(persona_task, ready_task, watchdog_task, return_exceptions=True)
    return 0


def main() -> int:
    load_dotenv()
    configure_logging()
    try:
        return asyncio.run(run())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
