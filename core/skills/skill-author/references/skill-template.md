# SKILL.md Fill-in Template

> Copy this file to `skills/<category>/<skill-name>/SKILL.md`, replace all `<...>` with real values.
> Machine-layer fields (frontmatter) in English, body prose in English. After filling, run the parent skill's Step 5 inline self-check (`skill-linter` is a separate optional skill, not bundled at `skills/meta/skill-linter/`).
> Target line count 150-190; below 150 means failure branches aren't fully written, above 190 means knowledge should move to `references/`.
> Contents: frontmatter fields · body workflow · parameter reference · failure handling · delivery standards

---

```markdown
---
name: <kebab-case-action-phrase>            # must match the directory name verbatim
description: >
  <what it does, one sentence>. Use when the user asks to <english trigger 1> / <english trigger 2> /
  <english trigger 3> / <english trigger 4>, or <english scenario>. Do NOT use for <exclusion 1> or
  <exclusion 2>.
                                # ↑ english triggers + chinese triggers total >=5, must include exclusions
  # Additional triggers follow right after the "when the user asks for ..." introducer:
  # when the user asks for <trigger 1> / <trigger 2> / <trigger 3>.
license: Apache-2.0
compatibility: <runtime requirements; required when depending on network/system packages/local services, otherwise optional>
metadata:
  author: "<attribution>"
  version: "1.0"
  category: <category, e.g. meta / media-generation / content-publishing>
  pattern: single-task
  tier: standard
  verified-date: "<YYYY-MM-DD>"
---

# <English Name> (<Chinese name>)

<Opening paragraph: what input this skill turns into what output, which tool it uses, what it does not do.>

## Input Checklist

| Input | Required | Default | Notes |
|---|---|---|---|
| <main input> | yes | — | <what the user's original request looks like> |
| <option A> | no | <default value> | <value range> |
| <option B> | no | <default value> | <value range> |

When required input is missing, ask for everything at once; the rest fill in with defaults:

> Please provide: ① <required 1>. Optionally tell me: ② <option A, default X>, ③ <option B, default Y>.

## Pre-flight Self-check

Run item by item; any failure → take the handling action, then STOP:

```bash
# 1. <dependency check>
<probe command>
# Expected: <observable criterion>. Failure → <fix action>.

# 2. <input check>
<probe command>
# Expected: <observable criterion>. Failure → <fix action>.
```

## Workflow

### Step 1: <short phrase starting with a verb>

- **Action**: <precise command or operation; do not write non-executable descriptions like "take a look">
- **Expected**: <exit code / file exists / field value; must be observable>
- **If it fails**: <error signature> → <handling action>; if still failing, <degrade or STOP>.

### Step 2: <short phrase starting with a verb>

- **Action**:
- **Expected**:
- **If it fails**:

### Step 3: <short phrase starting with a verb>

- **Action**:
- **Expected**:
- **If it fails**:

## Parameter Quick Reference

| Parameter | Values | Notes |
|---|---|---|
| `<--flag>` | <value domain> | <when to change it> |

## Failure Handling Table

| Symptom/error code | Cause | Handling |
|---|---|---|
| <error text or exit code> | <root cause> | <specific action> |
| <error text or exit code> | <root cause> | <specific action> |
| <error text or exit code> | <root cause> | <specific action> |
| <error text or exit code> | <root cause> | <specific action> |

## Delivery Standards

- Success definition: <what counts as success, in decidable statements>
- Artifact naming: <fixed format, e.g. output_YYYYMMDD_HHmmss.ext>
- Storage location: <path rule>
- Completeness verification: <verification command or checklist>

## References

- references/<topic>.md — <when to read it, one sentence>
- references/sources-and-methodology.md — methodology provenance and originality statement.
```

---

## Ten-Commandment Skeleton (check off after filling)

| # | Commandment | Where it lands in the template |
|---|---|---|
| 1 | No implicit assumptions | "Expected" in pre-flight self-check and "Symptom" in the failure table show the original appearance |
| 2 | Ask everything at once | The follow-up template under Input Checklist |
| 3 | Red lines inline | The "confirm before irreversible operations" line in the workflow |
| 4 | Each step gives action + expected + if-fails | The trio in each `### Step N` of the workflow |
| 5 | Body <200 lines | Move details into `references/` before hitting 190 lines |
| 6 | Body in English | Paragraph prose; keep terms and code in original |
| 7 | Frontmatter machine layer in English | The `name` / `description` two fields |
| 8 | References attributed | The last `references/` entry |
| 9 | dry-run by default | When there's a script: write operations must explicitly pass `--execute` |
| 10 | Verifiable output | The four delivery standards |

## Additional Conventions for Script-Based Skills

When there's a script, `compatibility` states the runtime; the script directory is fixed as `scripts/` and must satisfy:

1. Every subcommand supports `--dry-run`, and **dry-run is the default**; real disk writes/releases require `--execute`;
2. On startup, probe dependencies; if missing, print the install command and exit with a non-zero code;
3. Pure-logic functions separated from I/O; pure functions can be imported directly by `tests/`;
4. `--help` is part of the contract; renaming a subcommand is considered a breaking change.
