'use strict';

const fs = require('node:fs');
const path = require('node:path');
const m = require('./lib/memory.js');

const TMP_PATTERNS = [
  /\.tmp$/i, /\.temp$/i, /\.bak$/i, /\.bak-\d/i, /\.orig$/i, /\.rej$/i,
  /~$/, /\.swp$/i, /\.log$/i, /\.old$/i, /\.copy$/i,
  // NOTE: `test` used to be in this prefix list, which flagged every
  // `tests/test_*.py` (the pytest convention) as a temp file — 95 false
  // positives on spark alone, blocking the stop hook every turn. Test files
  // live in `tests/` and are git-tracked; anything git knows about is not a
  // scratch artifact, so the tracked check below is the real guard.
  /^(tmp|temp|debug|scratch|try)[-_].*\.(js|mjs|py|ts|json|txt|md|sh)$/i,
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', '.venv', 'venv', '__pycache__',
  'coverage', '.next', 'target', '.zcode', '.aqg', '.workbuddy', '.v2c',
  '.pytest_cache', '.cov-mcp', 'test-results', 'coverage-e2e',
]);

const DOC_HINT = /(README|CHANGELOG|ARCHITECTURE|AGENTS|VERIFICATION|DEPLOY|CONTRIBUTING)\.md$/i;
const REPORT_HINT = /(分析报告|analysis-report|_report|报告)\.(html|md)$/i;

function walk(root, depth, out, budget) {
  if (depth > 3 || out.length >= budget) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= budget) return;
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      walk(full, depth + 1, out, budget);
    } else {
      out.push(full);
    }
  }
}

async function runCached(payload, state) {
  const cwd = payload.cwd || process.cwd();
  const file = m.memoryPathFor(cwd);

  if (state.skipGuard || state.cleanupNudged) return null;

  const files = [];
  walk(cwd, 0, files, 3000);
  if (files.length === 0) return null;

  const trackedFiles = new Set();
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('git', ['-C', cwd, 'ls-files', '-z'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const p of out.split('\0')) if (p) trackedFiles.add(p);
  } catch {
    /* not a git repo, or git unavailable: fall back to pattern-only */
  }

  const startMs = state.turnStartedAt ? Date.parse(state.turnStartedAt) : 0;
  const near = (f) => {
    try {
      return !startMs || fs.statSync(f).mtimeMs >= startMs;
    } catch {
      return false;
    }
  };

  const temps = files.filter(
    (f) => {
      if (trackedFiles.has(path.relative(cwd, f).replace(/\\/g, '/'))) return false;
      const base = path.basename(f);
      // `logs/xxx.log` 是应用的运行时日志目录（按 8MB 轮转），不是临时垃圾。
      // 旧逻辑一律按 .log 判临时，每个有日志轮转的项目每轮都被要求删日志。
      if (/\.log$/i.test(base) && /[\\/]logs?[\\/]/i.test(f)) return false;
      return TMP_PATTERNS.some((re) => re.test(base));
    }
  );
  const changed = Array.isArray(state.changedFiles) ? state.changedFiles : [];
  const changedDocs = changed.filter((f) => DOC_HINT.test(f));
  const freshReports = files.filter((f) => REPORT_HINT.test(f) && near(f));

  const lines = [];
  if (temps.length) {
    lines.push(
      `临时/备份文件 ${temps.length} 个待清理：`,
      ...temps.slice(0, 12).map((f) => '  · ' + path.relative(cwd, f)),
      temps.length > 12 ? `  · …另 ${temps.length - 12} 个` : '',
    );
  }
  if (freshReports.length) {
    lines.push(
      '本轮生成的报告类文件（确认是否需要保留 / 归档到 docs/）：',
      ...freshReports.slice(0, 8).map((f) => '  · ' + path.relative(cwd, f)),
    );
  }
  if (changedDocs.length) {
    lines.push('本轮改动了文档，确认内容已同步（不要留下过时描述）：', ...changedDocs.map((f) => '  · ' + f));
  }
  if (changed.length) {
    lines.push(
      '本轮改动文件（检查是否还有配套项未更新：测试、类型、文档、CHANGELOG）：',
      ...changed.slice(-8).map((f) => '  · ' + f),
    );
  }

  if (!lines.length) return null;

  m.writeState(cwd, { ...state, cleanupNudged: true });
  const body = ['【收尾参考】', ...lines.filter(Boolean), '', '以上为提示，按实际情况决定是否处理。'].join('\n');
  return { additionalContext: body };
}

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const cwd = payload.cwd || process.cwd();
  const state = m.readState(cwd);
  const out = await runCached(payload, state);
  if (out) m.emit(out);
}

if (require.main === module) main();

module.exports = { runCached, TMP_PATTERNS, SKIP_DIRS };
