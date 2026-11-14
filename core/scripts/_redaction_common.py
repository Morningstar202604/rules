#!/usr/bin/env python3
"""Shared secret/leak scanner for AQG skill helpers (repo-level ``scripts/``).

Skill helpers add ``<install-root>/scripts`` to ``sys.path`` (resolved from
``Path(__file__).resolve().parents[3]``) and import ``scan_leaks`` from here,
e.g. ``aqg-decision-capture``. Fail-closed contract: callers keep a sentinel
(``scan_leaks = None``) when this module is absent and refuse to certify
content clean; this module existing makes that fallback path unnecessary.

Pure stdlib, no I/O, no third-party dependencies.

Two call shapes share one engine:

1. Helper form (used by the skill CLIs) — appends *category-only* violation
   strings to ``violations`` and returns ``None``. Messages never contain the
   raw matched value, so they are safe to print into reports and errors::

       scan_leaks(name, value, violations, multiline=False)

2. Convenience form — single text argument, returns structured matches.
   ``match`` carries the raw matched text; the caller owns what it prints::

       scan_leaks(text)  -> [{"type": ..., "line": ..., "col": ..., "match": ...}, ...]

Coverage (basic patterns, tuned to avoid flagging ordinary prose / pointers):
- GitHub tokens (``ghp_`` and the ``gh[posur]_`` family)
- OpenAI / Anthropic style ``sk-`` keys (classic and ``sk-ant-``/``sk-proj-``)
- Slack tokens (``xoxb-`` and the ``xox[abprs]-`` family)
- ``Bearer`` authorization headers with a token-looking payload
- AWS access key IDs (``AKIA…`` / ``ASIA…``, 16 uppercase-alnum tail) — the
  shape ``_redaction_common.scan_leaks must catch`` per decision-capture tests
- Stripe live keys (``sk_live_`` / ``rk_live_`` / ``whsec_``)
- PEM private-key blocks (``multiline=True`` scans only)
- long base64-ish runs (>= 40 chars) — the heuristic the decision-capture
  grammar leans on when it caps ``commit:<sha>`` pointers at 12 hex chars so
  they never trip it

CLI smoke test: ``python3 _redaction_common.py < file`` prints the JSON match
list on stdout and exits 1 when anything is found, 0 when clean.
"""

from __future__ import annotations

import json
import re
import sys

__all__ = ["scan_leaks", "scan", "PATTERN_TYPES"]

# Line-oriented patterns applied per line. Order is cosmetic only; every
# pattern is independent and a span may be reported under several categories.
_LINE_PATTERNS: list[tuple[str, re.Pattern]] = [
    # GitHub personal/oauth/server tokens: ghp_ + 36 alnum (allow shorter).
    ("github-token", re.compile(r"\bgh[posur]_[A-Za-z0-9]{16,}\b")),
    # OpenAI classic keys are pure alnum after sk-; the prefixed families
    # (sk-ant-, sk-proj-) may carry - and _ in the tail. Requiring 20+ chars
    # (or the family prefix) keeps prose like "sk-learn-pipeline" clean.
    ("openai-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}\b")),
    ("openai-key", re.compile(r"\bsk-proj-[A-Za-z0-9_-]{16,}\b")),
    ("openai-key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    # Slack: xoxb- (bot) and the xox[abprs]- family.
    ("slack-token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    # Canonical Authorization header form; payload must be token-ish (>= 16
    # contiguous token chars) so lowercase prose like "bearer tokens" stays clean.
    ("bearer-token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    # AWS access key IDs (the decision-capture test fixture shape).
    ("aws-access-key-id", re.compile(r"\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b")),
    # Stripe live keys / signing secrets.
    ("stripe-key", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b|\bwhsec_[A-Za-z0-9]{16,}\b")),
    # Long base64-ish run (>= 40 chars, optional = padding). Deliberately the
    # same 40-char threshold the decision-capture docs reference. No trailing
    # \b so a run ending in '=' padding still matches.
    ("long-base64", re.compile(r"\b[A-Za-z0-9+/]{40,}={0,2}")),
]

# Multi-line patterns (multiline=True only): PEM private key blocks.
_PEM_PATTERN: re.Pattern = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.DOTALL,
)

PATTERN_TYPES: tuple[str, ...] = tuple(dict.fromkeys(p[0] for p in _LINE_PATTERNS)) + (
    "pem-private-key",
)


def scan(text: str, multiline: bool = False) -> list[dict]:
    """Scan ``text`` and return matches as dicts with ``type``, ``line``,
    ``col`` (both 1-based) and ``match`` (raw matched text).

    ``multiline=True`` additionally scans for multi-line constructs (PEM
    private-key blocks); line/col stay accurate because matching runs over
    ``splitlines()`` for the line patterns.
    """
    hits: list[dict] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for ptype, rx in _LINE_PATTERNS:
            for m in rx.finditer(line):
                hits.append(
                    {"type": ptype, "line": lineno, "col": m.start() + 1, "match": m.group(0)}
                )
    if multiline:
        for m in _PEM_PATTERN.finditer(text):
            lineno = text.count("\n", 0, m.start()) + 1
            col = m.start() - (text.rfind("\n", 0, m.start()) + 1) + 1
            hits.append(
                {"type": "pem-private-key", "line": lineno, "col": col, "match": m.group(0)}
            )
    return hits


def scan_leaks(
    name_or_text: str,
    value: str | None = None,
    violations: list[str] | None = None,
    multiline: bool = False,
) -> list[dict] | None:
    """Dual-form leak scan (see module docstring for the contract).

    Helper form: ``scan_leaks(name, value, violations, multiline=False)``
    appends category-only strings like ``"rationale: aws-access-key-id
    (line 1, col 12)"`` to ``violations`` — never the raw value.

    Convenience form: ``scan_leaks(text)`` (or ``scan_leaks(text,
    multiline=True)``) returns the structured match list from :func:`scan`.
    """
    if violations is None:
        # Convenience form: scan_leaks(text) -> list[dict]
        return scan(name_or_text, multiline=multiline)
    if value is None:
        raise TypeError(
            "scan_leaks expects (text) or (name, value, violations[, multiline])"
        )
    for hit in scan(value, multiline=multiline):
        violations.append(f"{name_or_text}: {hit['type']} (line {hit['line']}, col {hit['col']})")
    return None


def _main(argv: list[str]) -> int:
    """Smoke-test CLI: scan stdin, print JSON matches, exit 1 on any hit."""
    del argv  # no flags; kept argument-free on purpose
    text = sys.stdin.read()
    hits = scan(text, multiline=True)
    print(json.dumps(hits, ensure_ascii=False, indent=2))
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
