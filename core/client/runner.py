"""Client-side runner primitives for the DE Lite local audit bridge.

The bridge (``skills/audit/scripts/de_lite_local_bridge.py``) imports this
module from the installed Decision Engine root. Everything here stays
host-local: no Hub transport, no artifact content, no caller-selected paths.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
from typing import Any, Dict, Optional, Sequence, Union

from client import windows_security


class AuditError(RuntimeError):
    """Raised when a local advisory lifecycle step is rejected or unavailable."""


_TERMINAL_STATUSES = ("completed", "partial", "failed")
_SUPPORTED_LOCALES = ("en-US", "zh-CN")
_REGISTRY_SCHEMA_VERSION = 1
_REGISTRY_MAX_BYTES = 4 * 1024 * 1024
_TERMINAL_LINGER_SECONDS = 30.0


def _identity() -> str:
    return str(os.getuid()) if hasattr(os, "getuid") else "user"


def _runtime_root() -> Path:
    # DE_CONFIG_PATH is set by the bridge itself at import (overwriting any
    # caller value), so its parent is the bridge-owned host runtime root.
    # The fallback recomputes from tempfile.gettempdir(); caller-selected
    # DE_ACTIVE_RUN* overrides are never honored here.
    config_path = os.environ.get("DE_CONFIG_PATH", "").strip()
    if config_path:
        return Path(config_path).expanduser().resolve().parent
    return Path(tempfile.gettempdir()) / ("decision-engine-host-bridge-%s" % _identity())


def de_lite_active_runs_path() -> Path:
    return _runtime_root() / ".runtime" / "active-runs.json"


def normalize_ui_locale(ui_locale: Optional[str]) -> str:
    if isinstance(ui_locale, str) and ui_locale in _SUPPORTED_LOCALES:
        return ui_locale
    return _SUPPORTED_LOCALES[0]


def run_command(cmd: Sequence[str], timeout: int = 30) -> Dict[str, Any]:
    """Run one local command and capture the result; never raises on failure."""
    try:
        completed = subprocess.run(
            [str(part) for part in cmd],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        return {
            "returncode": 124,
            "stdout": exc.stdout if isinstance(exc.stdout, str) else "",
            "stderr": (stderr + "\ntimed out after %ss" % timeout).strip(),
        }
    except OSError as exc:
        return {"returncode": 127, "stdout": "", "stderr": str(exc)}
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout or "",
        "stderr": completed.stderr or "",
    }


def shipped_stopper_path(root: Union[str, os.PathLike]) -> Optional[Path]:
    """Return the bundled native Stopper binary for this platform, or None."""
    base = Path(root)
    system = platform.system().lower()
    machines = {
        "amd64": "x86_64",
        "arm64": "arm64",
        "aarch64": "arm64",
        "x86_64": "x86_64",
    }
    arch = machines.get(platform.machine().lower(), platform.machine().lower())
    suffix = ".exe" if system == "windows" else ""
    candidates = (
        "stopper-%s-%s%s" % (system, arch, suffix),
        "stopper-%s%s" % (system, suffix),
        "stopper%s" % suffix,
    )
    for name in candidates:
        candidate = base / "bin" / name
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def launch_stopper_if_available(
    *, prefer_shipped: bool = True, root: Optional[Union[str, os.PathLike]] = None
) -> None:
    """Spawn the native Stopper when this install ships one; silent otherwise.

    The local advisory registry stays host-side either way, so an install
    without the native binary still records its runs and never fails here.
    """
    base = Path(root) if root is not None else Path(__file__).resolve().parents[1]
    stopper = shipped_stopper_path(base) if prefer_shipped else None
    if stopper is None:
        return
    options: Dict[str, Any] = {}
    if os.name == "nt":
        options["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | NEW_GROUP
    else:
        options["start_new_session"] = True
    try:
        subprocess.Popen(
            [str(stopper)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            **options,
        )
    except OSError:
        return


def load_config() -> Dict[str, Any]:
    home = os.environ.get("DEEPPATTERN_HOME")
    if home and home.strip():
        base = Path(home).expanduser()
    else:
        base = Path.home() / ".deeppattern"
    path = base / "decision-engine" / "config.json"
    if not path.is_file():
        return {}
    try:
        raw = path.read_bytes()
        loaded = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise AuditError("device activation config is unreadable") from exc
    if not isinstance(loaded, dict):
        raise AuditError("device activation config is not an object")
    return loaded


def request_json(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    """Fail closed: the local bridge never contacts the Hub."""
    raise AuditError("Hub transport is unavailable in the local DE Lite bridge")


def _ensure_runtime_directories() -> None:
    root = _runtime_root()
    state = root / ".runtime"
    for path in (root, state, state / "locks", state / "logs"):
        try:
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError as exc:
            raise AuditError("host runtime directory is unavailable") from exc
        if os.name == "nt":
            try:
                windows_security.harden_private_data_acl(path)
            except windows_security.WindowsSecurityError as exc:
                raise AuditError("host runtime directory cannot be locked") from exc
        elif hasattr(os, "chmod"):
            try:
                os.chmod(path, 0o700)
            except OSError as exc:
                raise AuditError("host runtime directory cannot be locked") from exc


def _read_registry(*, tolerant: bool) -> Dict[str, Any]:
    path = de_lite_active_runs_path()
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        if tolerant:
            return {"schema_version": _REGISTRY_SCHEMA_VERSION, "runs": {}}
        raise AuditError("local advisory run not found") from None
    except OSError as exc:
        if tolerant:
            return {"schema_version": _REGISTRY_SCHEMA_VERSION, "runs": {}}
        raise AuditError("local advisory registry is unreadable") from exc
    if len(raw) > _REGISTRY_MAX_BYTES:
        raise AuditError("local advisory registry is oversized")
    try:
        loaded = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        if tolerant:
            return {"schema_version": _REGISTRY_SCHEMA_VERSION, "runs": {}}
        raise AuditError("local advisory registry is corrupt") from exc
    if (
        not isinstance(loaded, dict)
        or type(loaded.get("schema_version")) is not int
        or loaded["schema_version"] != _REGISTRY_SCHEMA_VERSION
        or not isinstance(loaded.get("runs"), dict)
    ):
        if tolerant:
            return {"schema_version": _REGISTRY_SCHEMA_VERSION, "runs": {}}
        raise AuditError("local advisory registry is corrupt")
    return loaded


def _write_registry(registry: Dict[str, Any]) -> None:
    path = de_lite_active_runs_path()
    _ensure_runtime_directories()
    registry["schema_version"] = _REGISTRY_SCHEMA_VERSION
    registry["updated_at"] = time.time()
    payload = json.dumps(registry, ensure_ascii=False, indent=2, sort_keys=True)
    handle_fd, temp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=".active-runs-", suffix=".tmp"
    )
    try:
        with os.fdopen(handle_fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        if os.name == "nt":
            try:
                windows_security.harden_private_data_acl(temp_name)
            except windows_security.WindowsSecurityError as exc:
                raise AuditError("registry file cannot be locked") from exc
        elif hasattr(os, "chmod"):
            os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def save_local_advisory_run(
    run_id: str,
    *,
    status: str = "running",
    title: str = "",
    surface: str = "de_lite",
    degrade_reason: str = "",
    ui_locale: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or overwrite one host-local advisory run entry."""
    if not isinstance(run_id, str) or not run_id.strip():
        raise AuditError("local advisory run id is required")
    if status in _TERMINAL_STATUSES:
        raise AuditError("save_local_advisory_run cannot publish a terminal status")
    registry = _read_registry(tolerant=True)
    entry: Dict[str, Any] = {
        "run_id": run_id,
        "status": status,
        "title": title if isinstance(title, str) else "",
        "local_surface": surface,
        "degrade_reason": degrade_reason,
        "fallback_mode": "session-llm",
        "advisory_only": True,
        "ui_locale": normalize_ui_locale(ui_locale),
        "created_at": time.time(),
    }
    registry["runs"][run_id] = entry
    _write_registry(registry)
    return dict(entry)


