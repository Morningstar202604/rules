---
name: feature-flags-architect
description: "Audit, plan and govern feature flags across their lifecycle: classify, ship, ramp, retire; includes rollout plans, release gates and flag-debt scans."
description_zh: "审计、规划并治理功能开关全生命周期，覆盖分类、上线、灰度放量与下线，含灰度发布计划、发布门禁与开关债务扫描。"
license: Apache-2.0
compatibility: Reads project structure via Bash and git. Requires Python 3.8+ (stdlib only) to run the bundled scripts.
metadata:
  opencode/autoinvoke: false
  version: "1.0"
  author: awesome-skillkit
  category: ai-engineering
  verified-date: "2026-09-09"
---

# Feature Flags Architect

The discipline of feature flags across their full lifecycle: classify, ship, ramp, retire. Most teams treat a flag as a throwaway `if` statement; this skill treats it as a controlled lifecycle with measurable debt.

## Input Checklist

| Input | Required | Description |
|------|------|------|
| Target repo path | No | `--repo`, defaults to the current directory `.`; used for code scanning and git introduction-time detection |
| Flag documentation path | No | For the kill-switch audit, `--flag-doc`, e.g. docs/feature-flags.md; if omitted, only a code-side scan is performed |
| Flag aging parameters | No | flag_debt_scanner's `--max-age-days` (default 90), `--min-uses` |
| Rollout parameters | No | rollout_planner's `--population --target-percent --duration-days --strategy` |
| Output format | No | `--format text\|json`; CI uses `json` |

When something is missing, ask for it all at once:
"Please provide: (1) target repo path (default `.`); (2) flag documentation path (needed for the kill-switch audit, e.g. docs/feature-flags.md; skip if none); (3) population size / target percentage / duration (for rollout); (4) debt half-life `--max-age-days` (default 90). I'll use defaults for everything else; once confirmed, I'll start."

## Pre-flight Checks

- Python 3.8+ is available: `python3 --version` → prints a version number (e.g. `Python 3.11.0`). If `command not found` or the version is <3.8 → prompt to install, then **STOP**.
- The three scripts are on disk: `test -f scripts/flag_debt_scanner.py && test -f scripts/rollout_planner.py && test -f scripts/kill_switch_audit.py` → all exist; if any is missing → **STOP** and report the specific filename.
- git is available (used to locate when a flag was introduced): run `git rev-parse --is-inside-work-tree` inside `--repo` → outputs `true`. If it is not a git repo, the debt scanner's "introduction time" criterion degrades to file mtime, and the user must be told about this degradation.

## Core Principle: a Flag Is a Lifecycle, Not an `if`

```text
request → design → ship → ramp → cleanup → archive
```

Flags that skip cleanup turn into debt: dead branches, stale defaults, untested code paths, and an uncontrolled blast radius. This skill's 3 scripts enforce that lifecycle.

## Workflow

### Step 1: Audit flag debt

```bash
python scripts/flag_debt_scanner.py --repo . --max-age-days 90 --format text
python scripts/flag_debt_scanner.py --repo . --max-age-days 60 --format json > debt.json
```

Action: scan the codebase to find flags older than `--max-age-days` with low usage frequency.
Expected: output the flag name, age (days), file references, and suggested action; exit code `0`; JSON mode writes to `debt.json`.
On failure: `FileNotFoundError` → check that the `--repo` path is correct; a `git` error → see the pre-flight degradation note.

### Step 2: Design a progressive rollout

```bash
python scripts/rollout_planner.py --population 100000 --target-percent 100 --duration-days 14 --strategy ring
python scripts/rollout_planner.py --population 50000 --target-percent 25 --duration-days 7 --strategy linear
python scripts/rollout_planner.py --population 1000000 --target-percent 100 --duration-days 30 --strategy log
```

Action: generate a staged release schedule from population size, target percentage, duration, and strategy.
Expected: output a markdown table with dates, percentages, expected user counts, abort criteria, and per-stage validation steps.
On failure: an invalid `--strategy` value → the script errors and lists `ring|linear|log|cohort`; a missing parameter → reports `required argument`.

### Step 3: Audit kill-switch documentation

