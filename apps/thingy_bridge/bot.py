"""thingy_bridge entrypoint.

Run with ``python -m apps.thingy_bridge.bot`` from the repo root.

Spins up a single discord.py Client (the Thingy bot), runs DB
migrations, registers the ``/thingy`` slash tree, and starts the
hourly ``thingy-watch`` APScheduler job. The reader-facing answering
behavior lives in :class:`apps.thingy_bridge.personas.thingy.ThingyBot`
— ``on_message`` forwards each question to the Lambda's ``/chat`` SSE
endpoint and posts the streamed answer.

Author-facing personas (Eddy, Linky, Marky, Patty) run in the separate
``apps.workshop_bot.bot`` process. See ``apps/thingy_bridge/README.md``
for the two-process launch story.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import time
from pathlib import Path

import discord
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
# zombie state (lib thinks WS is open, Discord disagrees, no events
# arrive). The watchdog records the wall-clock of every dispatched
# gateway event; if nothing fires for STALE_SECS, we exit so launchd's
# KeepAlive respawns the process with a fresh session. A populated
# Discord guild produces PRESENCE_UPDATE / TYPING_START / GUILD_*
# events constantly, so even on a quiet night 10 min of total silence
# means something is wrong.
WATCHDOG_STALE_SECS = 600.0
WATCHDOG_CHECK_SECS = 60.0


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
    stale_secs: float = WATCHDOG_STALE_SECS,
    check_secs: float = WATCHDOG_CHECK_SECS,
) -> None:
    """Detect a silent-zombie gateway and exit so launchd respawns.

    Hooks ``on_socket_event_type`` (fires on every dispatched gateway
    event — READY, MESSAGE_CREATE, PRESENCE_UPDATE, TYPING_START, etc.)
    and stamps a monotonic clock. Every ``check_secs`` we verify the
    last event is within ``stale_secs``. On miss we ``os._exit(1)``
    rather than ``sys.exit`` because the asyncio loop may itself be
    wedged — we want the process gone immediately.
    """
    last_event_at = time.monotonic()

    # discord.Client (the base PersonaBot inherits) has no
    # ``add_listener`` — that's a ``ext.commands.Bot`` method. The
    # documented Client API is ``bot.event(coro)``, which registers
    # the coroutine under its own ``__name__``. So the inner function
    # is named ``on_socket_event_type`` to match.
    async def on_socket_event_type(event_type: str) -> None:  # noqa: ARG001
        nonlocal last_event_at
        last_event_at = time.monotonic()

    bot.event(on_socket_event_type)

    # Don't start the staleness clock until we've actually connected.
    # If we time out waiting for ready, arm anyway — that itself is a
    # symptom worth catching.
    try:
        await asyncio.wait_for(bot.ready_event.wait(), timeout=READY_WAIT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning(
            "watchdog: bot didn't become ready within %.0fs; arming anyway",
            READY_WAIT_SECONDS,
        )
    last_event_at = time.monotonic()
    logger.info("watchdog: armed (stale threshold %.0fs)", stale_secs)

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=check_secs)
            return  # stop requested — clean shutdown path
        except asyncio.TimeoutError:
            pass

        if bot.is_closed():
            logger.error(
                "watchdog: bot.is_closed() is True; exiting so launchd restarts us"
            )
            os._exit(1)

        idle = time.monotonic() - last_event_at
        if idle > stale_secs:
            logger.error(
                "watchdog: no gateway events for %.0fs (threshold %.0fs); "
                "exiting so launchd restarts us",
                idle, stale_secs,
            )
            os._exit(1)


async def run() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY is not set (required for thingy-watch assessment calls)")
        return 2
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

    scheduler_enabled = (
        os.environ.get("THINGY_BRIDGE_SCHEDULER_ENABLED", "1").strip() not in ("0", "false", "")
    )
    runner = SchedulerRunner(team, deps=deps) if scheduler_enabled else None

    async def _post_ready() -> None:
        try:
            await asyncio.wait_for(bot.ready_event.wait(), timeout=READY_WAIT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning("Thingy not ready after %ds; scheduler will start anyway", READY_WAIT_SECONDS)
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
