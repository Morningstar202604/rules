---
name: agent-designer
description: "Design multi-agent systems: pick an orchestration pattern (supervisor/swarm/pipeline/router), scaffold the workflow config, compare single-agent vs multi-agent, and generate tool schemas."

description_zh: "设计多智能体系统：选择编排模式、搭建工作流、生成工具 schema 并分析运行日志。"
license: Apache-2.0
compatibility: Pure prompt-based; may read project structure via Bash.
metadata:
  opencode/autoinvoke: false
  version: "1.0"
  author: awesome-skillkit
  category: workflow
  pattern: single-task
  tier: powerful
  verified-date: "2026-09-09"
---

# Agent Designer — Multi-Agent System Architecture Design

Uses three deterministic tools (planner / schema generator / evaluator) to complete multi-agent system design, schema generation, and run evaluation. The scripts are the workflow itself — when the planner can score patterns from the requirements, don't hand-draw the architecture by gut feel.
Run all commands in the skill directory (the directory containing this file).

## When to Use / When Not

Applies:
- Designing a new multi-agent system from requirements (pattern choice, role division, communication links)
- Generating, from plain-text tool descriptions, tool schemas that plug straight into vendors (both Anthropic and OpenAI formats)
- Evaluating execution logs: success rate, latency distribution, cost, bottlenecks

Does not apply: Claude Code Workflow-tool automation → `workflow-builder`; runtime multi-agent fan-out → `agenthub`.

## Input Checklist

| Input | Required | Description |
|------|------|------|
| requirements.json | Required when designing the architecture | Copy `assets/sample-requirements.json` and adapt it; keys: `goal`, `tasks[]`, `constraints{max_response_time, budget_per_task, concurrent_tasks}`, `team_size` |
| tool_descriptions.json | Required when generating schemas | Copy `assets/sample-tool-descriptions.json` and adapt it; describe each agent's tools in plain JSON |
| execution_logs.json | Required when evaluating | Real run logs; for a dry-run you can use `assets/sample-execution-logs.json` directly |
| workflow pattern + name | Required for quick scaffolding | pattern is one of `sequential` / `parallel` / `router` / `orchestrator` / `evaluator` |

When missing, ask for all at once: "Please provide: (1) the stage you're at (design architecture / generate schema / evaluate logs / scaffold); (2) the corresponding input JSON file (or let me copy and adapt from the assets/ sample)."

## Pre-flight Checks

Run in order; on a fatal failure → fix, then STOP.

```bash
# 1. Python is available (fatal)
python3 --version                                            # Expected: Python 3.x

# 2. The four scripts are in place (fatal; must run in the skill directory)
test -f scripts/agent_planner.py && test -f scripts/tool_schema_generator.py \
  && test -f scripts/agent_evaluator.py && test -f scripts/workflow_scaffolder.py && echo OK
# Expected: OK; on failure → cd to the skill directory and retry; if still failing, STOP

# 3. The sample assets are in place (fatal; the template source for step inputs)
test -f assets/sample-requirements.json && test -f assets/sample-tool-descriptions.json \
  && test -f assets/sample-execution-logs.json && echo OK
# Expected: OK
```

## Pattern Decision Table

The planner scores patterns deterministically from this table — run it; don't pick by gut feel.

| Choice | When | Caveat |
|---|---|---|
| Single agent | One bounded task, < ~5 tools | Don't add agents where none are needed |
| Supervisor | A central node decomposes tasks, experts report back | The supervisor becomes the bottleneck |
| Pipeline | Strict sequential stages + handoff | Ordering is rigid; the slowest stage caps throughput |
| Hierarchical | Multi-layer organization, > ~8 agents | Every layer adds communication overhead |
| Swarm | Parallel peer nodes, fault tolerance over predictability | Hard to debug; needs consensus rules |

## Parameter Quick Reference

| Script (run) | Key parameters | Description |
|------|------|------|
| scripts/agent_planner.py | `input_file`; `--format {json,yaml,both}`; `-o` output prefix (default agent_architecture) | Requirements → architecture |
| scripts/tool_schema_generator.py | `input_file`; `--validate`; `--format {json,both}`; `-o` output prefix | Tool descriptions → vendor schemas |
| scripts/agent_evaluator.py | `input_file`; `--detailed`; `--format {json,both}`; `-o` output prefix (default evaluation_report) | Logs → evaluation report |
| scripts/workflow_scaffolder.py | `pattern {sequential,parallel,router,orchestrator,evaluator}`; `--name`; `--output` | Generate a workflow skeleton JSON |

## Workflow

Each step's JSON output is the design input for the next. All paths are relative to the skill directory.

### Step 1: Design the architecture

Action (run): write requirements.json (copy `assets/sample-requirements.json` and adapt it), then:

```bash
python3 scripts/agent_planner.py assets/sample-requirements.json --format json -o arch   # bundled sample requirements
```

Expected: produce `arch.json` containing `architecture_design` (pattern, agents, communication links), `mermaid_diagram`, and `implementation_roadmap`. Read `architecture_design.pattern` and each agent's role list, and present the mermaid diagram to the user.
On failure: input missing keys (e.g. `team_size`) → fill them in against the sample and rerun.

### Step 2: Generate tool schemas

