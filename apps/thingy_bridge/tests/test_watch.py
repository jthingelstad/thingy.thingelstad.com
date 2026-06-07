"""Tests for the canonical Thingy operator conversation views."""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from apps.thingy_bridge.tests import _stubs  # noqa: E402

_stubs.install()

from apps.thingy_bridge.jobs import _base, watch as thingy_job  # noqa: E402


def _summary(conversation_id="conv-1", sub="abcdef123456", *, posted=""):
    return {
        "id": conversation_id,
        "conversation_id": conversation_id,
        "subscriber_hash": sub,
        "title": "Tell me about RSS",
        "created_at": "2026-06-07T10:00:00Z",
        "updated_at": "2026-06-07T10:03:00Z",
        "last_message_at": "2026-06-07T10:03:00Z",
        "turn_count": 2,
        "eval_status": "reviewed",
        "eval_quality": "clean",
        "eval_topic": "RSS in the archive",
        "eval_reader": "Reader wanted a grounded archive answer.",
        "eval_thingy": "Thingy answered well and cited relevant sources.",
        "eval_takeaway": "nothing to act on — clean exchange",
        "eval_flags": ["reader_delight"],
        "eval_improvements": [],
        "eval_posted_to_chatter_at": posted,
    }


def _turn(request_id="r1", *, feedback=""):
    return {
        "request_id": request_id,
        "conversation_id": "conv-1",
        "created_at": "2026-06-07T10:00:00Z",
        "question": "Did Jamie write about RSS?",
        "answer": "Yes, repeatedly, including WT200.",
        "citations": [{"issue_number": "200", "subject": "RSS"}],
        "feedback_reaction": feedback,
        "feedback_comment": "Helpful context." if feedback else "",
        "preflight": {"action": "pass", "category": "archive_answer"},
        "tool_names": ["archive_lens", "get_source"],
    }


class RenderTests(unittest.TestCase):
    def test_card_uses_api_eval_fields(self):
        card = thingy_job._card(_summary())
        self.assertIn("Thingy · `conv-1`", card)
        self.assertIn("clean", card)
        self.assertIn("**Reader:** Reader wanted", card)
        self.assertIn("**Thingy:** Thingy answered", card)
        self.assertIn("/thingy show id:conv-1", card)

    def test_transcript_includes_feedback_preflight_tools_and_sources(self):
        md = thingy_job._transcript_md(_summary(), [_turn(feedback="down")])
        self.assertNotIn("## Assessment", md)
        self.assertNotIn("nothing to act on", md)
        self.assertIn("Reader feedback: down — Helpful context.", md)
        self.assertIn("Preflight: archive_answer/pass", md)
        self.assertIn("Tools: archive_lens, get_source", md)
        self.assertIn("Cited: WT200", md)


class ReadCommandTests(unittest.TestCase):
    def test_recent_reads_reviewed_rows_from_api(self):
        with patch.object(thingy_job.thingy_client, "fetch_operator_conversations", AsyncMock(return_value=[_summary()])):
            res = asyncio.run(thingy_job.recent(_base.JobContext(), count=8))
        self.assertTrue(res.ok)
        self.assertIn("Recent reviewed Thingy conversations", res.message)
        self.assertIn("conv-1", res.message)

    def test_show_fetches_canonical_transcript(self):
        with patch.object(
            thingy_job.thingy_client,
            "fetch_operator_conversation",
            AsyncMock(return_value={"conversation": _summary(), "turns": [_turn()]}),
        ) as fetch:
            res = asyncio.run(thingy_job.show(_base.JobContext(), conv_id="conv-1"))
        self.assertTrue(res.ok)
        fetch.assert_awaited_once_with(conversation_id="conv-1")
        self.assertIn("Transcript attached", res.message)
        self.assertNotIn("**Reader:** Reader wanted", res.message)
        self.assertIn("Did Jamie write about RSS?", res.data["transcript_md"])


class SlashCommandShapeTests(unittest.TestCase):
    def test_show_command_accepts_string_id(self):
        from apps.thingy_bridge import commands

        class Bot:
            def __init__(self):
                self.tree = type("Tree", (), {"add_command": lambda _self, group: None})()

        root = commands.register_thingy_commands(Bot())
        thingy = next(g for g in root.groups if getattr(g, "_cmd_name", None) == "thingy")
        self.assertEqual({getattr(c, "_cmd_name", None) for c in thingy.commands}, {"recent", "show", "new", "scope"})


if __name__ == "__main__":
    unittest.main()
