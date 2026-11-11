---
name: tdd-guide
description: "Test-driven development: write unit tests, generate fixtures and mocks, analyze coverage gaps, and run red-green-refactor across Jest, Pytest, JUnit, Vitest, Mocha."
description_zh: "测试驱动开发指南：编写单元测试、生成 fixtures 与 mock、分析覆盖率缺口，指导红绿重构流程"
license: Apache-2.0
compatibility: Pure prompt-based; the bundled scripts require Python 3.10+. May read project structure via Bash.
metadata:
  version: "1.0"
  author: awesome-skillkit
  category: code-quality
  pattern: workflow
  tier: powerful
  verified-date: "2026-09-09"
---

# TDD Guide

Test-driven development across Jest, Pytest, JUnit, and Vitest: generate tests, analyze coverage gaps, and drive the red-green-refactor cycle with a single CLI.

---

## Input Checklist

| Input | Required | Description |
|------|------|------|
| Source code / requirement | Yes | A source file, `req.json`, or a feature-requirement description. |
| Target framework | No | `jest` \| `pytest` \| `junit` \| `vitest` \| `mocha` (auto-detected). |
| Coverage report | No | LCOV / JSON / XML path, for gap analysis. |
| Coverage threshold | No | Percentage (default `80`). |
| Phase (workflow) | No | `red` \| `green` \| `refactor`. |

When a required input is missing, infer the safest reasonable default once and proceed; ask only when the task cannot be executed without a user-owned decision:

> Please provide: (1) the source code or requirement description to test; (2) the target test framework (Jest/Pytest/JUnit/Vitest/Mocha).
> I'll use the rest as defaults: coverage-threshold=80%, phase advanced automatically by the workflow.

## Pre-flight Checks

```bash
# 1. Does the entry script exist?
test -f scripts/tdd_cli.py || { echo "ERROR: scripts/tdd_cli.py missing"; exit 1; }
# 2. Is Python available?
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }
# 3. If a coverage report is supplied, confirm the file exists:
test -z "$REPORT" || test -f "$REPORT" || { echo "ERROR: report $REPORT not found"; exit 1; }
```

## Unified CLI (`scripts/tdd_cli.py`)

All library modules are invoked through a single entry point (exit codes: `0` = ok, `2` = input error, `1` = internal error):

```bash
python scripts/tdd_cli.py workflow --requirement "implement user login"            # red-green-refactor cycle + phase guidance
python scripts/tdd_cli.py detect --file examples/src/service.py                  # language/framework/test-pattern detection (bundled sample)
python scripts/tdd_cli.py gen-tests --requirements examples/req.json --framework pytest   # requirement → test cases (bundled sample)
python scripts/tdd_cli.py fixtures --mode boundary --type int           # boundary-value / edge-case / mock data
python scripts/tdd_cli.py coverage --report examples/coverage.xml --threshold 80 # coverage summary/gaps/suggestions (bundled sample cobertura)
python scripts/tdd_cli.py metrics --source examples/src/service.py --test examples/tests/test_service.py      # quality metrics (bundled sample)
python scripts/tdd_cli.py stub --framework pytest --name test_login     # render a test skeleton
```

