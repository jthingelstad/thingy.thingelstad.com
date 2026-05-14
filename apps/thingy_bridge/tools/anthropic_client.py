"""Anthropic client + prompt loading for the bridge.

The bridge's only LLM call is the one-shot conversation-assessment
inside ``jobs/watch.py``. No agent loop, no tool use — just
``client.messages.create()`` with a fixed system prompt asking for
JSON.

Prompts live in ``apps/thingy_bridge/prompts/{name}.md``.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import anthropic

REPO = Path(__file__).resolve().parents[3]
PROMPTS_DIR = REPO / "apps" / "thingy_bridge" / "prompts"

MODELS = {
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7",
    "haiku": "claude-haiku-4-5-20251001",
}

FALLBACK_MODEL = "sonnet"
MAX_OUTPUT_TOKENS = 4096
# The bridge only does one-shot assessment calls — 30s is plenty.
DEFAULT_API_TIMEOUT_SECS = 60.0


def default_model() -> str:
    raw = (os.environ.get("THINGY_BRIDGE_MODEL") or FALLBACK_MODEL).lower()
    return raw if raw in MODELS else FALLBACK_MODEL


logger = logging.getLogger("thingy_bridge.anthropic")

# Prompts are cached in-process at first read.
_prompt_cache: dict[str, str] = {}
_client: Optional[anthropic.Anthropic] = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(timeout=DEFAULT_API_TIMEOUT_SECS)
    return _client


def _resolve_prompt_path(name: str) -> Path:
    """Map a prompt name to its on-disk path under prompts/.

    The bridge has a flat prompts/ layout (no per-persona subdirs), so
    ``"review-conversation"`` → ``prompts/review-conversation.md``.
    """
    return PROMPTS_DIR / f"{name}.md"


def load_prompt(name: str) -> str:
    if name not in _prompt_cache:
        _prompt_cache[name] = _resolve_prompt_path(name).read_text(encoding="utf-8").strip()
    return _prompt_cache[name]