Action (run): write tool_descriptions.json (copy `assets/sample-tool-descriptions.json` and adapt it), then:

```bash
python3 scripts/tool_schema_generator.py assets/sample-tool-descriptions.json --validate -o tools
```

Expected: produce `tools.json` (`tool_schemas`, `validation_summary`) plus vendor-specific `tools_anthropic.json` / `tools_openai.json`; **gate: every tool must print `✓ Valid`**.
On failure: any schema is invalid → fix the tool descriptions and rerun; never hand an agent an unvalidated schema.

### Step 3: Evaluate execution logs

Action (run): once the system is running, use real logs; for a dry-run use `assets/sample-execution-logs.json` directly:

```bash
python3 scripts/agent_evaluator.py assets/sample-execution-logs.json --detailed -o eval   # bundled sample logs
```

Expected: produce `eval.json` containing `summary`, `agent_metrics`, `bottleneck_analysis`, `error_analysis`, `cost_breakdown`, `sla_compliance`, `optimization_recommendations`, plus split files `eval_errors.json` and `eval_recommendations.json`.
On failure: the log JSON doesn't match the expected format → fix the fields against `assets/sample-execution-logs.json` and rerun.

### Step 4: Quick scaffold (optional)

Action (run): when you want a skeleton before the full flow:

```bash
# sequential / parallel / router / orchestrator / evaluator skeletons
python3 scripts/workflow_scaffolder.py sequential --name content-pipeline
python3 scripts/workflow_scaffolder.py orchestrator --name incident-triage --output ./incident-triage.json   # write OUTSIDE the skill package
```

Expected: produce the workflow skeleton JSON for the chosen pattern; with no `--output` it prints to stdout.
On failure: the pattern isn't one of the five enum values → the CLI errors and lists valid values; fix it and rerun.

For pattern templates and the minimal handoff contract (`workflow_id`, `step_id`, `task`, `constraints`, `upstream_artifacts`, `budget_tokens`, `timeout_seconds`) → see references/workflow_patterns.md.

Workflow discipline: start from the smallest pattern that meets the requirements; make handoff payloads explicit and bounded; pair every external model call with a retry/timeout policy; validate intermediate output before fanning in; dry-run with a small context budget before scaling up.

### Step 5: Verify the closed loop

The design isn't done until all of these hold:

1. `tool_schema_generator.py --validate` reports 0 invalid schemas.
2. `agent_evaluator.py` reports **0 critical issues** on a trial run (when the tool finds problems it prints `CRITICAL: N critical issues`). If N > 0: apply the top recommendation in `eval_recommendations.json`, rerun the trial, and re-evaluate.
3. Compare the output against `expected_outputs/` to confirm the schema shape you consume hasn't drifted.

## Failure Handling Table

| Symptom / error code | Cause | Fix |
|------|------|------|
| Any tool prints `✗ Invalid` / not all `✓ Valid` | Tool descriptions don't meet schema constraints | Fix tool_descriptions.json and rerun step 2; don't proceed past the gate |
| `CRITICAL: N critical issues` (N>0) | The trial exposed failure/cost/latency problems | Apply the top recommendation in `eval_recommendations.json` → rerun the trial → re-evaluate |
| The planner output is missing `architecture_design` | requirements.json is missing keys | Fill them in against `assets/sample-requirements.json` and rerun |
| The output shape doesn't match `expected_outputs/` | Script evolution caused schema drift | Update consumers against expected_outputs/, and read the corresponding references/ doc |
| The scaffolder reports an illegal pattern | The pattern isn't one of the five enum values | Choose from `sequential/parallel/router/orchestrator/evaluator` |

## Delivery Criteria

- Definition of success: all three gates in step 5 pass (0 invalid schemas, 0 critical issues, no schema drift), and the mermaid architecture diagram has been presented to the user.
- Artifact naming (decided by the `-o` prefix): `arch.json`, `tools.json` + `tools_anthropic.json` + `tools_openai.json`, `eval.json` + `eval_errors.json` + `eval_recommendations.json`; the scaffold is placed per `--output`.
- Save location: current working directory; suggest archiving into the project's `design/` or `workflows/` directory.
- Completeness verification: all artifacts parse with `python3 -m json.tool <file>`; `arch.json` contains pattern + the agent role list; the schema trio (generic/Anthropic/OpenAI) all exist and are consistent in content.

## References

- assets/sample-requirements.json, assets/sample-tool-descriptions.json, assets/sample-execution-logs.json — the current kebab-case sample inputs used by every command in this file. Earlier snake_case copies (`sample_system_requirements.json`, `sample_tool_descriptions.json`, `sample_execution_logs.json`) are kept unchanged in `references/legacy-snake-assets/` for provenance only; do not call them from commands.
- references/agent_architecture_patterns.md — read when the step-1 pattern choice is uncertain (detailed trade-offs per pattern)
- references/workflow_patterns.md — read when using the scaffolder in step 4 (skeleton templates + handoff contract; merged from agent-workflow-designer)
- references/tool_design_best_practices.md — read when designing tools in step 2 (schema, idempotency, error-handling rules)
- references/evaluation_methodology.md — read when interpreting metrics in step 3 (the metric definitions the evaluator implements)