```bash
python scripts/kill_switch_audit.py --repo . --flag-doc docs/feature-flags.md
python scripts/kill_switch_audit.py --repo . --flag-doc runbooks/flags.md --format json
```

Action: cross-check flags found in code against documentation, confirming that each has a documented kill-switch path.
Expected: report flags missing documentation (FAIL) or flags missing required fields (WARN); exit code `0` means the audit ran (it does not mean everything PASSED).
On failure: the `--flag-doc` file does not exist → `FileNotFoundError`; create the document first, then run it. Used as a pre-merge gate.

### Step 4: Choose a provider

See the decision tree in `references/provider_comparison.md`. Decision rules:
- <50 flags and no targeting → DIY (config file or environment variables)
- Need analytics + experiments → Statsig or GrowthBook
- Compliance / SOC2 audit logs → LaunchDarkly
- Must self-host (data residency / air-gapped) → Unleash or Flipt

### Step 5: Clean up debt (quarterly)

```bash
python scripts/flag_debt_scanner.py --repo . --max-age-days 90 > debt.md
```

For each hit: confirm it has reached 100% or has been killed → find the issue/PR that introduced it and get owner approval → delete the dead branch, remove the flag config → re-running kill_switch_audit.py should show one fewer flag. Finally, write "Removed N stale flags" in the CHANGELOG.

## 4 Flag Types (Taxonomy)

Different flag types have different lifecycles and owners. Misclassification produces debt.

| Type | Purpose | Typical lifespan | Owner | Cleanup trigger |
|---|---|---|---|---|
| **Release** | Hide unfinished features in production | Days–weeks | Engineering | Reaches 100% rollout |
| **Experiment** | A/B test variants | Weeks | Product/Marketing | Test ends, winner chosen |
| **Operational** | Circuit breakers, perf switches, kill switches | Months–years | Engineering/SRE | Replaced by autoscaling or feature retirement |
| **Permission** | Entitlements by user/account/plan | Years (permanent) | Product | Plan/role removed |

Only Release and Experiment flags should enter the debt-scan watchlist; Operational and Permission are designed to live long-term. See the decision tree in `references/flag_taxonomy.md`.

## 3 Python Tools

All three are stdlib-only; use `--help` to see the full parameter list.

### `flag_debt_scanner.py`

Finds flags older than `--max-age-days` with low usage, suggesting cleanup candidates.
**Detection heuristics:**
1. Match code references in `--repo` against common flag-call patterns:
   - `flag("...")`, `isFlagEnabled("...")`, `featureFlag("...")`, `getFlag("...")`
   - `client.variation("...", ...)`, `unleash.isEnabled("...")`, `growthbook.feature("...")`
2. For each unique flag identifier, find the earliest commit that introduced it (`git log --diff-filter=A -S <name>`).
3. If introduction time > `--max-age-days` and usage sites ≤ `--min-uses` → flag as DEBT.

Outputs the flag name, age (days), file references, and suggested action. JSON mode is CI-friendly.

### `rollout_planner.py`

Generates a staged release schedule from population size, target percentage, duration, and strategy.
**Strategies:**
- `ring`: 1% → 5% → 25% → 50% → 100%, evenly spaced. Default for high-risk releases.
- `linear`: constant rate each day. Default for medium-risk.
- `log`: fast early, slow tail. Default for confident low-risk.
- `cohort`: by named queue (internal → beta → free → paid → all).

Outputs a markdown table with dates, percentages, expected user counts, abort criteria, and per-stage validation steps.

### `kill_switch_audit.py`

Cross-checks flags found in code against documentation, confirming that each has a documented kill-switch path.
**Checks:**
1. Every code-discovered flag has an entry in `--flag-doc`
2. Every entry declares: owner, type, kill-switch trigger, monitoring dashboard
3. Reports flags missing documentation (FAIL) or missing fields (WARN)

Used as a pre-merge gate before any new flag ships.

## Provider Selection (5 + DIY)

