"""Tests for the Thingy Discord bridge.

Covers the pure-Python pieces (citation rewriting, history compaction,
SSE block parsing, db helpers). The persona itself integrates with
discord.py + httpx and is exercised manually; we don't try to mock the
whole event loop here.
"""

from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))


def _install_stubs() -> None:
    if "discord" not in sys.modules:
        discord = types.ModuleType("discord")

        class _Client:
            def __init__(self, *a, **k):
                self.user = None

        class _Intents:
            message_content = False
            guilds = False

            @staticmethod
            def default():
                return _Intents()

        discord.Client = _Client  # type: ignore[attr-defined]
        discord.Intents = _Intents  # type: ignore[attr-defined]
        discord.Message = object  # type: ignore[attr-defined]
        discord.RawReactionActionEvent = object  # type: ignore[attr-defined]
        discord.DiscordException = Exception  # type: ignore[attr-defined]
        abc_mod = types.ModuleType("discord.abc")
        abc_mod.Messageable = object  # type: ignore[attr-defined]
        sys.modules["discord"] = discord
        sys.modules["discord.abc"] = abc_mod

    if "anthropic" not in sys.modules:
        anthropic = types.ModuleType("anthropic")

        class _A:
            def __init__(self, *a, **k):
                pass

        anthropic.Anthropic = _A  # type: ignore[attr-defined]
        sys.modules["anthropic"] = anthropic

    if "httpx" not in sys.modules:
        httpx = types.ModuleType("httpx")

        class _Timeout:
            def __init__(self, *a, **k):
                pass

        class _RequestError(Exception):
            pass

        class _AsyncClient:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        httpx.Timeout = _Timeout  # type: ignore[attr-defined]
        httpx.RequestError = _RequestError  # type: ignore[attr-defined]
        httpx.AsyncClient = _AsyncClient  # type: ignore[attr-defined]
        sys.modules["httpx"] = httpx


_install_stubs()


from apps.thingy_bridge.tools import db, thingy_client, thingy_render  # noqa: E402


class CitationInjectionTests(unittest.TestCase):
    """`WTNNN` (or legacy `#NNN`) references that match a citation become
    Discord links normalized to the `WT` prefix; references without a
    matching citation stay exactly as written."""

    def test_basic_replacement(self):
        out = thingy_render.inject_citations(
            "I wrote about RSS in #287 last year.",
            [{"issue_number": 287, "url": "/archive/287/", "subject": "RSS"}],
        )
        self.assertEqual(
            out,
            "I wrote about RSS in [WT287](<https://weekly.thingelstad.com/archive/287/>) last year.",
        )

    def test_wt_prefix_replacement(self):
        out = thingy_render.inject_citations(
            "I wrote about RSS in WT287 last year.",
            [{"issue_number": 287, "url": "/archive/287/", "subject": "RSS"}],
        )
        self.assertEqual(
            out,
            "I wrote about RSS in [WT287](<https://weekly.thingelstad.com/archive/287/>) last year.",
        )

    def test_wt_prefix_no_match_leaves_plain(self):
        out = thingy_render.inject_citations(
            "See WT999 for context.",
            [{"issue_number": 287, "url": "/archive/287/"}],
        )
        self.assertEqual(out, "See WT999 for context.")

    def test_no_match_leaves_plain(self):
        out = thingy_render.inject_citations(
            "See #999 for context.",
            [{"issue_number": 287, "url": "/archive/287/"}],
        )
        self.assertEqual(out, "See #999 for context.")

    def test_multiple_citations(self):
        out = thingy_render.inject_citations(
            "Both #287 and #301 cover this.",
            [
                {"issue_number": 287, "url": "/archive/287/"},
                {"issue_number": 301, "url": "/archive/301/"},
            ],
        )
        self.assertIn("[WT287](<https://weekly.thingelstad.com/archive/287/>)", out)
        self.assertIn("[WT301](<https://weekly.thingelstad.com/archive/301/>)", out)

    def test_word_boundary_preserved(self):
        # `#word` (non-numeric) should not be touched.
        out = thingy_render.inject_citations(
            "Tag #cybersecurity is rising.",
            [{"issue_number": 287, "url": "/archive/287/"}],
        )
        self.assertEqual(out, "Tag #cybersecurity is rising.")

    def test_absolute_url_preserved(self):
        out = thingy_render.inject_citations(
            "From #287 specifically.",
            [{"issue_number": 287, "url": "https://example.com/issues/287"}],
        )
        self.assertEqual(
            out,
            "From [WT287](<https://example.com/issues/287>) specifically.",
        )

    def test_custom_site_url(self):
        out = thingy_render.inject_citations(
            "See #5.",
            [{"issue_number": 5, "url": "/archive/5/"}],
            site_url="https://staging.example.com/",
        )
        self.assertEqual(out, "See [WT5](<https://staging.example.com/archive/5/>).")

    def test_empty_inputs_safe(self):
        self.assertEqual(thingy_render.inject_citations("", []), "")
        self.assertEqual(thingy_render.inject_citations("hi #1", None), "hi #1")
        self.assertEqual(thingy_render.inject_citations("hi", []), "hi")


