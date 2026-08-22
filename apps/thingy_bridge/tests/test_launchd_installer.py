"""Regression coverage for the Thingy Bridge launchd installer."""

from __future__ import annotations

import os
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ADMIN_SCRIPT = REPO_ROOT / "apps/thingy_bridge/scripts/admin.sh"
LABEL = "com.thingelstad.thingy-bridge"


class LaunchdInstallerTests(unittest.TestCase):
    def test_install_writes_start_on_login_plist(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            env = os.environ.copy()
            env["HOME"] = home

            subprocess.run(
                ["bash", str(ADMIN_SCRIPT), "install"],
                cwd=REPO_ROOT,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            )

            plist_path = Path(home) / "Library/LaunchAgents" / f"{LABEL}.plist"
            with plist_path.open("rb") as plist_file:
                config = plistlib.load(plist_file)

        self.assertEqual(config["Label"], LABEL)
        self.assertIs(config["RunAtLoad"], True)
        self.assertIs(config["KeepAlive"], True)
        self.assertEqual(config["WorkingDirectory"], str(REPO_ROOT))
        self.assertEqual(
            config["ProgramArguments"],
            [str(REPO_ROOT / ".venv/bin/python"), "-m", "apps.thingy_bridge.bot"],
        )

    def test_start_fails_when_launchd_job_is_not_running(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            home = temp_path / "home"
            plist_path = home / "Library/LaunchAgents" / f"{LABEL}.plist"
            plist_path.parent.mkdir(parents=True)
            plist_path.write_text("stub", encoding="utf-8")

            bin_dir = temp_path / "bin"
            bin_dir.mkdir()
            launchctl = bin_dir / "launchctl"
            launchctl.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = bootstrap ]; then exit 0; fi\n'
                'if [ "$1" = print ]; then\n'
                "  printf 'state = exited\\nlast exit code = 1\\n'\n"
                "  exit 0\n"
                "fi\n"
                "exit 1\n",
                encoding="utf-8",
            )
            launchctl.chmod(0o755)
            sleep = bin_dir / "sleep"
            sleep.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            sleep.chmod(0o755)

            env = os.environ.copy()
            env["HOME"] = str(home)
            env["PATH"] = f"{bin_dir}:{env['PATH']}"
            completed = subprocess.run(
                ["bash", str(ADMIN_SCRIPT), "start"],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("failed to reach running state", completed.stderr)
        self.assertIn("loaded but not running", completed.stdout)


if __name__ == "__main__":
    unittest.main()
