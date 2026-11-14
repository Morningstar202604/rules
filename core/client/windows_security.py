"""Windows-only private-data ACL helpers and Defender status.

The bridge imports this module unconditionally, so every Windows-specific
import is function-local: on POSIX the module loads and the helpers either
no-op or answer ``{"available": False}`` instead of failing the import.
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any, Dict, Union


class WindowsSecurityError(OSError):
    """Raised when a private-data file or directory is not owner-private."""


_ALLOWED_PRINCIPAL_FRAGMENTS = (
    "nt authority\\system",
    "builtin\\administrators",
    "mandatory label\\",
    "creator owner",
    "owner rights",  # S-1-3-2: evaluates to the current owner
)
_ALLOWED_PRINCIPAL_SIDS = frozenset(
    {
        "s-1-5-18",  # LOCAL SYSTEM
        "s-1-5-32-544",  # BUILTIN\Administrators
        "s-1-3-0",  # CREATOR OWNER (evaluates to the object owner)
    }
)
_ACE_LINE = re.compile(r"^(?P<principal>.+?):(?P<aces>(?:\([^()]*\))+)$")


def _identity_cache():
    global _IDENTITY_CACHE
    try:
        return _IDENTITY_CACHE
    except NameError:
        _IDENTITY_CACHE = _load_identity()
        return _IDENTITY_CACHE


def _load_identity() -> Dict[str, Any]:
    names: set[str] = set()
    user = os.environ.get("USERNAME", "").strip()
    domain = os.environ.get("USERDOMAIN", "").strip()
    if user:
        names.add(user.casefold())
        if domain:
            names.add(("%s\\%s" % (domain, user)).casefold())
    sid = ""
    try:
        completed = subprocess.run(
            ["whoami", "/user", "/fo", "csv", "/nh"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
        )
        if completed.returncode == 0:
            lines = [line for line in completed.stdout.splitlines() if line.strip()]
            if lines:
                row = next(csv.reader([lines[-1]]), [])
                if len(row) >= 2:
                    names.add(row[0].strip().casefold())
                    sid = row[1].strip()
    except (OSError, StopIteration, ValueError, csv.Error):
        sid = ""
    return {"names": names, "sid": sid.casefold()}


def _current_user_grant_spec() -> str:
    identity = _identity_cache()
    if identity["sid"]:
        return "*%s" % identity["sid"]
    user = os.environ.get("USERNAME", "")
    domain = os.environ.get("USERDOMAIN", "")
    if user and domain:
        return "%s\\%s" % (domain, user)
    raise WindowsSecurityError("cannot determine the current Windows user")


def _run_icacls(*args: str) -> subprocess.CompletedProcess:
    try:
        # icacls prints in the console codepage; replace instead of raising so
        # non-UTF-8 principal names degrade to U+FFFD and fail the allow-list.
        return subprocess.run(
            ["icacls", *args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
    except OSError as exc:
        raise WindowsSecurityError("icacls is unavailable") from exc


def _principal_allowed(principal: str, identity: Dict[str, Any]) -> bool:
    folded = principal.strip().casefold()
    if folded.startswith("*"):
        return folded[1:] == identity["sid"] and bool(identity["sid"])
    if folded in _ALLOWED_PRINCIPAL_SIDS:
        return True
    if any(fragment in folded for fragment in _ALLOWED_PRINCIPAL_FRAGMENTS):
        return True
    if identity["sid"] and folded == identity["sid"]:
        return True
    return folded in identity["names"]


def _parse_icacls_principals(path: Path, output: str):
    prefix = str(path)
    principals = []
    for index, line in enumerate(output.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        if index == 0 and stripped.casefold().startswith(prefix.casefold()):
            stripped = stripped[len(prefix) :].strip()
        match = _ACE_LINE.match(stripped)
        if match:
            principals.append(match.group("principal").strip())
    return principals


def _validate_acl_output(path: Path, output: str) -> None:
    identity = _identity_cache()
    principals = _parse_icacls_principals(path, output)
    if not principals:
        raise WindowsSecurityError("could not read the Windows ACL for %s" % path)
    for principal in principals:
        if not _principal_allowed(principal, identity):
            raise WindowsSecurityError(
                "ACL grants access outside the owning user: %r" % principal
            )


def harden_private_data_acl(path: Union[str, os.PathLike]) -> None:
    """Restrict ``path`` to the current user; required before storing private data."""
    if os.name != "nt":
        return
    target = Path(path)
    is_directory = target.is_dir()
    rights = "(OI)(CI)(F)" if is_directory else "(F)"
    completed = _run_icacls(
        str(target),
        "/inheritance:r",
        "/grant:r",
        "%s:%s" % (_current_user_grant_spec(), rights),
    )
    if completed.returncode != 0:
        raise WindowsSecurityError(
            "icacls could not harden %s: %s"
            % (target, (completed.stderr or completed.stdout or "").strip())
        )


def validate_private_data_acl(path: Union[str, os.PathLike]) -> None:
    """Fail closed unless every ACE on ``path`` is owner/SYSTEM/Administrators."""
    if os.name != "nt":
        mode = Path(path).stat().st_mode
        if mode & 0o077:
            raise WindowsSecurityError("%s is group or world accessible" % path)
        return
    target = Path(path)
    completed = _run_icacls(str(target))
    if completed.returncode != 0:
        raise WindowsSecurityError(
            "icacls could not read %s: %s"
            % (target, (completed.stderr or completed.stdout or "").strip())
        )
    _validate_acl_output(target, completed.stdout or "")


def _path_from_fd(fd: int) -> str:
    import ctypes
    from ctypes import wintypes

    import msvcrt

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetFinalPathNameByHandleW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    kernel32.GetFinalPathNameByHandleW.restype = wintypes.DWORD
    try:
        handle = msvcrt.get_osfhandle(fd)
    except OSError as exc:
        raise WindowsSecurityError("invalid file descriptor") from exc
    buffer = ctypes.create_unicode_buffer(1024)
    length = kernel32.GetFinalPathNameByHandleW(
        wintypes.HANDLE(handle), buffer, 1024, 0
    )
    if not length:
        raise WindowsSecurityError(
            "cannot resolve the open file path for ACL validation"
        )
    resolved = buffer.value
    if resolved.startswith("\\\\?\\"):
        resolved = resolved[4:]
    return resolved


def validate_private_data_fd(fd: int) -> None:
    """Validate that the already-open ``fd`` is only readable by its owner."""
    if os.name != "nt":
        mode = os.fstat(fd).st_mode
        if mode & 0o077:
            raise WindowsSecurityError("file is group or world accessible")
        return
    validate_private_data_acl(_path_from_fd(fd))


def check_acl(path: Union[str, os.PathLike]) -> Dict[str, bool]:
    """Report effective read/write access for the current user."""
    target = Path(path)
    try:
        target.stat()
    except OSError:
        return {"readable": False, "writable": False}
    return {
        "readable": bool(os.access(target, os.R_OK)),
        "writable": bool(os.access(target, os.W_OK)),
    }


def get_windows_defender_status() -> Dict[str, Any]:
    """Read Get-MpComputerStatus; never raises, never contacts the network."""
    if os.name != "nt":
        return {"available": False}
    fields = (
        "AMServiceEnabled",
        "AntivirusEnabled",
        "RealTimeProtectionEnabled",
        "BehaviorMonitorEnabled",
        "IoavProtectionEnabled",
        "NISEnabled",
        "AntivirusSignatureLastUpdated",
    )
    command = (
        "(Get-MpComputerStatus | Select-Object %s | ConvertTo-Json)"
        % ",".join(fields)
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {"available": False}
    if completed.returncode != 0:
        return {"available": False}
    try:
        status = json.loads(completed.stdout)
    except ValueError:
        return {"available": False}
    if not isinstance(status, dict):
        return {"available": False}
    result: Dict[str, Any] = {"available": True}
    for key, value in status.items():
        if isinstance(value, (bool, int, float, str)) or value is None:
            result[key] = value
    return result
