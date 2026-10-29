'use strict';

const m = require('./lib/memory.js');

const VERIFY_RE = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|typecheck|type-check|lint|gate|verify|check)(:|$|\s)/i,
  /\b(npm|pnpm|yarn|bun)\s+test\b/i,
  /\b(vitest|jest|mocha|ava|playwright|cypress)\b/i,
  /\b(pytest|py\.test|unittest|tox|nox)\b/i,
  /\bpython[0-9.]*\s+-m\s+(pytest|unittest|mypy|ruff|flake8|black)\b/i,
  /\b(cargo\s+(test|check|clippy)|go\s+(test|vet)|mvn\s+(test|verify)|gradle(w)?\s+(test|check))\b/i,
  /\b(tsc\s+(--noEmit|-p)|vue-tsc|eslint|prettier\s+--check|ruff|mypy)\b/i,
  /\bgitleaks\b|\baudit\b.*--prod|\bsemgrep\b/i,
  /\bnode\s+--test\b/i,
  /\bmake\s+(test|check|lint)\b/i,
];

const FAIL_HINT = /\b(?:[1-9]\d*\s+(?:failed|failing|errors?)|FAIL|Traceback|AssertionError)\b|[✗✘]/i;

// 假绿识别：exit 0 但测试实际没跑 / 全跳过 / 0 个用例。
// 这类「通过」不能算通过——否则一次 `npm test` 就能自圆其说。
const EMPTY_SUITE_HINTS = [
  /\b0\s+(?:tests?|specs?|suites?)\b/i,
  /\b(?:no tests?|no test files?|no specs?)\s+(?:found|to run|executed)\b/i,
  /\b0\s+passed\b/i,
  /\btests?:\s*0\b/i,
  /\bcollected\s+0\s+items\b/i,
  /\b(?:ran|running)\s+0\s+tests?\b/i,
];

// 全部跳过：skipped > 0 且 passed = 0 且 failed = 0
function allSkipped(raw) {
  const skipped = raw.match(/\b(\d+)\s+(?:skipped|pending|todo)\b/i);
  const passed = raw.match(/\b(\d+)\s+passed\b/i);
  const failed = raw.match(/\b(\d+)\s+failed\b/i);
  if (!skipped) return false;
  const s = Number(skipped[1]);
  const p = passed ? Number(passed[1]) : 0;
  const f = failed ? Number(failed[1]) : 0;
  return s > 0 && p === 0 && f === 0;
}

function looksEmptyOrSkipped(raw) {
  if (!raw) return false;
  if (EMPTY_SUITE_HINTS.some((re) => re.test(raw))) return true;
  return allSkipped(raw);
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await m.readStdin()) || '{}');
  } catch {
    return;
  }

  const toolName = payload.tool_name || payload.toolName || '';
  if (toolName !== 'Bash') return;

  const input = payload.tool_input || payload.toolInput || {};
  const cmd = String(input.command || '');
  if (!cmd.trim() || !VERIFY_RE.some((re) => re.test(cmd))) return;

  const event = payload.hook_event_name || payload.hookEventName || 'PostToolUse';
  const cwd = payload.cwd || process.cwd();
  const response = payload.tool_response || payload.toolResponse || {};
  const raw =
    typeof response === 'string'
      ? response
      : JSON.stringify(response);
  const exitCode =
    response && typeof response === 'object'
      ? response.exitCode ?? response.exit_code ?? response.code
      : undefined;

  const status = response && typeof response === 'object' ? String(response.status || '').toLowerCase() : '';
  const rawText = typeof raw === 'string' ? raw : '';

  // 先把「真失败」判出来
  const hardFailed =
    event === 'PostToolUseFailure' ||
    (typeof exitCode === 'number' && exitCode !== 0) ||
    (typeof exitCode !== 'number' && ['failed', 'timed_out', 'cancelled', 'spawn_error'].includes(status)) ||
    (typeof exitCode !== 'number' && !status && FAIL_HINT.test(rawText));

  // 再判「假绿」：exit 0 但测试没跑 / 全跳过
  const empty = !hardFailed && looksEmptyOrSkipped(rawText);
  const failed = hardFailed || empty;

  const errorText =
    event === 'PostToolUseFailure'
      ? String(payload.error || payload.error_details?.message || 'tool execution failed').slice(0, 200)
      : empty
        ? '验证命令通过了，但没有真实执行任何测试（0 tests / 全 skipped）。这不算验证通过。'
        : '';

  const state = m.readState(cwd);
  m.writeState(cwd, {
    ...state,
    lastVerifyAt: new Date().toISOString(),
    lastVerifyCmd: cmd.slice(0, 200),
    lastVerifyOk: !failed,
    needsVerify: failed,
    verifyFailed: failed,
    ...(empty ? { lastVerifyEmpty: true } : { lastVerifyEmpty: false }),
    ...(errorText ? { lastVerifyError: errorText } : {}),
  });
}

main().catch(() => {});

module.exports = { looksEmptyOrSkipped, allSkipped, EMPTY_SUITE_HINTS };
