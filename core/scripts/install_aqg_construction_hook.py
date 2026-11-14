#!/usr/bin/env python3
"""Print manual installation instructions for the AQG construction pre-commit hook.

Deliberately INERT: this helper never writes hooks, config, or state. Per the
aqg-code-construction SKILL.md setup contract ("one-time manual provisioning
steps a human runs per repo"; GUIDE §6.1) hook installation is a human step —
the checker ``aqg_construction_check.py`` does not write project files either,
and a script silently rewriting agent/git config would cross a trust boundary.

Usage::

    python3 install_aqg_construction_hook.py --target-repo /path/to/repo

It only READS ``--target-repo`` (existence / .git presence) to tailor the
printed instructions, then explains the manual steps: where to put the
pre-commit hook, the exact hook body (with the checker path resolved from
this script's own location), the ``AQG_AGENT`` opt-in values, and the
companion ``.aqg/`` workspace setup. Exits 0 after printing; a missing
target repo only changes the printed warning, never the filesystem.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

__all__ = ["main"]

CHECKER_REL = Path("skills") / "aqg-code-construction" / "scripts" / "aqg_construction_check.py"
AGENT_VALUES = ("codex", "claude", "human-opt-in", "ci-rerun")

HOOK_BODY = """\
#!/bin/sh
# AQG construction gate (installed BY HAND; opt-in via AQG_AGENT).
# Without AQG_AGENT set this hook passes transparently for human commits.
if [ -z "$AQG_AGENT" ]; then
  exit 0
fi
exec python3 "{checker}" --mode staged --quiet
"""


def _build_instructions(target: Path) -> str:
    lines: list[str] = []
    aqg_root = Path(__file__).resolve().parents[1]
    checker = aqg_root / CHECKER_REL
    hook_path = target / ".git" / "hooks" / "pre-commit"
    lines.append("AQG construction pre-commit hook — MANUAL installation steps")
    lines.append("=" * 64)
    lines.append("")
    lines.append("This helper made NO changes (print-only by design). Do these by hand:")
    lines.append("")
    lines.append(f"1. Target repo: {target}")
    if not target.is_dir():
        lines.append("   WARNING: target directory does not exist (instructions are generic).")
    elif not (target / ".git").exists():
        lines.append("   WARNING: no .git found here — adjust the hook path to your")
        lines.append("   actual hooks directory (or set git config core.hooksPath).")
    lines.append(f"2. Create the hook file: {hook_path}")
    lines.append("   with EXACTLY this body (checker path already resolved):")
    lines.append("")
    lines.append(HOOK_BODY.format(checker=checker))
    lines.append("3. Make it executable:   chmod +x .git/hooks/pre-commit")
    lines.append(
        "4. Opt in per agent (the hook ONLY enforces when AQG_AGENT is one of: "
        + ", ".join(AGENT_VALUES)
        + "):"
    )
    lines.append("     AQG_AGENT=codex git commit -m \"...\"")
    lines.append("5. Create the ledger workspace and keep it out of git:")
    lines.append("     mkdir -p .aqg/code-construction")
    lines.append("     grep -qxF '.aqg/' .gitignore 2>/dev/null || echo '.aqg/' >> .gitignore")
    lines.append("6. Check manually any time:")
    lines.append(f'     python3 "{checker}" --mode staged')
    lines.append("")
    lines.append(
        "Exit codes of the checker: 0 PASS, 1 fail-closed, 2 secret in ledger, "
        "3 ledger missing/malformed, 4 size mismatch, 5 anti-pattern block, "
        "6 objection malformed."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="install_aqg_construction_hook.py",
        description=(
            "Print manual installation instructions for the AQG construction "
            "pre-commit hook. Print-only: nothing is written to the target repo "
            "or to any agent config."
        ),
    )
    parser.add_argument(
        "--target-repo",
        default=".",
        help="repository that should receive the hook (read-only check; default: cwd)",
    )
    args = parser.parse_args(argv)
    print(_build_instructions(Path(args.target_repo).expanduser()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
