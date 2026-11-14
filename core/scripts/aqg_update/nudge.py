#!/usr/bin/env python3
"""Placeholder update nudge for the AQG skill CLIs.

``aqg_construction_check.py`` and ``aqg_preflight.py`` load this module from
``Path(__file__).resolve().parents[3] / "scripts/aqg_update/nudge.py"`` via
``importlib`` inside a guarded ``finally`` block and call ``nudge()``; a
missing or broken module must never change the skill result (that boundary
is theirs). This placeholder keeps that path actually runnable.

``nudge()`` is deliberately silent: parent CLIs print their own verdict and
must not gain output noise here. A real updater (version check against the
pack's release channel) can replace the body later without touching the
call sites. Honors ``AQG_NO_UPDATE_CHECK`` for forward compatibility.

CLI: ``python3 nudge.py [--help]`` — argparse help only; running it does
nothing else (no network, no writes, no state).
"""

from __future__ import annotations

import argparse
import os
import sys

__all__ = ["nudge", "main"]


def nudge() -> None:
    """No-op update nudge (placeholder).

    Keep silent and side-effect free: it runs in the ``finally`` block of
    parent skill CLIs, so any output here would pollute their verdicts.
    """
    if os.environ.get("AQG_NO_UPDATE_CHECK"):
        return
    # Placeholder for the real update check: intentionally silent no-op.
    return


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="aqg_update.nudge",
        description=(
            "AQG update nudge placeholder. Parent skill CLIs import nudge() "
            "via importlib and call it after their own result; this CLI exists "
            "so the module can also be inspected/invoked standalone."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="accepted for forward compatibility; the placeholder is a no-op either way",
    )
    args = parser.parse_args(argv)
    nudge()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
