---
name: plan-and-execute
description: >-
  Use when you have a spec or requirements for a multi-step task: write a bite-sized, TDD-ordered implementation plan before touching code (scope check, file structure, task right-sizing, step granularity, plan header, task structure, self-review), then execute that plan task by task in the current session as the implementer yourself when your human partner chose inline execution or no subagent tool exists (setup and ledger, Ruling protocol, four hard stops, task loop, Expected tri-state, completion contract, final review, finish).
description_zh: "拿到规格或多步任务需求后、动手写代码前先写分步实施计划（范围检查、文件结构、任务与步骤粒度、计划头、任务结构、自检），再在当前会话中亲自逐项执行（工作区与台账、Ruling 裁决、四类硬停、任务循环、Expected 三态、完成契约、整分支评审、收尾）；用户选择内联执行或没有子代理可用时使用。触发：写计划、做计划、实施计划、执行计划、按计划开发、分步实现、多步任务、拆任务、逐项落地、TDD 计划。"
license: MIT
compatibility: 纯提示型，任意支持 SKILL.md 的工具可用；无外部依赖。
metadata:
  opencode/autoinvoke: false
  author: "obra/superpowers 上游（MIT）"
  version: "1.0.0"
  category: programming
  pattern: single-task
  tier: standard
  verified-date: "2026-11-13"
  source: "https://github.com/obra/superpowers/tree/main"
  supersedes: "writing-plans, executing-plans"
---

# Plan and Execute

Two halves of one workflow: decide what an implementer cannot decide alone, then carry those decisions out yourself without losing the record. Use one half or both. **Core principle:** the plan did the thinking — execute exactly, prove each step with a test you watched fail then pass, and leave a record that survives forgetting.

## Part 1 — Writing the Plan

Write for an engineer who has not seen this codebase or spec. They code idiomatically once they know the interface and test, and choose reasonably wherever a choice is open. What they cannot know is what you decided: files, names, signatures, spec values, and the test proving each task. Save to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.

- **Scope check.** Independent subsystems should have been split at brainstorming; if not, one plan per subsystem, each producing working, testable software alone.
- **File structure.** Map the files created or modified and what each owns — decomposition locks in here. One responsibility per file, small and focused, since you reason best about code in context. Files that change together live together: split by responsibility, not technical layer. Follow existing patterns; don't restructure unilaterally, though planning a split of an unwieldy file you touch is reasonable.
- **Task right-sizing.** The smallest unit carrying its own test cycle and worth a fresh reviewer's gate. Fold setup, config, scaffolding, and docs into the task whose deliverable needs them; split only where a reviewer could reject one task while approving its neighbour. Each task ends independently testable.
- **Step granularity.** One action per step, checkably: write the failing test / run it to watch it fail / implement the minimal code to pass / run the tests to watch them pass / commit.
- **Plan header.** Every plan starts with:

```markdown
# [Feature Name] Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: plan-and-execute (execution half), task by task.
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** [one sentence]  **Architecture:** [2-3 sentences]  **Tech Stack:** [key libraries]
**Spec:** [path to the spec this implements — the plan argues from it; executors read both]

## Global Constraints
[Spec-wide rules — version floors, dependency limits, naming/copy rules, platform requirements — one line each, values verbatim. Every task implicitly includes this section.]

## Review Focus
[Five input classes or failure modes the spec implies but no task's tests cover, most likely to bite a user first, one line each naming the input and the expected behaviour. Spec silence is not permission for that input to break. Add each line's test to the task owning the code.]
```

- **Task structure.**

````markdown
### Task N: [Component Name]
**Files:** Create `path/file.py` · Modify `path/existing.py:123-145` · Test `tests/test.py`
**Interfaces:** Consumes [exact signatures from earlier tasks] · Produces [exact names and types
later tasks rely on — an implementer sees only their own task, so this block is the contract]

- [ ] **Step 1: Write the failing test** — code, with the spec's exact values
- [ ] **Step 2: Run test to verify it fails** — `Run: pytest tests/test.py::name -v`
      / `Expected: FAIL with "function not defined"`
- [ ] **Step 3: Implement `function(input: InputType) -> ResultType` in `path/file.py`** — one
      line on the approach when signature and test leave a choice; code only for an algorithm
      they do not determine
- [ ] **Step 4: Run test to verify it passes** — `Expected: PASS`
- [ ] **Step 5: Commit** — `git add … && git commit -m "feat: add specific feature"`
````

A step is done when the implementer can write exactly one reasonable thing from it: unambiguous, not complete. Test steps carry the test's name and assertions as code; code steps the exact signature, file, and pinned values, with a body only for an algorithm that signature and tests do not determine; verification steps the command and the output meaning it passed. A plan is the decisions the implementer cannot make alone; one longer than the code it describes has written the code.

**Self-review** — against the spec, yourself rather than a subagent. (1) **spec coverage**: a task per requirement. (2) **step scan**: each step allows exactly one reasonable writing and no more — a line deciding nothing is a gap, a body already determined is a transcript. (3) **type consistency**: later tasks' types, signatures, and names match earlier ones (`clearLayers()` in Task 3 versus `clearFullLayers()` in Task 7 is a bug). (4) **review focus**: a task whose tests exercise each implied input class; an empty section means you checked and found none. (5) **proportion**: a plan several times longer than the spec is a transcript. Fix inline and add any task the spec still lacks.