def complete_local_advisory_run(run_id: str, *, status: str) -> Dict[str, Any]:
    """Move one existing run to a terminal status; rejects unknown or terminal runs."""
    if status not in _TERMINAL_STATUSES:
        raise AuditError("unsupported terminal status")
    registry = _read_registry(tolerant=False)
    run = registry["runs"].get(run_id)
    if not isinstance(run, dict):
        raise AuditError("local advisory run not found")
    if run.get("status") in _TERMINAL_STATUSES:
        raise AuditError("local advisory run already reached a terminal status")
    completed_at = time.time()
    run["status"] = status
    run["completed_at"] = completed_at
    run["hidden_after"] = completed_at + _TERMINAL_LINGER_SECONDS
    _write_registry(registry)
    return {
        "status": run["status"],
        "run_id": run_id,
        "local_surface": run.get("local_surface", "de_lite"),
        "degrade_reason": run.get("degrade_reason", ""),
        "fallback_mode": run.get("fallback_mode", "session-llm"),
    }


def _self_check() -> int:  # pragma: no cover - manual diagnostic helper
    sys.stdout.write(
        json.dumps(
            {
                "registry_path": str(de_lite_active_runs_path()),
                "platform": platform.system(),
                "shipped_stopper": str(
                    shipped_stopper_path(Path(__file__).resolve().parents[1]) or ""
                ),
            },
            sort_keys=True,
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_self_check())
