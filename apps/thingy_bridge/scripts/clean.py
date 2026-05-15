#!/usr/bin/env python3
"""Clean local development cruft under apps/thingy_bridge/.

By default this removes transient cache directories only. Use --db to also
remove the local SQLite at apps/thingy_bridge/data/thingy_bridge.db.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}
SKIP_DIRS = {
    ".git",
    "venv",
    "node_modules",
}
OPTIONAL_FILES = {
    BRIDGE_DIR / "data" / "thingy_bridge.db",
}


def _remove_path(path: Path) -> bool:
    if not path.exists():
        return False
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove local caches and optional runtime artifacts.")
    parser.add_argument("--db", action="store_true", help="Also remove apps/thingy_bridge/data/thingy_bridge.db (destructive).")
    args = parser.parse_args()

    removed: list[str] = []
    for path in BRIDGE_DIR.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name in CACHE_DIR_NAMES and _remove_path(path):
            removed.append(str(path.relative_to(BRIDGE_DIR)))

    if args.db:
        for path in sorted(OPTIONAL_FILES):
            if _remove_path(path):
                removed.append(str(path.relative_to(BRIDGE_DIR)))

    if removed:
        print("Removed:")
        for item in removed:
            print(f"- {item}")
    else:
        print("Nothing to remove.")


if __name__ == "__main__":
    main()