**Execution handoff.** Link the plan. If a method was supplied, ask them to confirm it before implementation. Otherwise offer subagent-driven (fresh implementer and reviewer per task, then whole-branch review; most thorough) versus inline (this skill's execution half: you implement every task, one fresh reviewer at the end; cheapest). Recommend one and say why in a sentence.

## Part 2 — Executing the Plan

No implementer subagent per task, no reviewer per task, one fresh-context review of the whole branch at the end. Inline pays one context plus one reviewer instead of a context per task; the brief, ledger, TDD, and final reviewer replace that freshness. Narrate at most one short line between tool calls and never pause between tasks — they chose inline to spend less, not to answer "should I continue?".

**Setup.**

- Isolated worktree or the verified existing one; never start on main/master without explicit consent.
- Memory does not survive compaction, so track progress in a ledger, not only todos.
- One workspace per plan, a git-ignored dir such as `<repo>/.superpowers/sdd/<plan-basename>/`; never touch another plan's. Ledger `<workspace>/progress.md`, first line `# SDD ledger — plan: <plan file path>`; a `Task <N>: complete` line is DONE, so resume at the first without one and trust `git log`.
- Read the plan once; note its context and Global Constraints; one todo per task. If it names a Spec, read it — the authority the plan argues from; without one, ledger a note making later rulings provisional.
- Load the test-driven-development discipline before Task 1.
- Pre-flight: one ledger row per consuming task — task numbers, producer against consumer, what you found; tasks sharing nothing get `Pre-flight: no shared interfaces`. Rule on each conflict with the spec binding, then start Task 1.

**Rulings, not stalls.** Conflicts, ambiguities, and plan defects get decided: the spec is binding, the plan is its argument, your judgment settles what neither answers. Record `Ruling: <what you decided> — <why> — <what it costs if wrong>` and keep going; unledgered deviation is a decision made in secret. **Four hard stops, only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree that norms say you ask about (merge, push to a shared branch, publish); a plan so broken that every path forward is a guess. There, stop and ask.

**Task loop.**

1. **Take.** Read the brief every time — memory is a summary; it holds the exact values, signatures, and test cases. Mark the todo in_progress; ledger writes ride in the commit call; redirect long test output to a file and read its tail.
2. **Work the steps** in RED-GREEN order. Test code runs first; watching it fail is a step — a test passing before the implementation exists is a finding about the test. Every command step has an `Expected:` line: run it, read the output, compare. **Expected tri-state:** *matches* → next; *code wrong* → systematic debugging, never patch the symptom to match; *plan wrong* (contradicts the spec, an interface mismatches, a command cannot work) → rule on the smallest change satisfying the spec, ledger `Task <N>: Ruling: <finding> — <what you decided and why>`, continue. Commit as the plan says; BASE is what the review range is cut from.
3. **Completion contract.** Before a task's ledger line, all hold with evidence from this session, not inferred from the diff: every named test exists, ran here, and you read the output; the final run passed with command and result in the ledger line; every `Expected:` matched real output; every deviation has a `Ruling:`. Any gap means the task is not complete.
4. **Complete.** Run the whole-task test command (legacy `scripts/task-done PLAN_FILE N BASE -- <test command>` keeps output, prints the tail, and only on success appends `Task <N>: complete (commits <base7>..<head7>, tests: <command> → <result>)`). A failing run records nothing; when it records, mark the todo complete and take the next.

**Final review.** Build a review package for `MERGE_BASE..HEAD` and review from that file, not an ad-hoc diff read. With a subagent tool, dispatch on the most capable model — whole-branch review is judgment — via the repository's review command, passing the package, plan and spec paths, the Review Focus verbatim, and the ledger's `Ruling:` lines. Name the model explicitly; an omitted one inherits the session's. This is the one fresh context the run buys: never skip it. Without a subagent tool, do the review yourself after the last ledger line and write `Final review: self-review (no subagent tool)` to the ledger.

Sort findings first: severity labels are advice, the gate is yours. Re-grade by effect — a grade is what a reasonable person gets if this ships, not whether the spec names the triggering input. "Declined to judge" lines become `Final: Ruling: <behaviour set aside> — <what a reasonable person gets, and why that stands or is now a finding> — <cost if wrong>`. **Critical and Important** enter ONE fix pass verified by TDD: write the failing test reproducing the finding, make it pass, run the suite, record `Final: fixed <finding> — <test name> RED→GREEN, suite <N>/<N>`. A fix with no failing test is unverified; a suite not green means the pass is not over; no re-review. **Minor** goes to the ledger as `Final: minor (deferred): <one-liner>` and to "Deferred minors": never a ruling. **Declined to fix** is a ruling — `Final: Ruling: <finding> — <why the code stands> — <cost if wrong>` — and reaches your partner. No second fix pass.

**Finish.** Collect every `Ruling:` ledger line into the final message under "Rulings I made", in order, each with its cost if wrong, and every `minor (deferred)` line under "Deferred minors". Both are exhaustive: the final message is the only place the decisions you took on your partner's behalf, and findings you chose not to act on, reach them. When the review is clean and its fixes committed, delete this plan's workspace — git history is the record now — leave siblings alone, and use the finishing-a-development-branch skill.

## Legacy Text

Full pre-merge texts, with attribution, are verbatim in `references/legacy-writing-plans.md` and `references/legacy-executing-plans.md`; read them only for exact original wording. Where they conflict with this file, this file wins.

---

## 来源与署名 / Source & Attribution

本技能合并自上游 obra/superpowers（MIT）的 writing-plans 与 executing-plans。