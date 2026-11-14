---
name: skill-author
description: "Draft a new agent skill from scratch: clarify the need, name it, write a trigger-rich description, generate the SKILL.md skeleton and script args."
description_zh: "从零起草新 Agent 技能：命名、写触发描述、生成 SKILL.md 十段式骨架并设计带 argparse 的脚本"
license: Apache-2.0
compatibility: Pure prompt-based; optional python3 for the self-check step.
metadata:
  author: "awesome-skillkit"
  version: "1.0"
  category: meta
  pattern: single-task
  tier: standard
  verified-date: "2026-09-17"
---

# Skill Author (Skill Generator)

Turn a vague "I want the agent to be able to do X" into a ready-to-submit
SKILL.md: first clarify boundaries in one batch, then name and write triggers,
then fill the skeleton, finally self-check. The deliverable is the skill file
itself, not prose about skills.

This skill **doesn't write script logic** (only gives argparse subcommands and
dry-run design), **doesn't do full compliance checks** (`skill-linter` is a
separate optional skill; use the inline Step 5 self-check when it's absent).

## Input Checklist

| Input | Required | Default | Notes |
|---|---|---|---|
| Problem the skill solves | yes | — | One sentence, with usage scenario; not "make a tool" level |
| Owning scene pack / directory | no | inferred | e.g. `skills/meta/`, `skills/writing/blog/` |
| Contains scripts? | no | no script | If yes, must give subcommands and dependency list |
| Artifact form | no | text delivery | File naming and save location must be hard-coded |
| Creator attribution | no | repo default | Who fills `metadata.author` |

When required items are missing, **ask all 5 questions in one batch**, don't
back-and-forth:

> Please provide: 1) what specific problem does this skill solve (give a real
> trigger scenario)? 2) when should it trigger, and when absolutely not? 3) does
> it need scripts (if yes, describe input/output)? 4) what does the artifact look
> like (filename + save location)? 5) what happens on failure (retry / degrade /
> stop and ask human)?

## Pre-flight Checks

Run each in order; any failure → follow action, then STOP:

```bash
# 1. Python 3 available (only needed for skills with scripts)
python3 --version
# Expected: Python 3.8+. Failure → pure-prompt skills can continue; script skills STOP.

# 2. Target directory doesn't exist yet (avoid overwriting someone else's skill)
ls skills/<category>/<skill-name> 2>/dev/null || echo "OK-NEW"
# Expected: prints OK-NEW. Failure → directory exists; ask user "rename and create new" or "modify existing", don't overwrite directly.

# 3. Name not taken in repo
grep -rn "^name: <skill-name>$" skills/ | head
# Expected: no output. Failure → change name, avoid same-name as existing skill (same name causes pack reference ambiguity).
```

## Workflow

### Step 1: Need Clarification (Ask All 5 at Once)

- **Action**: Send the 5-question template from the input checklist verbatim.
  When user can't answer all, **supply marked defaults** for missing items
  (write `[TBD] default X`), don't block.
- **Expected**: 5 answers or marked defaults.
- **If it fails**: user only said "make a skill" with no content → restate
  template and make clear "without item 1 I can't start", STOP.

Three criteria for "worth making a skill": reusable multiple times, has clear
trigger phrases, has observable completion state. Missing any → suggest writing
into an existing skill's `references/` instead.

Naming mnemonic: **read the name once; if you can guess the trigger phrase it
passes.** `excel-merger` gets triggered by "merge these tables"; `data-helper`
doesn't, because no model would search for that word.

### Step 2: Naming and Description

- **Action**: name is a kebab-case **searchable action phrase** (`pdf-table-extractor`
  ✓, `helper` ✗, `utils` ✗). Description writes all four parts: what it does +
  English `Use when` trigger phrases + `Do NOT use for` exclusions, all in
  English; list **≥5 trigger phrases** separated by `/` (e.g. `merge tables /
  combine csv / join spreadsheets`).
- **Expected**: name matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is byte-identical to
  the directory name; description ≥40 and ≤1024 characters.
- **If it fails**: run the Step 5 inline self-check (below) and fix each
  failing item; `skill-linter` is optional and is not bundled at
  `skills/meta/skill-linter/` in this pack, so never block on it.

### Step 3: Skeleton Generation

- **Action**: Copy `references/skill-template.md`, fill blanks. 10 H2 headings
  must all be present: `## Input Checklist`, `## Pre-flight Checks`, `##
  Workflow`, `## Delivery Criteria`, `## Failure Handling Table`, `## References`
  (rest per template). **All prose — frontmatter and body — is in English**; keep
  code, flags, and file names verbatim.
- **Expected**: file 150-190 lines; each step contains "action / expected /
  if fails" trio.
- **If it fails**: under 150 lines usually means steps lack failure branches;
  over 190 usually means knowledge stuffed into body—move details into `references/`.

