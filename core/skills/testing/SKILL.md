---
name: testing
description: Use when writing, fixing, or reasoning about tests — unit, integration, end-to-end — or when deciding what to test and how much coverage is enough.
---

# Testing

## Principles
- Test behavior through public interfaces, not implementation details.
- One assertion concept per test; name tests by the behavior they protect.
- Arrange / Act / Assert, with the smallest possible arrange.
- Every bug fix ships with a regression test that fails before the fix.

## What to cover
- Boundaries: empty, single, many, max, negative, null, unicode.
- Failure paths: invalid input, timeouts, partial writes, permission denied.
- Concurrency only where it exists.

## What to avoid
- Snapshot tests for logic.
- Sleep-based waits; poll or await a real signal.
- Tests that pass when the code is deleted (assert nothing).
