"""Tests for the Thingy conversation watcher + reads (jobs/watch.py),
the thingy_conversations db helpers, and the /thingy slash wiring."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from apps.thingy_bridge.tests import _stubs  # noqa: E402

_stubs.install()

from apps.thingy_bridge.jobs import _base, watch as thingy_job  # noqa: E402
from apps.thingy_bridge.tools import db  # noqa: E402


def _turn(rid, sub, created_at, *, q="q?", a="a.", history=0, issues=None, feedback=None):
    return {
        "request_id": rid, "subscriber_hash": sub, "created_at": created_at,
        "question": q, "answer": a, "history_count": history,
        "source_issues": issues or [], "citations": [{"issue_number": n} for n in (issues or [])],
        "feedback_reaction": feedback, "feedback_at": None, "user_agent": "UA",
    }


class GroupingTests(unittest.TestCase):
    def test_splits_by_subscriber_and_orders_by_last_turn(self):
        turns = [
            _turn("a1", "subA", "2026-05-12T01:00:00Z"),
            _turn("b1", "subB", "2026-05-12T01:01:00Z"),
            _turn("a2", "subA", "2026-05-12T01:02:00Z", history=1),
            _turn("b2", "subB", "2026-05-12T01:30:00Z", history=1),
        ]
        convos = thingy_job.group_into_conversations(turns)
        # subA: a1,a2 (3 min apart, same session) → one convo ending 01:02
        # subB: b1 then b2 (29 min apart — under the 30-min gap) → one convo ending 01:30
        self.assertEqual(len(convos), 2)
        ids = [[t["request_id"] for t in c] for c in convos]
        self.assertIn(["a1", "a2"], ids)
        self.assertIn(["b1", "b2"], ids)
        # ordered oldest-last-turn first
        self.assertEqual(convos[0][-1]["request_id"], "a2")
        self.assertEqual(convos[1][-1]["request_id"], "b2")

    def test_gap_and_fresh_history_each_split_a_conversation(self):
        turns = [
            _turn("t1", "s", "2026-05-12T01:00:00Z"),
            _turn("t2", "s", "2026-05-12T01:05:00Z", history=2),     # continues
            _turn("t3", "s", "2026-05-12T01:50:00Z", history=3),     # 45-min gap → new
            _turn("t4", "s", "2026-05-12T01:52:00Z", history=0),     # fresh browser history → new
        ]
        convos = thingy_job.group_into_conversations(turns)
        self.assertEqual([[t["request_id"] for t in c] for c in convos],
                         [["t1", "t2"], ["t3"], ["t4"]])


class RenderTests(unittest.TestCase):
    def test_anon_and_assessment_md(self):
        self.assertEqual(thingy_job._anon("abcdef0123456789"), "reader·abcdef")
        self.assertEqual(thingy_job._anon(""), "reader·anon")
        md = thingy_job._assessment_md({"reader": "R.", "thingy": "T.", "takeaway": "K."})
        self.assertIn("**Reader:** R.", md)
        self.assertIn("**Thingy:** T.", md)
        self.assertIn("**Takeaway:** K.", md)
        # blank fields drop out
        self.assertEqual(thingy_job._assessment_md({"reader": "only"}), "**Reader:** only")

    def test_card_includes_id_topic_and_pointer(self):
        conv = {
            "id": 5, "subscriber_hash": "abcdef00", "started_at": "2026-05-12T18:21:00Z",
            "ended_at": "2026-05-12T18:25:00Z", "turn_count": 2, "feedback": "up",
            "topic": "RSS readers", "assessment_md": "**Reader:** wants RSS\n**Thingy:** answered",
            "source_issues": ["200", "247"],
        }
        card = thingy_job._card(conv)
        self.assertIn("Thingy · #5", card)
        self.assertIn("reader·abcdef", card)
        self.assertIn("2 turns", card)
        self.assertIn("👍", card)
        self.assertIn("RSS readers", card)
        self.assertIn("WT200, WT247", card)
        self.assertIn("/thingy show 5", card)


class _DBCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig = os.environ.get("THINGY_BRIDGE_DB_PATH")
        os.environ["THINGY_BRIDGE_DB_PATH"] = str(Path(self._tmp.name) / "t.db")
        db.run_migrations()

    def tearDown(self):
        self._tmp.cleanup()
        if self._orig is None:
            os.environ.pop("THINGY_BRIDGE_DB_PATH", None)
        else:
            os.environ["THINGY_BRIDGE_DB_PATH"] = self._orig


class DbHelperTests(_DBCase):
    def test_insert_recent_get_watermark_seen(self):
        cid = db.insert_thingy_conversation(
            subscriber_hash="hhh111", started_at="2026-05-12T01:00:00Z", ended_at="2026-05-12T01:04:00Z",
            turn_count=2, transcript=[{"request_id": "r1"}, {"request_id": "r2"}],
            turn_request_ids=["r1", "r2"], source_issues=["200"], feedback="up",
            topic="t", assessment_md="**Reader:** x",
        )
        self.assertEqual(db.latest_thingy_conversation_end(), "2026-05-12T01:04:00Z")
        self.assertEqual(db.seen_thingy_turn_request_ids(), {"r1", "r2"})
        got = db.get_thingy_conversation(cid)
        self.assertEqual(got["transcript"], [{"request_id": "r1"}, {"request_id": "r2"}])
        self.assertEqual(got["source_issues"], ["200"])
        self.assertIsNone(got["posted_to_chatter_at"])
        db.mark_thingy_conversation_posted(cid)
        self.assertIsNotNone(db.get_thingy_conversation(cid)["posted_to_chatter_at"])
        self.assertEqual(len(db.recent_thingy_conversations(10)), 1)
        self.assertIsNone(db.get_thingy_conversation(999))

    def test_unposted_lists_only_null_rows_oldest_first(self):
        # Three rows: A (posted), B (unposted, older), C (unposted, newer).
        a = db.insert_thingy_conversation(
            subscriber_hash="a", started_at="2026-05-12T00:00:00Z", ended_at="2026-05-12T00:01:00Z",
            turn_count=1, transcript=[{"request_id": "ra"}], turn_request_ids=["ra"],
            source_issues=[], feedback=None, topic="A", assessment_md=None,
        )
        db.mark_thingy_conversation_posted(a)
        b = db.insert_thingy_conversation(
            subscriber_hash="b", started_at="2026-05-12T01:00:00Z", ended_at="2026-05-12T01:01:00Z",
            turn_count=1, transcript=[{"request_id": "rb"}], turn_request_ids=["rb"],
            source_issues=[], feedback=None, topic="B", assessment_md=None,
        )
        c = db.insert_thingy_conversation(
            subscriber_hash="c", started_at="2026-05-12T02:00:00Z", ended_at="2026-05-12T02:01:00Z",
            turn_count=1, transcript=[{"request_id": "rc"}], turn_request_ids=["rc"],
            source_issues=[], feedback=None, topic="C", assessment_md=None,
        )
        rows = db.unposted_thingy_conversations()
        self.assertEqual([r["id"] for r in rows], [b, c])  # oldest first; A excluded
        self.assertEqual(db.count_unposted_thingy_conversations(), 2)
        # Limit honored.
        self.assertEqual(len(db.unposted_thingy_conversations(limit=1)), 1)
        # After posting B, only C remains.
        db.mark_thingy_conversation_posted(b)
        self.assertEqual([r["id"] for r in db.unposted_thingy_conversations()], [c])
        self.assertEqual(db.count_unposted_thingy_conversations(), 1)


class WatchTests(_DBCase):
    def _ctx(self):
        ctx = _base.JobContext(deps=None, trigger="scheduled")
        ctx.post = AsyncMock(return_value=True)
        return ctx

    def test_watch_groups_assesses_stores_posts_and_dedupes(self):
        turns = [
            _turn("r1", "subA", "2026-05-12T01:00:00Z", q="What about RSS?", issues=["200"]),
            _turn("r2", "subA", "2026-05-12T01:02:00Z", q="And Atom?", history=1, issues=["247"], feedback="up"),
            _turn("r3", "subB", "2026-05-12T02:00:00Z", q="POSSE?"),
        ]
        assessment = {"topic": "syndication", "reader": "R.", "thingy": "T.", "takeaway": "K."}
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=turns)), \
             patch.object(thingy_job, "_assess", AsyncMock(return_value=assessment)):
            ctx = self._ctx()
            res = asyncio.run(thingy_job.watch(ctx))
            self.assertTrue(res.ok, res.message)
            self.assertEqual(res.data["stored"], 2)
            self.assertEqual(res.data["posted"], 2)
            self.assertEqual(ctx.post.await_count, 2)  # one card per conversation, no overflow line

            rows = db.recent_thingy_conversations(10)
            self.assertEqual(len(rows), 2)
            convA = next(r for r in rows if r["turn_count"] == 2)
            self.assertEqual(convA["source_issues"], ["200", "247"])
            self.assertEqual(convA["feedback"], "up")
            self.assertEqual(convA["topic"], "syndication")
            self.assertIn("**Reader:** R.", convA["assessment_md"])
            self.assertIsNotNone(convA["posted_to_chatter_at"])

            # second run with the same turns → nothing new
            ctx2 = self._ctx()
            res2 = asyncio.run(thingy_job.watch(ctx2))
            self.assertTrue(res2.ok)
            self.assertEqual(ctx2.post.await_count, 0)
            self.assertIn("no new conversations", res2.message)
            self.assertEqual(len(db.recent_thingy_conversations(10)), 2)

    def test_watch_passes_when_log_empty(self):
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=[])):
            res = asyncio.run(thingy_job.watch(self._ctx()))
        self.assertTrue(res.ok)
        self.assertIn("no new conversations", res.message)

    def test_watch_surfaces_lambda_error(self):
        from apps.thingy_bridge.tools.thingy_client import ThingyError
        with patch.object(thingy_job.thingy_client, "fetch_conversations",
                          AsyncMock(side_effect=ThingyError("bridge down"))):
            res = asyncio.run(thingy_job.watch(self._ctx()))
        self.assertFalse(res.ok)
        self.assertIn("bridge down", res.message)

    def test_post_forbidden_stores_convo_but_leaves_unposted(self):
        """Reproduces the 2026-05-14 outage: Thingy bot not in #chatter, so
        ``ctx.post`` raised Forbidden mid-loop. Before the fix this killed
        the run and the inserted conversation was orphaned forever. Now
        the exception is caught, the row stays in the DB, the job result
        is still ok, and ``posted_to_chatter_at`` is NULL so the next
        run can retry."""
        import discord
        turns = [_turn("r1", "subA", "2026-05-12T01:00:00Z", q="?", issues=["247"])]
        assessment = {"topic": "t", "reader": "R.", "thingy": "T.", "takeaway": "K."}
        ctx = self._ctx()
        ctx.post = AsyncMock(side_effect=discord.DiscordException("403 Forbidden 50001"))
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=turns)), \
             patch.object(thingy_job, "_assess", AsyncMock(return_value=assessment)):
            res = asyncio.run(thingy_job.watch(ctx))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.data["stored"], 1)
        self.assertEqual(res.data["posted"], 0)
        # The conversation was stored but not marked posted.
        rows = db.recent_thingy_conversations(10)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["posted_to_chatter_at"])
        self.assertEqual(db.count_unposted_thingy_conversations(), 1)
        # No "...N more pending" tail when posted == 0 (channel unreachable).
        self.assertEqual(ctx.post.await_count, 1)

    def test_orphan_is_backfilled_on_next_run(self):
        """After a Forbidden window heals (bot is added to #chatter), the
        next watch run posts the orphan card without re-fetching it from
        the Lambda — purely from the local mirror."""
        import discord
        turns = [_turn("r1", "subA", "2026-05-12T01:00:00Z", q="?", issues=["247"])]
        assessment = {"topic": "t", "reader": "R.", "thingy": "T.", "takeaway": "K."}
        # First run: post fails, conversation stored as orphan.
        ctx1 = self._ctx()
        ctx1.post = AsyncMock(side_effect=discord.DiscordException("403 Forbidden 50001"))
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=turns)), \
             patch.object(thingy_job, "_assess", AsyncMock(return_value=assessment)):
            asyncio.run(thingy_job.watch(ctx1))
        self.assertEqual(db.count_unposted_thingy_conversations(), 1)

        # Second run: post succeeds. The Lambda returns no new turns; the
        # backfill alone should post the orphan card and mark it posted.
        ctx2 = self._ctx()  # default post returns True
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=[])), \
             patch.object(thingy_job, "_assess", AsyncMock(return_value=assessment)):
            res = asyncio.run(thingy_job.watch(ctx2))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.data["backfilled"], 1)
        self.assertEqual(res.data["posted"], 1)
        self.assertEqual(res.data["stored"], 0)
        self.assertEqual(db.count_unposted_thingy_conversations(), 0)
        rows = db.recent_thingy_conversations(10)
        self.assertIsNotNone(rows[0]["posted_to_chatter_at"])
        self.assertEqual(ctx2.post.await_count, 1)  # one orphan card, no tail

    def test_orphan_backfill_bails_fast_on_persistent_forbidden(self):
        """Three orphans, channel still broken: only one Forbidden round-trip,
        not three. The break in the orphan loop saves throwaway API calls."""
        import discord
        for i, end in enumerate(("2026-05-12T01:00:00Z",
                                 "2026-05-12T02:00:00Z",
                                 "2026-05-12T03:00:00Z")):
            db.insert_thingy_conversation(
                subscriber_hash=f"s{i}", started_at=end, ended_at=end, turn_count=1,
                transcript=[{"request_id": f"rid{i}"}], turn_request_ids=[f"rid{i}"],
                source_issues=[], feedback=None, topic=f"T{i}", assessment_md=None,
            )
        ctx = self._ctx()
        ctx.post = AsyncMock(side_effect=discord.DiscordException("403"))
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=[])):
            res = asyncio.run(thingy_job.watch(ctx))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.data["backfilled"], 0)
        self.assertEqual(ctx.post.await_count, 1)  # bailed after the first failure
        self.assertEqual(db.count_unposted_thingy_conversations(), 3)

    def test_orphans_and_new_share_card_budget(self):
        """Backfill orphans count toward the same per-run cap as new
        cards — a long backlog drains over runs instead of flooding."""
        # Plant _MAX_CARDS_PER_RUN + 2 orphans; expect the cap on cards.
        cap = thingy_job._MAX_CARDS_PER_RUN
        for i in range(cap + 2):
            db.insert_thingy_conversation(
                subscriber_hash=f"s{i}",
                started_at=f"2026-05-12T0{i % 9}:00:00Z",
                ended_at=f"2026-05-12T0{i % 9}:01:00Z",
                turn_count=1, transcript=[{"request_id": f"o{i}"}],
                turn_request_ids=[f"o{i}"], source_issues=[],
                feedback=None, topic=f"O{i}", assessment_md=None,
            )
        ctx = self._ctx()  # post returns True
        with patch.object(thingy_job.thingy_client, "fetch_conversations", AsyncMock(return_value=[])):
            res = asyncio.run(thingy_job.watch(ctx))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.data["backfilled"], cap)
        # cap cards + one "…N more pending" tail.
        self.assertEqual(ctx.post.await_count, cap + 1)
        self.assertEqual(db.count_unposted_thingy_conversations(), 2)
        # The tail message names the remaining count.
        tail_text = ctx.post.await_args_list[-1].args[1]
        self.assertIn("**2** more pending", tail_text)


class ReadCommandTests(_DBCase):
    def test_recent_empty_then_populated(self):
        res = asyncio.run(thingy_job.recent(_base.JobContext(), count=8))
        self.assertTrue(res.ok)
        self.assertIn("No Thingy conversations mirrored yet", res.message)

        db.insert_thingy_conversation(
            subscriber_hash="zz9988", started_at="2026-05-12T01:00:00Z", ended_at="2026-05-12T01:03:00Z",
            turn_count=1, transcript=[{"request_id": "r1", "question": "Hi", "answer": "Hello", "created_at": "2026-05-12T01:00:00Z"}],
            turn_request_ids=["r1"], source_issues=["12"], feedback=None, topic="greeting", assessment_md="**Reader:** said hi",
        )
        res2 = asyncio.run(thingy_job.recent(_base.JobContext(), count=8))
        self.assertIn("#1", res2.message)
        self.assertIn("greeting", res2.message)
        self.assertIn("WT12", res2.message)

    def test_show_returns_card_and_transcript_file(self):
        cid = db.insert_thingy_conversation(
            subscriber_hash="aa1122ff", started_at="2026-05-12T01:00:00Z", ended_at="2026-05-12T01:05:00Z",
            turn_count=2,
            transcript=[
                {"request_id": "r1", "question": "Did Jamie write about RSS?", "answer": "Yes, see WT200.",
                 "created_at": "2026-05-12T01:00:00Z", "citations": [{"issue_number": "200", "url": "https://x/200/"}],
                 "source_issues": ["200"], "feedback_reaction": None},
                {"request_id": "r2", "question": "And Atom?", "answer": "Also WT247.",
                 "created_at": "2026-05-12T01:05:00Z", "citations": [], "source_issues": ["247"], "feedback_reaction": "up"},
            ],
            turn_request_ids=["r1", "r2"], source_issues=["200", "247"], feedback="up",
            topic="RSS history", assessment_md="**Reader:** wanted RSS history\n**Thingy:** answered well",
        )
        res = asyncio.run(thingy_job.show(_base.JobContext(), conv_id=cid))
        self.assertTrue(res.ok)
        self.assertIn(f"#{cid}", res.message)
        self.assertIn("transcript attached", res.message)
        md = res.data["transcript_md"]
        self.assertIn("Did Jamie write about RSS?", md)
        self.assertIn("And Atom?", md)
        self.assertIn("WT200", md)
        self.assertIn("Reader feedback: up", md)
        self.assertEqual(res.data["filename"], f"thingy-conversation-{cid}.md")

        missing = asyncio.run(thingy_job.show(_base.JobContext(), conv_id=999))
        self.assertFalse(missing.ok)
        self.assertIn("No mirrored Thingy conversation", missing.message)


class WiringTests(unittest.TestCase):
    def test_thingy_subgroup_wired(self):
        from apps.thingy_bridge.commands import register_thingy_commands
        tree = register_thingy_commands(MagicMock())
        # The bridge tree holds `thingy` at the top level (no /workshop parent).
        thingy = next(c for c in tree.groups if getattr(c, "name", None) == "thingy")
        self.assertEqual({getattr(c, "_cmd_name", None) for c in thingy.commands}, {"recent", "show", "sync"})

    def test_scheduler_has_thingy_watch(self):
        from apps.thingy_bridge.scheduler.jobs import by_id
        spec = by_id("thingy-watch")
        self.assertIsNotNone(spec)
        self.assertEqual(spec.cron, "7 * * * *")


class WatchLockTests(_DBCase):
    """A slow `thingy-watch` run (network + LLM per convo) can push past
    the hour; the whole-job lock prevents the next cron fire from
    starting a parallel instance that'd pay for duplicate LLM calls."""

    def test_concurrent_watch_is_blocked_by_job_lock(self):
        from apps.thingy_bridge.jobs._base import job_lock
        ctx = _base.JobContext(deps=None, trigger="scheduled")
        ctx.post = AsyncMock(return_value=True)
        # Pre-acquire the lock; the watch call should see "already running."
        with job_lock([f"job:{thingy_job.NAME}"], thingy_job.NAME):
            with patch.object(thingy_job.thingy_client, "fetch_conversations",
                              AsyncMock(return_value=[])):
                res = asyncio.run(thingy_job.watch(ctx))
        self.assertTrue(res.ok)
        self.assertIn("already running", res.message)


if __name__ == "__main__":
    unittest.main()