Four common skeleton variants (pick one, don't invent a seventh section):

| Variant | Appended Section | Suitable For |
|---|---|---|
| Platform publish | `## Parameter Quick Reference` + `## Platform-Specific Prompt` | One platform per skill, with credentials and rate limits |
| Tool wrapper | `## Command Quick Reference` | Wrapping a CLI, pure execution |
| Audit/scoring | `## Scoring Dimension Table` | Reports only, doesn't modify, e.g. skill-linter |
| Orchestration | `## Dependency Skill Table` | Chains multiple skills, doesn't do work itself |

### Step 4: Script Design (Script Skills Only)

- **Action**: Define argparse subcommands for the script, and **default dry-run**
  (real write/publish/delete must explicitly `--execute` or `--confirm`); detect
  dependencies at startup and give install hints; separate pure functions from
  I/O for unit testing.
- **Expected**: `python3 scripts/<name>.py --help` lists all subcommands; each
  subcommand has `--dry-run`.
- **If it fails**: script introduces non-stdlib dependency → prefer reverting to
  stdlib; if truly needed, write in `compatibility` and add detection.

### Step 5: Self-Check

- **Action**: Run the inline self-check below (no external linter required),
  then go through the Ten Commandments line by line.

  ```bash
  d=<skill directory>
  sed -n 's/^name:[[:space:]]*//p' "$d/SKILL.md" | head -1            # == basename "$d"
  sed -n 's/^description:[[:space:]]*//p' "$d/SKILL.md" | head -1 | wc -c  # 40-1024 + "Use when"
  wc -l < "$d/SKILL.md"; grep -c '^## ' "$d/SKILL.md"                # 150-190 (max 220); H2 >= 6
  test -f "$d/references/sources-and-methodology.md" && echo REF-OK
  ```
- **Expected**: all five checks pass plus the Ten Commandments; advisory
  shortfalls are judgment calls, not defects.
- **If it fails**: fix and rerun; don't call it "done" until name sync,
  references and the Commandments are clean.
- **Note**: `skill-linter` is a separate optional skill, not bundled at
  `skills/meta/skill-linter/`; run it if present, never block on its absence.

## Ten Commandments (Body Writing, Hard)

| # | Commandment | Criterion (what counts as violation) |
|---|---|---|
| 1 | **Zero implicit assumptions** | "obviously / as everyone knows / routine operation" appears, or error original message shape isn't written |
| 2 | **Ask all at once** | Input checklist has required items but no one-batch follow-up template |
| 3 | **Red lines inline** | Has write operation but doesn't say "default dry-run" or "confirm before irreversible operation" |
| 4 | **Every step gives action+expected+if fails** | Any step missing one of three |
| 5 | **Body <200 lines** | Line count over limit means skill should split or move to references |
| 6 | **Body all English** | Narrative prose contains non-script CJK characters (terms, flags, and fenced code excepted); this repo standard is English-only |
| 7 | **Frontmatter machine layer English** | `name` or `description` contains non-ASCII text; model routing degrades |
| 8 | **References attributed** | `references/` has files but no `sources-and-methodology.md` |
| 9 | **dry-run default** | Script skill where write operation is default behavior |
| 10 | **Verifiable output** | Delivery criteria doesn't write filename format, location, integrity criterion |

Commandments 3 and 9 are safety red lines, allowing hard bans; the rest focus
on "explain why": write the reason clearly so the model can judge unforeseen
edge cases itself.

## Failure Handling Table

| Symptom/Error Code | Cause | Action |
|---|---|---|
| User gives a category need ("do everything") | Skill granularity too large | Split into 2-3 single-scenario skills, write the clearest-trigger one first |
| Name taken in repo | Same name causes pack reference ambiguity | Add qualifier (`pdf-table-extractor`→`pdf-invoice-table-extractor`) |
| Description can't write exclusions | Trigger boundary not thought through | Ask "what request looks like this but shouldn't go through this skill"; the answer is the exclusion |
| Steps written but no observable expected | Violates commandment 2/4 | Change expected to executable criterion (exit code / file exists / field value) |
| Lines >190 | Knowledge stuffed into body | Move to `references/<topic>.md`, body keeps one line "when to read it" |
| Script needs non-stdlib dependency | Breaks on environment change | Revert to stdlib; if truly needed write in `compatibility` and add startup detection |
| Description too short or has no `Use when` | Description insufficient for routing | Add trigger words and exclusions, reach ≥40 chars and include `Use when` |

## Delivery Criteria

- Success definition: `SKILL.md` exists in target directory, the inline Step 5
  self-check reports no FAIL, and the Ten Commandments self-check passes line
  by line. (If the optional `skill-linter` skill is installed, zero FAILs there
  is equivalent evidence; its absence is not a failure.)
- Artifact naming: `skills/<category>/<skill-name>/SKILL.md`; scripts in same
  directory `scripts/`; reference docs in `references/`.
- Integrity verification: `wc -l SKILL.md` falls in 150-190; `grep -c "^## "
  SKILL.md` ≥6; `ls references/sources-and-methodology.md` non-empty.
- Delivery notes must explicitly list: path, line count, self-check conclusion
  (or linter conclusion when one was available), kept WARNs and reasons.

After writing, don't opportunistically edit `manifest.json` or `packs/*/pack.json`—
packaging relationships belong to the release process, submitted separately from
the skill itself, avoiding two kinds of change intent mixed in one PR.

A qualified output example: need "convert table screenshots to CSV" → name
`table-image-to-csv` → description includes `Use when` + "table to CSV / image
to table" + exclusion "handwritten CSV parsing" → skeleton uses tool-wrapper
variant → script `table_convert.py` with `--dry-run` default → Step 5
self-check clean.

## References

- references/skill-template.md — fill-in-the-blank SKILL.md template (including
  all frontmatter fields and Ten Commandments skeleton); read before step 3.
- references/sources-and-methodology.md — this skill's methodology source and
  originality statement; read when asked "what's the basis".