class AssembleAndFormatTests(unittest.TestCase):
    def test_assemble_concats(self):
        self.assertEqual(
            thingy_render.assemble_answer(["Hello, ", "world", "!"]),
            "Hello, world!",
        )

    def test_format_for_discord_end_to_end(self):
        out = thingy_render.format_for_discord(
            ["I wrote about ", "RSS in #287 ", "last year."],
            [{"issue_number": 287, "url": "/archive/287/", "subject": "RSS"}],
        )
        self.assertEqual(
            out,
            "I wrote about RSS in [WT287](<https://weekly.thingelstad.com/archive/287/>) last year.",
        )

    def test_format_strips_outer_whitespace(self):
        out = thingy_render.format_for_discord(["\n  hello  \n\n"], [])
        self.assertEqual(out, "hello")


class HistoryCompactionTests(unittest.TestCase):
    """Mirrors apps/site/librarian.njk:662-674."""

    def test_drops_invalid_roles(self):
        out = thingy_render.compact_history([
            {"role": "user", "content": "hi"},
            {"role": "system", "content": "ignored"},
            {"role": "assistant", "content": "hello"},
            {"role": "tool", "content": "ignored"},
        ])
        self.assertEqual([m["role"] for m in out], ["user", "assistant"])

    def test_drops_empty_content(self):
        out = thingy_render.compact_history([
            {"role": "user", "content": ""},
            {"role": "assistant", "content": "hello"},
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["content"], "hello")

    def test_truncates_per_message(self):
        msg = "x" * 5000
        out = thingy_render.compact_history([{"role": "user", "content": msg}])
        self.assertEqual(len(out[0]["content"]), thingy_render.HISTORY_MAX_PER_MESSAGE_CHARS)

    def test_caps_message_count(self):
        raw = [
            {"role": "user", "content": f"q{i}"} for i in range(20)
        ]
        out = thingy_render.compact_history(raw)
        self.assertEqual(len(out), thingy_render.HISTORY_MAX_MESSAGES)
        # Most recent kept.
        self.assertEqual(out[-1]["content"], "q19")

    def test_caps_total_chars_keeps_last(self):
        # Eight messages of 700 chars each = 5600 > 4000 cap; should
        # trim from front but keep at least one.
        raw = [
            {"role": "user", "content": "x" * 700} for _ in range(8)
        ]
        out = thingy_render.compact_history(raw)
        self.assertGreaterEqual(len(out), 1)
        self.assertLessEqual(
            sum(len(m["content"]) for m in out),
            thingy_render.HISTORY_MAX_TOTAL_CHARS,
        )


class SseParserTests(unittest.TestCase):
    """SSE block parsing — the critical path for reading the Lambda's
    streamed response."""

    def test_event_and_data(self):
        block = "event: meta\ndata: {\"request_id\": \"abc\"}"
        parsed = thingy_client._parse_sse_block(block)
        self.assertIsNotNone(parsed)
        assert parsed is not None  # for type checkers
        name, data = parsed
        self.assertEqual(name, "meta")
        self.assertEqual(data, {"request_id": "abc"})

    def test_default_event_name(self):
        # SSE spec: events without `event:` line default to "message".
        block = "data: {\"x\": 1}"
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "message")
        self.assertEqual(data, {"x": 1})

    def test_skips_comment_lines(self):
        block = ":heartbeat\nevent: status\ndata: {\"message\": \"thinking\"}"
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "status")
        self.assertEqual(data["message"], "thinking")

    def test_no_data_returns_none(self):
        block = "event: ping"
        self.assertIsNone(thingy_client._parse_sse_block(block))

    def test_non_json_data_falls_through_as_raw(self):
        block = "event: error\ndata: not json"
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "error")
        self.assertEqual(data, {"raw": "not json"})

    def test_carriage_return_tolerated(self):
        block = "event: meta\r\ndata: {\"id\": 1}\r"
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "meta")
        self.assertEqual(data, {"id": 1})

    def test_multiline_data_field_concatenates(self):
        # SSE spec: multiple `data:` lines in a block concatenate with
        # newlines. We use this for multi-line tool result payloads.
        block = "event: status\ndata: line one\ndata: line two"
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "status")
        # Falls back to {"raw": ...} since the joined string isn't JSON.
        self.assertEqual(data, {"raw": "line one\nline two"})

    def test_block_with_only_event_line_skipped(self):
        # No `data:` line means nothing to yield.
        self.assertIsNone(thingy_client._parse_sse_block("event: ping\n:keepalive"))

    def test_data_with_json_array_top_level(self):
        # Defensively handle an SSE block whose JSON top-level is a list,
        # not an object. The runtime currently expects dicts so we wrap.
        block = 'event: citations\ndata: [{"issue_number": 1}]'
        parsed = thingy_client._parse_sse_block(block)
        assert parsed is not None
        name, data = parsed
        self.assertEqual(name, "citations")
        # Wrapped as {"value": [...]} so callers can dispatch uniformly.
        self.assertIn("value", data)


