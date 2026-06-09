"""Tests for the Supporting Member ``/thingy`` command surface."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from apps.thingy_bridge.tests import _stubs  # noqa: E402

_stubs.install()


class SlashCommandShapeTests(unittest.TestCase):
    def test_validation_commands_are_the_only_slash_surface(self):
        from apps.thingy_bridge import commands

        class Bot:
            def __init__(self):
                self.tree = type("Tree", (), {"add_command": lambda _self, group: None})()

        root = commands.register_thingy_commands(Bot())
        thingy = next(g for g in root.groups if getattr(g, "_cmd_name", None) == "thingy")

        self.assertIsNone(getattr(thingy, "default_permissions", None))
        self.assertEqual({getattr(c, "_cmd_name", None) for c in thingy.commands}, {"verify", "confirm"})


if __name__ == "__main__":
    unittest.main()
