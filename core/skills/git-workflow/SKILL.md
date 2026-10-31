---
name: git-workflow
description: Use when performing git operations — commits, branches, rebases, merges, conflict resolution, history cleanup, or recovering lost work.
---

# Git Workflow

## Commits
- One logical change per commit. Message: imperative subject under 72 chars, blank line, then why (not what).
- Never commit secrets, build output, or editor state. Check `git diff --cached` first.

## Branches
- Branch from the default branch, name by intent: `feat/<intent>`, `fix/<intent>`, `chore/<intent>`.
- Rebase local unpublished work; merge published history.

## Safety
- Before any destructive operation (`reset --hard`, `clean -fd`, force push), state exactly what will be lost.
- Never force push a shared branch without explicit confirmation.
- Recover with `git reflog` before assuming work is gone.