`format_detector` / `framework_adapter` / `output_formatter` are exposed indirectly via `detect` / `stub` / `coverage --format text`; they can also be `import`ed as a library (no standalone `__main__`; don't execute them directly).

## Workflow

### Step 1: Detect language and framework

```bash
python scripts/tdd_cli.py detect --file examples/src/service.py
```

Expected: output the detected language, test framework, and existing test patterns. On failure: the extension isn't supported → specify `--framework` explicitly.

### Step 2: Generate tests from code / requirements

```bash
# Generate from a source file
python scripts/test_generator.py --input math_utils.py --framework pytest
# Via the CLI from a requirements JSON
python scripts/tdd_cli.py gen-tests --requirements examples/req.json --framework pytest
```

Expected: produce a test skeleton covering happy paths, error scenarios, and edge cases. On failure: output is empty → check the `--framework` value and confirm the input is parseable.

### Step 3: Analyze coverage gaps

```bash
python scripts/coverage_analyzer.py --report lcov.info --threshold 80
# Or via the CLI
python scripts/tdd_cli.py coverage --report examples/coverage.xml --threshold 80
```

Expected: output gaps by priority, labeled P0 (critical, e.g. uncovered error paths) / P1 (core branches) / P2 (utility functions), with suggestions for reaching the threshold. On failure: report format unsupported → first convert to LCOV/JSON/XML.

### Step 4: Drive red-green-refactor

```bash
python scripts/tdd_cli.py workflow --requirement "add coupon validation to orders"   # start the cycle, get phase guidance
python scripts/tdd_workflow.py --phase red   --test test_auth.py   # write the failing test
python scripts/tdd_workflow.py --phase green --test test_auth.py   # minimal implementation
python scripts/tdd_cli.py metrics --source examples/src/service.py --test examples/tests/test_service.py  # verify
```

Expected: at the end of each cycle, the target tests all pass; `metrics` shows no regression. On failure: after a minimal implementation the tests are still red → the problem is in the implementation, not the test; go back and re-examine the requirement.

## Parameter Cheat Sheet

| Subcommand | Key parameters | Values |
|--------|----------|------|
| `workflow` | `--requirement` | Feature-description string |
| `detect` | `--file` | Source-file path |
| `gen-tests` | `--requirements` / `--framework` | Requirements JSON / jest\|pytest\|junit\|vitest\|mocha |
| `fixtures` | `--mode` / `--type` | boundary\|edge\|mock / int\|float\|str |
| `coverage` | `--report` / `--threshold` | LCOV\|JSON\|XML / percentage |
| `metrics` | `--source` / `--test` | Source / test-file path |
| `stub` | `--framework` / `--name` | Framework / test name |

## Key Tools

| Tool | Purpose | Usage |
|------|------|------|
| `test_generator.py` | Generate test cases from code/requirements | `python scripts/test_generator.py --input source.py --framework pytest` |
| `coverage_analyzer.py` | Parse and analyze coverage reports | `python scripts/coverage_analyzer.py --report lcov.info --threshold 80` |
| `tdd_workflow.py` | Guide the red-green-refactor cycle | `python scripts/tdd_workflow.py --phase red --test test_auth.py` |
| `fixture_generator.py` | Generate test data and mocks | `python scripts/fixture_generator.py --entity User --count 5` |

Other scripts: `framework_adapter.py` (cross-framework conversion), `metrics_calculator.py` (quality metrics), `format_detector.py` (detect language/framework), `output_formatter.py` (CLI/desktop/CI output).

## Bounded-Autonomy Rules

**Pause only for a genuinely user-owned decision or unavailable authorization; otherwise choose the recommended default and continue.**

**Continue autonomously when:** the spec is clear and acceptance criteria are numbered; simple CRUD; the API contract is explicit (OpenAPI / typed interface); pure functions; there's an existing test pattern to follow.

## Red-Green-Refactor Examples

### TypeScript / Jest

```typescript
describe("Cart", () => {
  describe("addItem", () => {
    it("should add a new item to an empty cart", () => {
      const cart = new Cart();
      cart.addItem({ id: "sku-1", name: "Widget", price: 9.99, qty: 1 });
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].id).toBe("sku-1");
    });
    it("should throw when quantity is zero or negative", () => {
      const cart = new Cart();
      expect(() => cart.addItem({ id: "sku-1", name: "Widget", price: 9.99, qty: 0 }))
        .toThrow("Quantity must be positive");
    });
  });
});
```

### Python / Pytest

```python
import pytest
from app.pricing import calculate_discount

@pytest.mark.parametrize("subtotal, expected_discount", [
    (50.0, 0.0), (100.0, 5.0), (250.0, 25.0), (500.0, 75.0),
])
def test_calculate_discount(subtotal, expected_discount):
    assert calculate_discount(subtotal) == pytest.approx(expected_discount)
```

### Go — table-driven

```go
func TestApplyDiscount(t *testing.T) {
    tests := []struct {
        name     string
        subtotal float64
        want     float64
    }{
        {"no discount below threshold", 50.0, 0.0},
        {"5 percent tier", 100.0, 5.0},
        {"15 percent tier", 500.0, 75.0},
        {"zero subtotal", 0.0, 0.0},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := ApplyDiscount(tt.subtotal); got != tt.want {
                t.Errorf("ApplyDiscount(%v) = %v, want %v", tt.subtotal, got, tt.want)
            }
        })
    }
}
```

## Failure Handling Table

| Symptom | Cause | Action |
|------|------|------|
| CLI exit code `exit 2` | Wrong input argument | Check required parameters against the cheat sheet |
| Generated tests are empty | `--framework` unsupported | Choose one of the 5 supported frameworks |
| Coverage tool errors reading the report | Format unsupported | Convert to LCOV/JSON/XML first |
| Tests still red after minimal implementation | Requirement unclear | revisit the requirement and choose the smallest evidence-backed next step |

## Delivery Criteria

Success = the generated tests compile and cover happy/error/edge paths, and the coverage report reaches the threshold.

- Save location: generated tests go in `tests/`; reports go in `coverage.<fmt>`.
- Verification: run the project's test runner and confirm the threshold is met (usually ≥80%); prioritize adding tests for P0 items.
- Tests are scaffolding; complex logic needs human review — this skill does not push or commit.

## References

- `references/framework-guide.md` — read when choosing an adapter pattern, or converting between Jest/Pytest/JUnit/Vitest/Mocha.
- `references/tdd-best-practices.md` — property-based and mutation-testing guides, deeper TDD patterns.
- `references/ci-integration.md` — read when wiring the CLI into CI (coverage gates, JUnit XML reports).

Sample fixtures: `assets/sample_coverage_report.lcov`, `assets/sample_input_python.json`, `assets/sample_input_typescript.json`, `assets/expected_output.json`.
