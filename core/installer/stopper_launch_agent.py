"""macOS Stopper host LaunchAgent contract (installer-side placeholder).

This bundle ships the installer contract only: ``--help`` and the expected
LaunchAgent payload used by ``tests/test_de_lite_local_bridge.py``. Actual
plist installation into ``~/Library/LaunchAgents`` stays with the upstream
Decision Engine installer.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import sys
from typing import Any, Dict, Optional, Union

_CORE_ROOT = Path(__file__).resolve().parents[1]
if str(_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CORE_ROOT))

from client import runner  # noqa: E402


AGENT_LABEL = "com.decision-engine.stopper.hostbridge"
AGENT_MARKER = "DE_STOPPER_HOSTBRIDGE_MANAGED"


def _identity() -> str:
    return str(os.getuid()) if hasattr(os, "getuid") else "user"


def runtime_paths(temp_dir: Union[str, os.PathLike]) -> Dict[str, Path]:
    base = Path(temp_dir) / ("decision-engine-host-bridge-%s" % _identity())
    state = base / ".runtime"
    locks = state / "locks"
    logs = state / "logs"
    return {
        "root": base,
        "state": state,
        "locks": locks,
        "logs": logs,
        "config": base / "config.json",
        "active_run": state / "active-run.json",
        "active_runs": state / "active-runs.json",
        "active_runs_lock": locks / "active-runs.lock",
        "stopper_lock": locks / "stopper-panel.lock",
        "log": logs / "stopper.log",
    }


def _environment(paths: Dict[str, Path]) -> Dict[str, str]:
    return {
        AGENT_MARKER: "1",
        "DE_CONFIG_PATH": str(paths["config"]),
        "DE_ACTIVE_RUN": str(paths["active_run"]),
        "DE_ACTIVE_RUNS": str(paths["active_runs"]),
        "DE_ACTIVE_RUNS_LOCK": str(paths["active_runs_lock"]),
        "DE_ACTIVE_RUNS_LOCK_PATHS": json.dumps([str(paths["active_runs_lock"])]),
        "DE_ACTIVE_RUNS_WRITE_PATHS": json.dumps([str(paths["active_runs"])]),
        "DE_ACTIVE_RUN_WRITE_PATHS": json.dumps([str(paths["active_run"])]),
        "DE_STOPPER_SINGLETON_LOCK": str(paths["stopper_lock"]),
    }


def _expected_payload(
    root: Union[str, os.PathLike], *, temp_dir: Optional[Union[str, os.PathLike]] = None
) -> Dict[str, Any]:
    """The exact LaunchAgent payload the installer must write on macOS."""
    if platform.system() != "Darwin":
        raise OSError("native Stopper host LaunchAgent is macOS-only")
    if temp_dir is None:
        temp_dir = Path("/private/tmp")
    paths = runtime_paths(temp_dir)
    stopper = runner.shipped_stopper_path(root)
    if stopper is None:
        raise OSError("native Stopper is unavailable for this Mac architecture")
    stopper = Path(stopper).resolve()
    return {
        "Label": AGENT_LABEL,
        "ProgramArguments": [str(stopper)],
        "EnvironmentVariables": _environment(paths),
        "WatchPaths": [str(paths["active_runs"])],
        "RunAtLoad": False,
        "KeepAlive": False,
        "ProcessType": "Interactive",
        "LimitLoadToSessionType": "Aqua",
        "StandardOutPath": str(paths["log"]),
        "StandardErrorPath": str(paths["log"]),
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="stopper_launch_agent",
        description=(
            "macOS Stopper host LaunchAgent contract placeholder. "
            "This bundle documents the expected payload; plist installation "
            "stays with the upstream Decision Engine installer."
        ),
    )
    parser.add_argument(
        "--print-payload",
        metavar="ROOT",
        default=None,
        help="print the expected LaunchAgent payload for an installed root and exit",
    )
    args = parser.parse_args(argv)
    if args.print_payload:
        try:
            payload = _expected_payload(args.print_payload)
        except OSError as exc:
            sys.stderr.write("stopper_launch_agent: %s\n" % exc)
            return 1
        sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
