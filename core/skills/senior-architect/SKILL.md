---
name: senior-architect
description: "Design or review system architecture, choose a tech stack, write ADRs, and produce Mermaid/PlantUML/ASCII diagrams."
description_zh: "系统架构设计、架构评审、技术选型、撰写 ADR，生成 Mermaid、PlantUML 或 ASCII 架构图"
license: Apache-2.0
compatibility: Pure prompt-based; runs Python stdlib scripts via Bash. No API keys required.
metadata:
  version: "1.0"
  author: awesome-skillkit
  category: architecture
  pattern: architecture
  tier: powerful
  verified-date: "2026-09-09"
---

# Senior Architect

Architecture design and analysis: generate architecture diagrams (Mermaid/PlantUML/ASCII), analyze dependency coupling and circular references, evaluate project structure, and walk the decision workflow (database, patterns, monolith vs microservices) — output stays at the architecture level; it doesn't write implementation code.

## Input Checklist

| Input | Required | Description |
|---|---|---|
| Project directory | Yes | Path to the project to analyze, e.g. `./my-project` |
| Task intent | Yes | One of: draw a diagram / dependency analysis / architecture evaluation / tech selection / review |
| Diagram type | Required when drawing | component / layer / deployment |
| Output format | No | mermaid (default) / plantuml / ascii; analysis report optionally json |

When inputs are missing, ask for all at once: "Please provide: (1) project directory; (2) what to do this time (diagram / dependency analysis / architecture evaluation / selection / review); (3) if drawing, the diagram type and format."

## Pre-flight Checks

Run line by line; on any failure → fix per the remediation and STOP:

```bash
# 1. Python 3 is available
python3 --version
# Expected: Python 3.8+.

# 2. All three tool scripts exist
ls scripts/architecture_diagram_generator.py scripts/dependency_analyzer.py scripts/project_architect.py
# Expected: all three filenames (run inside the skill directory). On failure: cd to the skill directory; still missing → STOP and report.

# 3. The target project directory exists
ls <project directory> > /dev/null && echo OK
# Expected: OK. On failure: confirm the path with the user, STOP.
```

## Workflow

### Step 1: Generate the architecture diagram

```bash
python3 scripts/architecture_diagram_generator.py examples/sample-project --format mermaid --type component   # bundled sample project; swap in your project root for a real one
# PlantUML:   --format plantuml --type layer
# ASCII:      --format ascii
# Save to file: --output architecture.md (or -o)
```

- **Action**: generate a diagram from the project structure, type `component` (module relationships) / `layer` (layering) / `deployment` (deployment topology).
- **Expected**: stdout emits diagram code in the corresponding format; Mermaid output is recognizable by keywords like `graph TD`.
- **On failure**: empty output or error → the project directory has no source files; confirm the directory with the user, then STOP.

### Step 2: Dependency analysis

```bash
python3 scripts/dependency_analyzer.py examples/sample-project --output json
# Circular deps only: --check circular
# Detailed mode with suggestions: --verbose
```

- **Action**: resolve direct and transitive dependencies, inter-module circular deps, a coupling score (0-100), and outdated packages; supports npm/yarn, requirements.txt/pyproject.toml, go.mod, Cargo.toml.
- **Expected**: the report contains CIRCULAR/OUTDATED entries and Recommendations (or a clean report with no problems).
- **On failure**: an unsupported package manager → report "this stack isn't in the supported list", STOP; JSON can't be parsed → rerun in `--verbose` text mode.

### Step 3: Architecture evaluation

```bash
python3 scripts/project_architect.py examples/sample-project --verbose
# Layering violations only: --check layers
```

- **Action**: detect architecture patterns (MVC/layered/hexagonal/microservices metrics and confidence), god classes, mixed concerns, layering violations, and missing components.
- **Expected**: the report contains the detected pattern + confidence + layering-check results + Recommendations.
- **On failure**: no pattern detected → the project is too small or non-typical; report the low confidence honestly and don't fabricate conclusions.

### Step 4: Decision workflow (pick one by intent)