class ThingyDbHelperTests(unittest.TestCase):
    """End-to-end DB exercise of thingy_tokens + thingy_requests."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._orig_path = os.environ.get("THINGY_BRIDGE_DB_PATH")
        os.environ["THINGY_BRIDGE_DB_PATH"] = str(Path(self._tmpdir.name) / "test.db")
        db.run_migrations()

    def tearDown(self):
        if self._orig_path is None:
            os.environ.pop("THINGY_BRIDGE_DB_PATH", None)
        else:
            os.environ["THINGY_BRIDGE_DB_PATH"] = self._orig_path
        self._tmpdir.cleanup()

    def test_token_roundtrip(self):
        self.assertIsNone(db.get_thingy_token("user-1"))
        db.upsert_thingy_token(
            discord_user_id="user-1", token="abc.xyz", expires_at=1700000000,
        )
        row = db.get_thingy_token("user-1")
        assert row is not None
        self.assertEqual(row["token"], "abc.xyz")
        self.assertEqual(row["expires_at"], 1700000000)
        # Upsert overwrites.
        db.upsert_thingy_token(
            discord_user_id="user-1", token="new.tok", expires_at=1800000000,
        )
        row = db.get_thingy_token("user-1")
        assert row is not None
        self.assertEqual(row["token"], "new.tok")
        self.assertEqual(row["expires_at"], 1800000000)

    def test_request_roundtrip(self):
        rid = db.insert_thingy_request(
            discord_user_id="user-1",
            discord_message_id="111",
            question="what is RSS?",
        )
        self.assertGreater(rid, 0)
        db.update_thingy_request(
            rid, status="ok", request_id="lambda-req-1",
            bot_response_message_id="222", duration_ms=1234,
        )
        found = db.lookup_thingy_request_by_response("222")
        assert found is not None
        self.assertEqual(found["request_id"], "lambda-req-1")
        self.assertEqual(found["status"], "ok")
        self.assertEqual(found["discord_user_id"], "user-1")

    def test_lookup_unknown_response(self):
        self.assertIsNone(db.lookup_thingy_request_by_response("nonexistent"))

    def test_partial_update_only_changes_supplied_fields(self):
        rid = db.insert_thingy_request(
            discord_user_id="user-2", discord_message_id="aaa", question="?",
        )
        db.update_thingy_request(rid, status="ok")
        # Should not error if no fields supplied (safe no-op).
        db.update_thingy_request(rid)


class ProfileRoundtripTests(unittest.TestCase):
    """Profile snapshots are stored as JSON; reading back must hand
    back a dict (or None when never set)."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._orig_path = os.environ.get("THINGY_BRIDGE_DB_PATH")
        os.environ["THINGY_BRIDGE_DB_PATH"] = str(Path(self._tmpdir.name) / "test.db")
        db.run_migrations()

    def tearDown(self):
        if self._orig_path is None:
            os.environ.pop("THINGY_BRIDGE_DB_PATH", None)
        else:
            os.environ["THINGY_BRIDGE_DB_PATH"] = self._orig_path
        self._tmpdir.cleanup()

    def test_no_profile_round_trips_as_none(self):
        db.upsert_thingy_token(
            discord_user_id="u1", token="t", expires_at=1700000000,
        )
        row = db.get_thingy_token("u1")
        assert row is not None
        self.assertIsNone(row.get("profile"))

    def test_profile_round_trips(self):
        profile = {
            "returning": True,
            "turn_count": 3,
            "prior_session_summaries": [{"summary": "RSS week"}],
        }
        db.upsert_thingy_token(
            discord_user_id="u2", token="t", expires_at=1700000000,
            profile=profile,
        )
        row = db.get_thingy_token("u2")
        assert row is not None
        self.assertEqual(row["profile"], profile)

    def test_run_migrations_idempotent(self):
        # Running migrations twice on the same DB shouldn't fail or
        # duplicate columns.
        db.run_migrations()
        db.run_migrations()
        # Token table still works.
        db.upsert_thingy_token(
            discord_user_id="u-migr", token="t", expires_at=1700000000,
        )
        self.assertIsNotNone(db.get_thingy_token("u-migr"))


if __name__ == "__main__":
    unittest.main()
