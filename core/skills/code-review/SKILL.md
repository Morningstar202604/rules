---
name: code-review
description: Use when reviewing code changes, pull requests, diffs, or a codebase for quality, security, correctness, or maintainability issues. Produces prioritized, evidence-based findings.
---

# Code Review

Review the requested code and report findings ordered by severity.

## Process
1. Read the diff or target files fully before judging.
2. Check correctness first: logic errors, edge cases, error handling, resource cleanup.
3. Check security: injection, secrets, unsafe deserialization, path traversal, missing authz.
4. Check maintainability: duplication, naming, dead code, missing tests.
5. Check performance only where it matters (hot paths, N+1 queries, unbounded work).

## Output
- `[BLOCKER]` must fix before merge — cite file:line and explain the failure mode.
- `[MAJOR]` should fix — correctness or security risk under realistic conditions.
- `[MINOR]` nice to have — style, naming, readability.
- `[QUESTION]` unclear intent, ask rather than assume.

Never invent issues. If a section is clean, say so briefly.