**Database selection**:
1. Score by data characteristics: structured + relational / needs ACID → SQL; flexible schema / document / time-series → NoSQL.
2. Scale: <1M records, single region → PostgreSQL/MySQL; 1M-100M, read-heavy → PostgreSQL + read replicas; >100M, globally distributed → CockroachDB/Spanner/DynamoDB; high write throughput >10K/sec → Cassandra/ScyllaDB.
3. Consistency: strong consistency → SQL or CockroachDB; eventual consistency acceptable → DynamoDB/Cassandra/MongoDB.
4. Record in an ADR: context, alternatives, the decision and rationale, accepted trade-offs.

**Architecture-pattern selection**: a 1-3 person team → modular monolith; 4-10 people → modular monolith or service-oriented; 10+ people → consider microservices. Independent deployment required → microservices; complex domain logic → DDD; extreme read/write ratio → CQRS; audit trail needed → Event Sourcing; many third-party integrations → Hexagonal.

**Monolith vs Microservices**: team <10 people, unclear domain boundaries, need fast iteration, shared libraries acceptable → monolith. Teams can own features end to end, must deploy independently, components have different scaling needs, clear domain boundaries → microservices. Default to starting from a modular monolith, and split into services only when module scaling needs differ significantly / teams need independent deployment / tech-stack constraints force separation.

- **Expected**: produce a clear recommendation + rationale (citing the above criteria), captured as an ADR.
- **On failure**: criteria conflict (e.g. small team but independent deployment required) → list the conflict and ask the user to set priorities, STOP.

### Step 5: Aggregate and deliver

- **Action**: aggregate the diagram, dependency analysis, evaluation, and decision into one review report; attach a file/module location to each finding.
- **Expected**: the report cites the real raw output of each tool (scores, confidence, entries) and contains no speculation.
- **On failure**: a tool has no result → mark "N/A — tool produced no output" in the report; don't fabricate.

## Parameter Cheat Sheet

| Parameter | Values | Description |
|---|---|---|
| `--format` | mermaid / plantuml / ascii | Diagram output format (diagram generator) |
| `--type` | component / layer / deployment | Diagram type |
| `--output` | file path | Write to a file; defaults to stdout (diagram generator) |
| `--output` | human / json | Report format (dependency_analyzer / project_architect) |
| `--check` | diagram: n/a; analyzer: all/circular/coupling; architect: all/pattern/layers/code | Run a single check only |
| `--verbose` | boolean | Detailed mode, including suggestions |
| `--json` | boolean | Machine-readable output (diagram generator) |
| `--save` | file path | Save report to file (analyzer / architect) |

## Failure Handling Table

| Symptom / error code | Cause | Fix |
|---|---|---|
| `unrecognized arguments` | A parameter spelling/value isn't in the cheat sheet | Correct it against `--help` output |
| Diagram output empty | The project directory has no analyzable source | Confirm the directory contains code and rerun |
| Dependency analysis reports an unsupported stack | The package manager isn't in the supported list | Report the limitation honestly, STOP |
| Pattern-detection confidence < 50% | The project structure is non-typical | Report the low confidence and list the detected clues; don't force a conclusion |
| `FileNotFoundError` | Not running in the skill directory | `cd` to the skill directory or use absolute script paths |

## Delivery Criteria

- Definition of success: the artifacts matching the intent are all present (diagram code / dependency report / evaluation report / ADR), and every conclusion traces back to a tool output or the criteria table.
- Artifact naming: diagram `architecture.md` (or what `--output` specifies); ADR `adr-NNN-<slug>.md`.
- Save location: project-root `docs/` or a user-specified directory; delivered in-conversation by default.
- Completeness verification: the Mermaid/PlantUML code parses in the corresponding renderer (spot-check with `npx -y @mermaid-js/mermaid-cli -i in.mmd -o out.svg`); the ADR contains all four elements: context/alternatives/decision/trade-offs.

## References

- `references/architecture_patterns.md` — trade-offs and examples for 9 architecture patterns; read when the task actually requires it "which pattern?", "microservices vs monolith", "CQRS", "event-driven".
- `references/system_design_workflows.md` — 6 step-by-step system-design workflows; read when the task actually requires it "how to design?", capacity planning, API design, or migration.
- `references/tech_decision_guide.md` — the tech-selection decision matrix; read when the task actually requires it "which database/framework/cloud/cache?".
