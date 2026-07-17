"""Tests for the bridge's startup self-check + #chatter announcement
(tools/startup.py). Mirrors what workshop_bot's startup module covers,
trimmed to the bridge's single-persona shape."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from apps.thingy_bridge.tests import _stubs  # noqa: E402

_stubs.install()

import discord  # noqa: E402  (stub)

from apps.thingy_bridge.tools import startup  # noqa: E402


def _fake_channel(name: str, *, perms_ok: bool = True):
    """A channel just complete enough for audit + announce. The real
    ``discord.TextChannel`` has dozens of attrs; we only need
    ``name``, ``guild.me``, ``permissions_for(me)`` and an async
    ``send``."""
    channel = MagicMock(spec=["name", "guild", "permissions_for", "send"])
    channel.name = name
    me = MagicMock()
    channel.guild = MagicMock()
    channel.guild.me = me
    perms = MagicMock()
    for perm in startup.REQUIRED_PERMS:
        setattr(perms, perm, perms_ok)
    channel.permissions_for = MagicMock(return_value=perms)
    channel.send = AsyncMock()
    return channel


def _fake_guild(*, role_ok: bool = True, manage_roles: bool = True):
    guild = MagicMock()
    role = MagicMock()
    role.position = 1
    role.id = 333
    me = MagicMock()
    me.guild_permissions.manage_roles = manage_roles
    me.top_role.position = 10
    guild.me = me
    guild.get_role = MagicMock(return_value=role if role_ok else None)
    return guild


def _fake_bot(channels: dict[int, object] | None = None, guild=None, name: str = "Thingy"):
    """A bot just complete enough for the startup module's needs."""
    bot = MagicMock(spec=["name", "get_channel", "get_guild"])
    bot.name = name
    bot.get_channel = MagicMock(side_effect=lambda cid: (channels or {}).get(cid))
    bot.get_guild = MagicMock(return_value=guild if guild is not None else _fake_guild())
    return bot


