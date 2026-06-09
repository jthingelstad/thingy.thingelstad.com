"""HTTP client for Thingy's Discord bridge API calls."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger("thingy_bridge.thingy_client")

DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=10.0)


class ThingyError(Exception):
    """Raised when the bridge cannot reach Thingy or the API rejects a request."""


def _api_base() -> str:
    value = (os.environ.get("LIBRARIAN_API_URL") or "").strip().rstrip("/")
    if not value:
        raise ThingyError("LIBRARIAN_API_URL is not set")
    return value


def _stream_base() -> str:
    value = (os.environ.get("LIBRARIAN_STREAM_URL") or "").strip().rstrip("/")
    if not value:
        raise ThingyError("LIBRARIAN_STREAM_URL is not set")
    return value


def _bridge_secret() -> str:
    secret = os.environ.get("LIBRARIAN_BRIDGE_SECRET", "").strip()
    if not secret:
        raise ThingyError("LIBRARIAN_BRIDGE_SECRET is not set")
    return secret


async def _post_json(base: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.post(url, json=payload)
    except httpx.RequestError as exc:
        raise ThingyError(f"Could not reach Thingy: {exc}") from exc
    data = response.json() if response.content else {}
    if response.status_code >= 400:
        error = data.get("error") if isinstance(data, dict) else None
        raise ThingyError(error or f"HTTP {response.status_code}")
    return data if isinstance(data, dict) else {}


async def start_discord_link(identity: dict[str, str]) -> dict[str, Any]:
    payload = {
        "action": "discord_link_start",
        "bridge_secret": _bridge_secret(),
        **identity,
    }
    return await _post_json(_api_base(), "/auth", payload)


async def confirm_discord_link(*, code: str, identity: dict[str, str]) -> dict[str, Any]:
    payload = {
        "action": "discord_link_confirm",
        "bridge_secret": _bridge_secret(),
        "code": str(code or "").strip(),
        **identity,
    }
    return await _post_json(_api_base(), "/auth", payload)


async def discord_mention(*, identity: dict[str, str], message: str, context: Optional[list[dict[str, str]]] = None) -> dict[str, Any]:
    payload = {
        "bridge_secret": _bridge_secret(),
        "message": message,
        "context": context or [],
        **identity,
    }
    return await _post_json(_stream_base(), "/discord/mention", payload)


def _parse_sse_block(block: str) -> Optional[tuple[str, dict[str, Any]]]:
    """Parse one SSE block. Retained for render/parser unit tests."""
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in block.splitlines():
        line = raw_line.rstrip("\r")
        if not line or line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[len("event:"):].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].strip())
    if not data_lines:
        return None
    raw_data = "\n".join(data_lines)
    try:
        parsed = json.loads(raw_data)
        data = parsed if isinstance(parsed, dict) else {"value": parsed}
    except json.JSONDecodeError:
        data = {"raw": raw_data}
    return event_name, data
