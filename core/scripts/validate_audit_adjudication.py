#!/usr/bin/env python3
"""Adjudication-table validator for the aqg-audit-adjudication skill.

Lives at repo-level ``scripts/validate_audit_adjudication.py`` (referenced as
the skill's ``entry_script`` in skill.template.json and by the SKILL.md
Validator section). ``aqg-audit-adjudication/scripts/self_test.py`` imports
this module from ``parents[3]/scripts`` and locks its API:

- ``validate_text(text) -> (ok, issues, counts)`` — ``counts`` always carries
  exactly the canonical keys ``accepted`` / ``rejected`` / ``needs-user-decision``
  (values may be 0);
- ``decision_class(cell) -> str`` — canonical class or ``""`` when unknown;
- ``split_cells(line) -> list[str]`` — GFM row splitting that keeps inline
  code spans (`` `a | b` ``) and backslash-escaped pipes (``\\|``) intact.

Enforced invariants (skill.template contract): the table header must carry
exactly the ``finding`` / ``decision`` / ``action`` / ``verification`` columns
(no missing / extra / duplicate columns), a separator row, matched row widths,
no empty or placeholder cells, and every ``needs-user-decision`` row must name
who and what is awaited. Canonical decision values are ``accepted`` /
``rejected`` / ``needs-user-decision``; the coarse ``accept`` / ``reject`` /
``defer`` vocabulary and Chinese / Owner-decision aliases are accepted for
legacy notes (see ``_ALIASES``).

CLI verdict JSON::

    python3 validate_audit_adjudication.py path/to/adjudication.md   # file mode
    cat adjudication.md | python3 validate_audit_adjudication.py     # stdin
    cat ledger.json     | python3 validate_audit_adjudication.py     # JSON ledger

Prints ``{"ok": bool, "issues": [...], "counts": {...}}`` and exits 0 (valid)
/ 1 (violations) / 2 (usage or unreadable input). Issues are category-only:
a poisoned cell may carry a secret, so issue text never echoes cell values.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

__all__ = ["validate_text", "decision_class", "split_cells", "main"]

REQUIRED_COLUMNS: tuple[str, ...] = ("finding", "decision", "action", "verification")

# Canonical decision vocabulary + legacy aliases (Owner decisions / Chinese).
_ALIASES: dict[str, set[str]] = {
    "accepted": {"accepted", "accept", "approved", "采纳", "接受", "同意", "通过"},
    "rejected": {"rejected", "reject", "won't fix", "wontfix", "拒绝", "驳回", "否决"},
    "needs-user-decision": {
        "needs-user-decision",
        "needs user decision",
        "need-user-decision",
        "needs-owner-decision",
        "needs owner decision",
        "ask-user",
        "ask user",
        "defer",
        "deferred",
        "待定",
        "待用户决策",
        "需用户决策",
        "需要用户决策",
        "待用户决定",
        "需所有者决策",
        "需要所有者决策",
    },
}

# Template/placeholder cells (the SKILL.md skeleton ships these).
_PLACEHOLDER_RE = re.compile(r"^<[^<>]*>$")
_PLACEHOLDER_WORDS = {"...", "…", "tbd", "todo", "xxx", "placeholder"}
_SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")

# needs-user-decision detail: the row must name what is awaited and who must act.
_AWAIT_HINTS = (
    "ask", "asking", "await", "awaiting", "wait", "waiting", "pending",
    "escalate", "escalating", "consult", "confirm", "confirmation",
    "approve", "approval", "authorize", "authorization", "sign-off", "signoff",
    "需", "待", "请示", "询问", "征求", "咨询", "等待", "等候", "确认", "批准", "审批", "授权", "决策",
)
_WHO_HINTS = (
    "owner", "user", "admin", "maintainer", "team", "lead", "reviewer",
    "approver", "manager", "stakeholder",
    "所有者", "负责人", "用户", "团队", "管理员", "领导", "审批人", "老板", "导师",
)
_WHO_MENTION_RE = re.compile(r"@\w+")


def split_cells(line: str) -> list[str]:
    """Split one GFM table row into raw cells.

    Inline code spans (`` ` ``) and backslash-escaped pipes (``\\|``) do not
    split; the enclosing leading/trailing pipes do not create phantom cells.
    """
    s = line.strip()
    cells: list[str] = []
    buf: list[str] = []
    in_code = False
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if ch == "`":
            in_code = not in_code
            buf.append(ch)
            i += 1
            continue
        if ch == "|" and not in_code:
            cells.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    cells.append("".join(buf))
    if cells and s.startswith("|") and cells[0].strip() == "":
        cells = cells[1:]
    if cells and s.endswith("|") and cells[-1].strip() == "":
        cells = cells[:-1]
    return cells


def decision_class(cell: str) -> str:
    """Map one decision cell to a canonical class (``""`` when unrecognized).

    Tolerates emphasis wrappers (``**accepted**``), backticks, whitespace and
    the legacy alias vocabulary in ``_ALIASES``.
    """
    s = cell.strip().strip("`*_~ \t").lower()
    s = " ".join(s.split())
    if not s:
        return ""
    for canonical, variants in _ALIASES.items():
        if s in variants:
            return canonical
    return ""


def _cell_problem(cell: str) -> str:
    """Return a category-only problem description for one cell ("" = clean)."""
    raw = cell.strip()
    if not raw:
        return "is empty"
    if raw.strip("`*_ \t") == "":
        return "is empty (emphasis wrapper only)"
    if _PLACEHOLDER_RE.match(raw):
        return "is a template placeholder (<...>)"
    if raw.strip("`*_ \t").lower() in _PLACEHOLDER_WORDS:
        return "is a placeholder (tbd/todo/...)"
    return ""


def _check_await_detail(lineno: int, cells: list[str], positions: dict, issues: list[str]) -> None:
    """A needs-user-decision row must name who must act and what is awaited."""
    combined = " ".join(
        cells[positions[c]] for c in ("action", "verification") if c in positions
    ).lower()
    has_what = any(h in combined for h in _AWAIT_HINTS)
    has_who = any(h in combined for h in _WHO_HINTS) or bool(_WHO_MENTION_RE.search(combined))
    if not (has_what and has_who):
        issues.append(
            f"line {lineno}: needs-user-decision row must name who and what is awaited "
            "(e.g. action 'ask Owner for X', verification 'Owner approval recorded')"
        )


def _validate_table(rows: list[tuple[int, list[str]]], issues: list[str], counts: dict) -> bool:
    """Validate one pipe table; returns True when it is an adjudication table."""
    header_cells = [c.strip() for c in rows[0][1]]
    lowered = [h.lower() for h in header_cells]
    # Shape detection: only tables that look like adjudications (carry both
    # the finding and the decision column) are validated, so unrelated tables
    # in the same document are never flagged.
    if not {"finding", "decision"} <= set(lowered):
        return False
    first_line = rows[0][0]
    positions: dict[str, int] = {}
    dups: list[str] = []
    for idx, name in enumerate(lowered):
        if name in REQUIRED_COLUMNS:
            if name in positions:
                dups.append(name)
            else:
                positions[name] = idx
    missing = [c for c in REQUIRED_COLUMNS if c not in positions]
    extras = [h for h in header_cells if h.lower() not in REQUIRED_COLUMNS]
    if missing:
        issues.append(
            f"line {first_line}: adjudication table missing column(s): {', '.join(missing)}"
        )
    if extras:
        issues.append(
            f"line {first_line}: adjudication table has extra column(s): {', '.join(extras)}"
        )
    if dups:
        issues.append(
            f"line {first_line}: adjudication table has duplicate column(s): {', '.join(dups)}"
        )

    width = len(header_cells)
    sep_line, sep_cells = rows[1] if len(rows) > 1 else (None, None)
    is_separator = (
        sep_cells is not None
        and len(sep_cells) > 0
        and all(_SEPARATOR_CELL_RE.match(c.strip()) for c in sep_cells)
    )
    if sep_cells is None:
        issues.append(
            f"line {first_line}: adjudication table has no separator row "
            "(header must be followed by |---|---|...|)"
        )
        data_start = 1
    elif not is_separator:
        issues.append(
            f"line {sep_line}: missing separator row (header must be followed by |---|---|...|)"
        )
        data_start = 1
    else:
        if len(sep_cells) != width:
            issues.append(
                f"line {sep_line}: separator row has {len(sep_cells)} cells (expected {width})"
            )
        data_start = 2

    for lineno, cells in rows[data_start:]:
        if len(cells) != width:
            issues.append(
                f"line {lineno}: table row has {len(cells)} cells (expected {width}; "
                "misaligned rows are a hard violation, not skipped)"
            )
            continue
        for col in REQUIRED_COLUMNS:
            if col in positions:
                problem = _cell_problem(cells[positions[col]])
                if problem:
                    issues.append(f"line {lineno}: column '{col}' {problem}")
        if "decision" in positions:
            dec = decision_class(cells[positions["decision"]])
            if not dec:
                issues.append(
                    f"line {lineno}: decision is not a recognized disposition "
                    "(expected accepted/rejected/needs-user-decision or a known alias)"
                )
            else:
                counts[dec] += 1
                if dec == "needs-user-decision":
                    _check_await_detail(lineno, cells, positions, issues)
    return True


def validate_text(text: str) -> tuple[bool, list[str], dict[str, int]]:
    """Validate every adjudication-shaped table in ``text``.

    Returns ``(ok, issues, counts)``; ``counts`` always carries exactly the
    three canonical keys. ALL shaped tables are validated — a malformed one
    cannot hide behind a valid one later in the document.
    """
    issues: list[str] = []
    counts = {"accepted": 0, "rejected": 0, "needs-user-decision": 0}
    lines = text.splitlines()
    found = False
    current: list[tuple[int, list[str]]] = []
    for lineno, raw in enumerate(lines, start=1):
        if raw.lstrip().startswith("|"):
            current.append((lineno, split_cells(raw)))
            continue
        if current:
            found |= _validate_table(current, issues, counts)
            current = []
    if current:
        found |= _validate_table(current, issues, counts)
    if not found:
        issues.append(
            "no adjudication table found (header must carry the finding/decision/"
            "action/verification columns)"
        )
    return (not issues), issues, counts


# ===== JSON ledger mode (stdin): findings must carry a valid disposition =====

_FINDING_KEYS = ("finding", "description", "name", "id")
_DISPOSITION_KEYS = ("decision", "disposition", "status", "resolution")


def _validate_findings(data) -> tuple[bool, list[str], dict[str, int]]:
    """Validate a JSON ledger: ``{"findings": [...]}`` or a bare list."""
    issues: list[str] = []
    counts = {"accepted": 0, "rejected": 0, "needs-user-decision": 0}
    items = data.get("findings") if isinstance(data, dict) else data
    if not isinstance(items, list):
        issues.append('ledger JSON must be {"findings": [...]} or a list of findings')
        return False, issues, counts
    if not items:
        issues.append("ledger contains no findings")
    for i, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            issues.append(f"finding #{i}: must be an object")
            continue
        text_val = next(
            (item[k] for k in _FINDING_KEYS if isinstance(item.get(k), str) and item[k].strip()),
            None,
        )
        if text_val is None:
            issues.append(f"finding #{i}: missing/empty finding text")
        disp = next(
            (item[k] for k in _DISPOSITION_KEYS if isinstance(item.get(k), str) and item[k].strip()),
            None,
        )
        if disp is None:
            issues.append(
                f"finding #{i}: missing disposition "
                "(expected accept/reject/defer; canonical accepted/rejected/needs-user-decision)"
            )
            continue
        dec = decision_class(disp)
        if not dec:
            issues.append(
                f"finding #{i}: disposition must be accept/reject/defer "
                "(canonical accepted/rejected/needs-user-decision)"
            )
        else:
            counts[dec] += 1
    return (not issues), issues, counts


def _load_source_text(spec: str | None) -> tuple[str | None, str]:
    """Read the adjudication source: file path, ``-`` or None = stdin."""
    if spec in (None, "-"):
        return sys.stdin.read(), "<stdin>"
    path = Path(spec)
    try:
        return path.read_text(encoding="utf-8"), str(path)
    except (OSError, UnicodeError) as exc:
        print(f"ERROR: cannot read {path}: {type(exc).__name__}", file=sys.stderr)
        return None, str(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="validate_audit_adjudication.py",
        description=(
            "Validate an aqg-audit-adjudication table (markdown) or a JSON ledger "
            "of findings. With a path argument the file is validated as markdown; "
            "without one (or with '-') the source is read from stdin, auto-detected "
            "as JSON ledger or markdown. Prints a verdict JSON and exits 0 valid / "
            "1 violations / 2 usage-or-unreadable."
        ),
    )
    parser.add_argument(
        "adjudication",
        nargs="?",
        default=None,
        help="path to the adjudication .md (or ledger .json); '-' or omitted = stdin",
    )
    args = parser.parse_args(argv)
    text, label = _load_source_text(args.adjudication)
    if text is None:
        return 2
    stripped = text.lstrip()
    data = None
    if stripped[:1] in ("{", "["):
        try:
            data = json.loads(stripped)
        except ValueError:
            data = None  # not JSON after all: validate as markdown below
    if data is not None:
        ok, issues, counts = _validate_findings(data)
    else:
        ok, issues, counts = validate_text(text)
    print(
        json.dumps(
            {"ok": ok, "source": label, "issues": issues, "counts": counts},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