| Provider | Best for | Pricing model | Lock-in risk | Open-source option |
|---|---|---|---|---|
| **LaunchDarkly** | Enterprise, complex targeting, audit/compliance | Per-MAU billing, high price | High | No |
| **GrowthBook** | Mid-market, A/B-test focused, open-source friendly | Per-MAU billing + open-source edition | Low | Yes (self-hosted) |
| **Statsig** | Growth/product teams, advanced experimentation | Free tier + per-MAU billing | Medium | No |
| **Unleash** | Open-source first, self-hosted, developer-friendly | Open-source edition + enterprise | Low | Yes |
| **Flipt** | Lightweight, k8s-native, simple needs | Open-source edition only | None | Yes |
| **DIY** | Fewer than 100 flags, no targeting, want full control | None | None | N/A |

See `references/provider_comparison.md` for details.

## Parameter Cheat Sheet

| Script | Parameter | Values | Description |
|------|------|------|------|
| flag_debt_scanner.py | `--repo` | path | Repo to scan, default `.` |
| | `--max-age-days` | integer | Flags older than this many days are debt candidates, default 90 |
| | `--min-uses` | integer | Only flagged when usage sites ≤ this value, default set by the script |
| | `--format` | `text\|json` | Output format, CI uses `json` |
| rollout_planner.py | `--population` | integer | Total user/request population |
| | `--target-percent` | 0–100 | Target coverage |
| | `--duration-days` | integer | Release duration in days |
| | `--strategy` | `ring\|linear\|log\|cohort` | Release curve |
| kill_switch_audit.py | `--repo` | path | Root for the code-side scan |
| | `--flag-doc` | path | Flag documentation (e.g. docs/feature-flags.md) |
| | `--format` | `text\|json` | Output format |

## Failure Handling Table

| Symptom / error | Cause | Action |
|-----------|------|------|
| `python3: command not found` or version <3.8 | Python not installed / too old | Install Python 3.8+ and rerun |
| `FileNotFoundError: <script>` | Script missing | Confirm `scripts/` is complete; if missing, STOP and report |
| `git rev-parse` error | Not a git repo | Degrade debt scan to file mtime and notify the user |
| `<flag-doc> not found` | Wrong doc path | Create/fix the `--flag-doc` path first |
| kill_switch_audit reports FAIL | Some flag has no kill-switch doc | Add the doc entry (owner/type/trigger/dashboard) and rerun |
| debt.json is empty | No overdue flags | Normal; no cleanup needed |

## Delivery Criteria

Definition of success: new flags pass `kill_switch_audit.py` at 100%; `flag_debt_scanner.py --max-age-days 90` returns ≤5 overdue flags across the whole repo; every flag has a documented owner, type, and kill switch; Release flags are retired on average within 60 days of reaching 100%.
Artifact naming/location: debt report `debt.md` or `debt.json` (user-specified path); the rollout schedule is printed directly to the conversation or written to a user-specified file.
Completeness verification: re-running the corresponding script returns exit code `0` and zero FAILs.

## References

- `references/flag_taxonomy.md` — read when classifying/choosing: 4-type flag decision tree, ownership, lifecycle
- `references/provider_comparison.md` — read when choosing a provider: 5 vendors + DIY trade-offs
- `references/rollout_strategies.md` — read when designing a ramp: ring/linear/log/cohort/geo, abort criteria, monitoring
- `references/flag_lifecycle.md` — read when designing the lifecycle/cleanup: request → design → ship → ramp → cleanup → archive

## Slash Commands

`/flag-cleanup` — run the full cleanup flow in the current repo: scan for debt, generate a removal plan, audit kill switches. (This slash command is not bundled in this pack — no `commands/` directory ships here; run the cleanup flow directly from this SKILL.md's workflow instead.)

## Asset Templates

- `assets/flag_request_template.md` — new-flag request form (name, owner, type, kill switch, rollout plan)

## Anti-patterns

- **`if (FLAG_FOO)` appears in 50 places with no end date** — it should be a Permission flag + runtime config, not a Release flag
- **A flag with no owner** — after the original author leaves, nobody cleans it up
- **No documented kill switch** — when a feature misbehaves, nobody knows how to disable it
- **An A/B test running for 6 months** — pick a winner; running indefinitely is debt
- **Using a flag for cosmetic tweaks** — ship it via deployment, not a flag
