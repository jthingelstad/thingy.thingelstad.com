"""Shared discord stubs for offline unit tests.

Multiple test files in this directory need to import workshop_bot
modules without the real ``discord`` package installed (or, more
commonly, without binding to it so tests can run on bare CI). Rather
than each file maintaining its own inline stub — which collided under
``unittest discover`` because the first stub installed wins and later
test modules reference whichever class binding was active at their own
module-load time — this helper installs one canonical stub.

The stub is **idempotent**: callers can safely call ``install()``
multiple times. The second call is a no-op.
"""

from __future__ import annotations

import sys
import types

_INSTALLED = False


def install() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    _install_discord()


def _install_discord() -> None:
    discord = types.ModuleType("discord")

    class _Client:
        def __init__(self, *a, **k):
            self.user = None

    class _Intents:
        message_content = False
        guilds = False
        members = False

        @staticmethod
        def default():
            return _Intents()

    class _Permissions:
        def __init__(self, **flags):
            self.flags = flags

    class _Object:
        def __init__(self, id):
            self.id = id

    class _DiscordException(Exception):
        pass

    class _HTTPException(_DiscordException):
        pass

    discord.Client = _Client  # type: ignore[attr-defined]
    discord.Intents = _Intents  # type: ignore[attr-defined]
    discord.Permissions = _Permissions  # type: ignore[attr-defined]
    discord.Object = _Object  # type: ignore[attr-defined]
    discord.Message = object  # type: ignore[attr-defined]
    discord.Member = object  # type: ignore[attr-defined]
    discord.Interaction = object  # type: ignore[attr-defined]
    discord.RawReactionActionEvent = object  # type: ignore[attr-defined]
    discord.DiscordException = _DiscordException  # type: ignore[attr-defined]
    discord.HTTPException = _HTTPException  # type: ignore[attr-defined]
    discord.NotFound = _HTTPException  # type: ignore[attr-defined]

    abc_mod = types.ModuleType("discord.abc")
    abc_mod.Messageable = object  # type: ignore[attr-defined]
    abc_mod.User = object  # type: ignore[attr-defined]

    # discord.app_commands surface — minimal shape that workshop_bot's
    # commands module actually touches (Group, CommandTree.add_command,
    # @group.command, @app_commands.describe, @app_commands.choices,
    # Choice). Class-getitem on Choice supports ``Choice[str]`` generics.
    app_commands = types.ModuleType("discord.app_commands")

    class _Choice:
        def __init__(self, *, name=None, value=None):
            self.name = name
            self.value = value

        def __class_getitem__(cls, item):
            return cls

    class _Group:
        def __init__(self, *, name=None, description=None, default_permissions=None, parent=None):
            self.name = name
            self.description = description
            self.default_permissions = default_permissions
            self.parent = parent
            # ``commands`` holds both leaf commands (functions) and
            # nested subgroups (other ``_Group`` instances), mirroring
            # discord.py's ``Group.commands``.
            self.commands: list = []
            self._cmd_name = name  # so a subgroup looks like a "command" to a parent
            if parent is not None:
                parent.commands.append(self)

        def command(self, *, name=None, description=None):
            def deco(fn):
                fn._cmd_name = name
                fn._cmd_description = description
                self.commands.append(fn)
                return fn

            return deco

    class _CommandTree:
        def __init__(self, client):
            self.client = client
            self.groups: list = []

        def add_command(self, cmd):
            self.groups.append(cmd)

    def _describe(**kwargs):
        def deco(fn):
            fn._describe = kwargs
            return fn

        return deco

    def _choices(**kwargs):
        def deco(fn):
            fn._choices = kwargs
            return fn

        return deco

    app_commands.Choice = _Choice  # type: ignore[attr-defined]
    app_commands.Group = _Group  # type: ignore[attr-defined]
    app_commands.CommandTree = _CommandTree  # type: ignore[attr-defined]
    app_commands.describe = _describe  # type: ignore[attr-defined]
    app_commands.choices = _choices  # type: ignore[attr-defined]
    discord.app_commands = app_commands  # type: ignore[attr-defined]

    sys.modules["discord"] = discord
    sys.modules["discord.abc"] = abc_mod
    sys.modules["discord.app_commands"] = app_commands
