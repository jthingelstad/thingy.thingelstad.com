"""HTTP/SSE client for the Thingy Lambda.

Bridges the Discord workshop bot to the production Librarian Lambda. The
bot owns three functions here:

  - ``get_or_refresh_token(discord_user_id)`` — mints a session token via
    the Lambda's ``/auth?action=discord_bridge`` action and caches it
    in SQLite. Returns a usable token string.
  - ``chat_stream(token, message, history)`` — POSTs ``/chat`` and yields
    the parsed SSE events.
  - ``submit_feedback(token, request_id, reaction)`` — POSTs ``/feedback``.

The client is httpx-async so the persona's discord.py event loop stays
responsive during the 5-15s Lambda turn.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, AsyncIterator, Optional

import httpx

from . import db

logger = logging.getLogger("thingy_bridge.thingy_client")

# Refresh tokens this many seconds before they actually expire so an
# in-flight chat request never trips an "expired" rejection mid-stream.
REFRESH_BUFFER_SECS = 600

# Lambda streams take a few seconds to start. The end-to-end ceiling
# matches what the web frontend uses for long Thingy turns.
DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=10.0)


class ThingyError(Exception):
    """Raised when the bridge can't reach the Lambda or the Lambda
    rejects a request. The message is safe to surface to Discord."""


def _api_base() -> str:
    value = (os.environ.get("LIBRARIAN_API_URL") or "").strip().rstrip("/")
    if not value:
        raise ThingyError("LIBRARIAN_API_URL is not set; bridge disabled")
    return value


def _stream_base() -> str:
    value = (os.environ.get("LIBRARIAN_STREAM_URL") or "").strip().rstrip("/")
    if not value:
        raise ThingyError("LIBRARIAN_STREAM_URL is not set; bridge disabled")
    return value


def _bridge_secret() -> str:
    secret = os.environ.get("LIBRARIAN_BRIDGE_SECRET", "").strip()
    if not secret:
        raise ThingyError("LIBRARIAN_BRIDGE_SECRET is not set; bridge disabled")
    return secret


# ---------- auth ----------

class TokenResult:
    """Return value from :func:`get_or_refresh_token`. Carries the token
    plus enough context for the persona to decide whether to greet a
    returning user."""

    __slots__ = ("token", "fresh", "profile")

    def __init__(self, *, token: str, fresh: bool, profile: Optional[dict[str, Any]]):
        self.token = token
        self.fresh = fresh
        self.profile = profile or {}


async def get_or_refresh_token(discord_user_id: str) -> TokenResult:
    """Return a valid Lambda session token for the given Discord user.

    Reuses a cached token if present and not within the refresh buffer of
    expiry; otherwise mints a fresh one via the Lambda's
    ``/auth?action=discord_bridge`` endpoint and caches it. The cached
    auth-response ``profile`` is returned alongside the token so the
    persona can offer a "welcome back" prompt for returning users.
    """
    cached = db.get_thingy_token(discord_user_id)
    now = int(time.time())
    if cached and int(cached.get("expires_at", 0)) - REFRESH_BUFFER_SECS > now:
        profile = cached.get("profile") if isinstance(cached.get("profile"), dict) else None
        return TokenResult(
            token=str(cached["token"]), fresh=False, profile=profile,
        )

    secret = _bridge_secret()
    payload = {
        "action": "discord_bridge",
        "bridge_secret": secret,
        "discord_user_id": discord_user_id,
        "source": "discord",
    }
    url = f"{_api_base()}/auth"

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
    except httpx.RequestError as exc:
        raise ThingyError(f"Could not reach Thingy auth: {exc}") from exc

    if resp.status_code != 200:
        try:
            body = resp.json()
            err = body.get("error") or f"HTTP {resp.status_code}"
        except Exception:  # noqa: BLE001
            err = f"HTTP {resp.status_code}"
        raise ThingyError(f"Thingy auth rejected: {err}")

    data = resp.json() or {}
    token = data.get("token")
    expires_at = data.get("expires_at")
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else None
    if not token or not expires_at:
        raise ThingyError("Thingy auth returned no token")

    db.upsert_thingy_token(
        discord_user_id=discord_user_id,
        token=str(token),
        expires_at=int(expires_at),
        profile=profile,
    )
    logger.info(
        "thingy: minted token for discord user (expires in %ds, returning=%s)",
        int(expires_at) - now,
        bool(profile and profile.get("returning")),
    )
    return TokenResult(token=str(token), fresh=True, profile=profile)


async def get_token(discord_user_id: str) -> str:
    """Backwards-compatible helper for code paths that just need a token
    string (e.g. the feedback handler). Discards the freshness signal."""
    result = await get_or_refresh_token(discord_user_id)
    return result.token


# ---------- chat (SSE) ----------

async def chat_stream(
    *,
    token: str,
    message: str,
    history: Optional[list[dict[str, str]]] = None,
    scope: Optional[str] = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yield ``(event_name, data_dict)`` tuples from the Lambda's SSE stream.

    Yields events as the Lambda emits them: ``meta`` once at start,
    ``status`` updates, ``answer_delta`` chunks, ``citations`` once after
    the answer, ``done`` at the end. ``error`` is raised as a
    ``ThingyError``.

    ``scope`` selects which corpus the Lambda searches
    (``weekly_thing`` / ``blog`` / ``podcast`` / ``both`` / ``all``); omit it and the Lambda
    defaults to the API's broad reader-facing corpus policy.
    """
    url = f"{_stream_base()}/chat"
    body: dict[str, Any] = {"message": message, "history": history or []}
    if scope:
        body["scope"] = scope
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "text/event-stream",
    }

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code != 200:
                    text = await resp.aread()
                    raise ThingyError(
                        f"Thingy chat HTTP {resp.status_code}: "
                        f"{text.decode('utf-8', errors='replace')[:200]}"
                    )
                # Parse SSE: event blocks are separated by blank lines;
                # each block has lines like "event: foo" / "data: {...}".
                buf = ""
                async for chunk in resp.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        block, buf = buf.split("\n\n", 1)
                        parsed = _parse_sse_block(block)
                        if parsed is None:
                            continue
                        event_name, data = parsed
                        if event_name == "error":
                            raise ThingyError(
                                str(data.get("error") or "Thingy returned an error")
                            )
                        yield event_name, data
                # flush any trailing partial block
                if buf.strip():
                    parsed = _parse_sse_block(buf)
                    if parsed:
                        event_name, data = parsed
                        if event_name == "error":
                            raise ThingyError(
                                str(data.get("error") or "Thingy returned an error")
                            )
                        yield event_name, data
    except httpx.RequestError as exc:
        raise ThingyError(f"Could not reach Thingy chat: {exc}") from exc


def _parse_sse_block(block: str) -> Optional[tuple[str, dict[str, Any]]]:
    """Parse one SSE block. Returns ``(event_name, data)`` or None."""
    event_name = "message"
    data_lines: list[str] = []
    for line in block.splitlines():
        line = line.rstrip("\r")
        if not line or line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].lstrip())
    if not data_lines:
        return None
    raw = "\n".join(data_lines)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return event_name, {"raw": raw}
    if not isinstance(data, dict):
        return event_name, {"value": data}
    return event_name, data


# ---------- feedback ----------

async def submit_feedback(
    *, token: str, request_id: str, reaction: str
) -> bool:
    """Submit a 👍/👎 reaction to the Lambda's /feedback endpoint."""
    url = f"{_stream_base()}/feedback"
    payload = {"request_id": request_id, "reaction": reaction}
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.RequestError as exc:
        logger.warning("thingy feedback failed: %s", exc)
        return False
    if resp.status_code != 200:
        logger.warning("thingy feedback HTTP %s: %s", resp.status_code, resp.text[:200])
        return False
    return True