class EnvCase(unittest.TestCase):
    """Shared setUp/tearDown for tests that need a clean channel-env."""

    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in (
                "DISCORD_VALIDATION_CHANNEL_ID",
                "DISCORD_GENERAL_CHANNEL_ID",
                "DISCORD_CHANNEL_CHATTER",
                "DISCORD_SUPPORTER_ROLE_ID",
                "DISCORD_GUILD_ID",
            )
        }

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class AuditTests(EnvCase):
    def test_clean_audit(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "111"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        bot = _fake_bot(
            {
                111: _fake_channel("validation"),
                112: _fake_channel("general"),
                222: _fake_channel("chatter"),
            }
        )
        rows = startup.audit(bot)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0][0], "DISCORD_VALIDATION_CHANNEL_ID")
        self.assertEqual(rows[0][1], "validation")
        self.assertEqual(rows[0][2], [])
        self.assertEqual(rows[1][1], "general")
        self.assertEqual(rows[1][2], [])
        self.assertEqual(rows[2][1], "chatter")
        self.assertEqual(rows[2][2], [])
        self.assertEqual(rows[3][2], [])

    def test_missing_env_is_flagged(self):
        os.environ.pop("DISCORD_VALIDATION_CHANNEL_ID", None)
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        bot = _fake_bot({112: _fake_channel("general"), 222: _fake_channel("chatter")})
        rows = startup.audit(bot)
        self.assertIsNone(rows[0][1])
        self.assertIn("is not set", rows[0][2][0])
        self.assertEqual(rows[1][2], [])

    def test_invalid_env_is_flagged(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "not-a-number"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        bot = _fake_bot({222: _fake_channel("chatter")})
        rows = startup.audit(bot)
        self.assertIn("not a valid channel id", rows[0][2][0])

    def test_channel_not_visible_is_flagged(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "111"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        # 111 not in the channels map → bot.get_channel returns None
        bot = _fake_bot({112: _fake_channel("general"), 222: _fake_channel("chatter")})
        rows = startup.audit(bot)
        self.assertIsNone(rows[0][1])
        self.assertIn("not visible", rows[0][2][0])

    def test_missing_perm_is_flagged(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "111"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        bot = _fake_bot(
            {
                111: _fake_channel("validation"),
                112: _fake_channel("general", perms_ok=False),
                222: _fake_channel("chatter"),
            }
        )
        rows = startup.audit(bot)
        self.assertEqual(rows[1][2][0], "missing perm: view_channel")


class FormatTests(unittest.TestCase):
    def test_clean_line_is_just_status(self):
        """Clean boot: one bare line ``✓ **Thingy** online``. No channel
        list (operator noise), no command list."""
        bot = _fake_bot()
        line = startup.format_line(
            bot,
            [
                ("DISCORD_VALIDATION_CHANNEL_ID", "validation", []),
                ("DISCORD_GENERAL_CHANNEL_ID", "general", []),
                ("DISCORD_CHANNEL_CHATTER", "chatter", []),
                ("DISCORD_SUPPORTER_ROLE_ID", "supporter-role", []),
            ],
        )
        self.assertEqual(line, "✓ **Thingy** online")
        self.assertNotIn("#validation", line)
        self.assertNotIn("#chatter", line)

    def test_issue_surfaces_only_the_broken_channel(self):
        bot = _fake_bot()
        line = startup.format_line(
            bot,
            [
                ("DISCORD_VALIDATION_CHANNEL_ID", "validation", []),
                (
                    "DISCORD_CHANNEL_CHATTER",
                    None,
                    ["channel id 222 not visible to Thingy (not a member?)"],
                ),
            ],
        )
        self.assertTrue(line.startswith("⚠️ **Thingy** online — "))
        self.assertIn("not visible", line)
        self.assertNotIn("#validation", line)

    def test_header_prepended(self):
        bot = _fake_bot()
        out = startup.format_line(
            bot,
            [
                ("DISCORD_VALIDATION_CHANNEL_ID", "validation", []),
                ("DISCORD_GENERAL_CHANNEL_ID", "general", []),
                ("DISCORD_CHANNEL_CHATTER", "chatter", []),
                ("DISCORD_SUPPORTER_ROLE_ID", "supporter-role", []),
            ],
            header="**thingy-bridge online** — `abc1234`",
        )
        lines = out.splitlines()
        self.assertEqual(lines[0], "**thingy-bridge online** — `abc1234`")
        self.assertEqual(lines[1], "✓ **Thingy** online")
        # No third line — command summary is no longer rendered.
        self.assertEqual(len(lines), 2)

    def test_commands_summary_param_is_accepted_but_ignored(self):
        """Back-compat: still accepts ``commands_summary`` so callers
        that haven't been updated don't break, but the value isn't
        rendered."""
        bot = _fake_bot()
        out = startup.format_line(
            bot,
            [
                ("DISCORD_VALIDATION_CHANNEL_ID", "validation", []),
                ("DISCORD_CHANNEL_CHATTER", "chatter", []),
            ],
            commands_summary="/thingy recent",
        )
        self.assertEqual(out, "✓ **Thingy** online")
        self.assertNotIn("/thingy recent", out)
        self.assertNotIn("↳", out)


class AnnounceTests(EnvCase):
    def test_announce_posts_message(self):
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        channel = _fake_channel("chatter")
        bot = _fake_bot({222: channel})
        asyncio.run(startup.announce(bot, "hello"))
        channel.send.assert_awaited_once_with("hello", suppress_embeds=True)

    def test_announce_swallows_forbidden(self):
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        channel = _fake_channel("chatter")
        channel.send = AsyncMock(side_effect=discord.DiscordException("403"))
        bot = _fake_bot({222: channel})
        # Should not raise — operator-visible failure stays in the log.
        asyncio.run(startup.announce(bot, "hello"))

    def test_announce_skips_when_chatter_unset(self):
        os.environ.pop("DISCORD_CHANNEL_CHATTER", None)
        channel = _fake_channel("chatter")
        bot = _fake_bot({222: channel})
        asyncio.run(startup.announce(bot, "hello"))
        channel.send.assert_not_called()

    def test_announce_skips_when_channel_not_visible(self):
        os.environ["DISCORD_CHANNEL_CHATTER"] = "999"  # not in bot map
        bot = _fake_bot({})
        asyncio.run(startup.announce(bot, "hello"))  # no exception


class PostStartupCardTests(EnvCase):
    def test_end_to_end_posts_once_then_idempotent(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "111"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        chatter = _fake_channel("chatter")
        bot = _fake_bot(
            {111: _fake_channel("validation"), 112: _fake_channel("general"), 222: chatter}
        )
        # Don't depend on the working tree's git state.
        with (
            patch.object(startup, "git_hash", return_value="abc1234"),
            patch.object(startup, "git_dirty", return_value=False),
        ):
            asyncio.run(startup.post_startup_card(bot))
        chatter.send.assert_awaited_once()
        message = chatter.send.await_args.args[0]
        self.assertIn("**thingy-bridge online**", message)
        self.assertIn("abc1234", message)
        self.assertIn("**Thingy** online", message)
        # Slim card: no command list, no channel echo on a clean boot.
        self.assertNotIn(startup.COMMANDS_SUMMARY, message)
        self.assertNotIn("↳", message)
        self.assertNotIn("#validation", message)
        self.assertNotIn("#chatter", message)
        # Second call — reconnection fired on_ready again — must NOT
        # re-post. Real Discord blips would otherwise spam #chatter.
        asyncio.run(startup.post_startup_card(bot))
        self.assertEqual(chatter.send.await_count, 1)

    def test_dirty_flag_in_header(self):
        os.environ["DISCORD_VALIDATION_CHANNEL_ID"] = "111"
        os.environ["DISCORD_GENERAL_CHANNEL_ID"] = "112"
        os.environ["DISCORD_CHANNEL_CHATTER"] = "222"
        os.environ["DISCORD_SUPPORTER_ROLE_ID"] = "333"
        os.environ["DISCORD_GUILD_ID"] = "444"
        chatter = _fake_channel("chatter")
        bot = _fake_bot(
            {111: _fake_channel("validation"), 112: _fake_channel("general"), 222: chatter}
        )
        with (
            patch.object(startup, "git_hash", return_value="abc1234"),
            patch.object(startup, "git_dirty", return_value=True),
        ):
            asyncio.run(startup.post_startup_card(bot))
        message = chatter.send.await_args.args[0]
        self.assertIn("(dirty)", message)


if __name__ == "__main__":
    unittest.main()
