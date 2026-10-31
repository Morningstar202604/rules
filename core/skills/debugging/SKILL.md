---
name: debugging
description: Use when diagnosing a bug, test failure, crash, hang, performance regression, or unexpected behavior. Drives a hypothesis-driven investigation instead of guessing.
---

# Debugging

## Process
1. Reproduce: get a deterministic failing case. Record exact command, input, environment.
2. Localize: binary-search the surface — which module, which commit, which config value.
3. Instrument: add the minimum logging/breakpoint needed to see state at the failure point.
4. Hypothesize: state one falsifiable cause, then design the smallest test that proves or disproves it.
5. Fix the root cause, not the symptom.
6. Prove it: rerun the failing case plus adjacent cases. Add a regression test.

## Rules
- Never change two variables at once.
- Never silence an error to make a test pass without understanding it.
- If three hypotheses fail, re-read the code instead of guessing again.
