'use strict';

// 交付前自检：只读检查，不改任何文件。
// 用法：node scripts/verify.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const NPM = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';

function npmPackDryRun() {
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd pack --dry-run --json']
    : ['pack', '--dry-run', '--json'];
  return execFileSync(NPM, args, { encoding: 'utf8', cwd: REPO });
}
const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.tmp' || e.name === '.aqg') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function textFile(file) {
  return /\.(md|js|json|py|yml|yaml|sh|txt|env|ini|cfg|conf|pem)$/i.test(file);
}

const skills = fs.readdirSync(path.join(REPO, 'core', 'skills')).filter((d) =>
  fs.existsSync(path.join(REPO, 'core', 'skills', d, 'SKILL.md'))
);

check('技能数量 = 102', () => {
  if (skills.length !== 102) throw new Error('实际 ' + skills.length);
  return '102';
});

check('每个技能都有 SKILL.md 与 name 字段', () => {
  const bad = [];
  for (const s of skills) {
    const t = fs.readFileSync(path.join(REPO, 'core', 'skills', s, 'SKILL.md'), 'utf8');
    if (!/^---\s*$/m.test(t) || !/^\s*name:\s*\S+/m.test(t)) bad.push(s);
  }
  if (bad.length) throw new Error('缺 frontmatter/name：' + bad.join(', '));
  return skills.length + ' ok';
});

check('子代理数量 = 220', () => {
  const n = fs.readdirSync(path.join(REPO, 'core', 'agents')).filter((f) => f.endsWith('.md')).length;
  if (n !== 220) throw new Error('实际 ' + n);
  return '220';
});

check('命令 4 个', () => {
  const n = fs.readdirSync(path.join(REPO, 'core', 'commands')).filter((f) => f.endsWith('.md')).length;
  if (n !== 4) throw new Error('实际 ' + n);
  return '4';
});

check('9 个事件钩子 + cleanup-check + ledger CLI + lib 8 个', () => {
  const hooks = fs.readdirSync(path.join(REPO, 'core', 'hooks')).filter((f) => f.endsWith('.js') && f !== 'selftest.js');
  const lib = fs.readdirSync(path.join(REPO, 'core', 'hooks', 'lib')).filter((f) => f.endsWith('.js'));
  if (hooks.length !== 11) throw new Error('钩子 ' + hooks.length);
  if (lib.length !== 8) throw new Error('lib ' + lib.length);
  if (!hooks.includes('ledger.js')) throw new Error('缺 ledger.js');
  if (!hooks.includes('repeat-guard.js')) throw new Error('缺 repeat-guard.js');
  return '9 event hooks + cleanup-check + ledger + 8 lib';
});

check('钩子自检 72/72', () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'core', 'hooks', 'selftest.js')], {
    encoding: 'utf8',
    cwd: REPO,
  });
  if (!/ALL 72 CASES PASS/.test(out)) throw new Error(out.split('\n').slice(-3).join(' '));
  return 'ALL 72 CASES PASS';
});

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
];

// 仅允许已知负向 fixture 中带明确假值标记的单行命中；其它命中一律失败。
const FIXTURE_FILES = new Set([
  'core/skills/aqg-automation-audit/scripts/self_test.py',
  'core/skills/aqg-session-handoff/scripts/self_test.py',
  'core/skills/aqg-session-handoff/tests/test_session_handoff.py',
  'core/skills/env-secrets-manager/assets/sample_env_leak.env',
]);
const FIXTURE_LINE_HASHES = new Set([
  '2b0fd5a051e6deebb9969867d3d78a304e8b9ddd922d0b25fe299c458f4c884f',
  '2b3b7a6e5a42f3f7b1b640c8f7c786560d807bfa00645cbd91e883aea1319f96',
]);
const FIXTURE_HINT = /FAKE|EXAMPLE|CANARY|canary|dummy|<FILL|000000|SYNTHETIC|<redacted>/i;

check('无真实密钥特征', () => {
  const hits = [];
  for (const f of walk(REPO)) {
    if (!textFile(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const re of SECRET_PATTERNS) {
      const matcher = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of t.matchAll(matcher)) {
        const rel = path.relative(REPO, f).replaceAll(path.sep, '/');
        const lineStart = t.lastIndexOf('\n', m.index) + 1;
        const lineEnd = t.indexOf('\n', m.index) < 0 ? t.length : t.indexOf('\n', m.index);
        const line = t.slice(lineStart, lineEnd).replace(/\r$/, '');
        const lineHash = crypto.createHash('sha256').update(line).digest('hex');
        if (FIXTURE_LINE_HASHES.has(lineHash) || (FIXTURE_FILES.has(rel) && FIXTURE_HINT.test(line))) continue;
        hits.push(rel + ' :: ' + m[0].slice(0, 12) + '…');
      }
    }
  }
  if (hits.length) throw new Error(hits.join('; '));
  return '0 hits';
});

check('无个人绝对路径', () => {
  const hits = [];
  for (const f of walk(REPO)) {
    if (!textFile(f)) continue;
    if (f.endsWith('verify.js')) continue;
    if (path.relative(REPO, f).startsWith('.tmp')) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (/C:[\\/]Users[\\/]X1882/.test(t)) hits.push(path.relative(REPO, f));
  }
  if (hits.length) throw new Error(hits.join(', '));
  return '0 hits';
});

check('不含运行态目录', () => {
  for (const d of ['memory', 'state', 'backup', '.tmp', 'node_modules']) {
    if (fs.existsSync(path.join(REPO, d)) && d !== '.tmp') throw new Error('发现 ' + d);
  }
  return 'clean';
});

check('必需文档齐全', () => {
  const need = ['README.md', 'AGENTS.md', 'LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
    'docs/PORTABILITY.md', 'docs/HOOKS.md', 'docs/SECRETS.md', 'docs/SKILLS.md', 'docs/REUSE-PROMPT.md'];
  const missing = need.filter((f) => !fs.existsSync(path.join(REPO, f)));
  if (missing.length) throw new Error('缺 ' + missing.join(', '));
  return need.length + ' files';
});

check('install.js 语法与帮助', () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'install.js')], { encoding: 'utf8', cwd: REPO });
  if (!/--tool/.test(out)) throw new Error('无帮助输出');
  return 'ok';
});

check('npm 包含安装运行时脚本', () => {
  const raw = npmPackDryRun();
  const files = JSON.parse(raw)[0].files.map((f) => f.path);
  const required = ['scripts/accounts_cli.py', 'scripts/upload_all.sh', 'scripts/gh-api-push.js', 'scripts/git-askpass.js'];
  const missing = required.filter((f) => !files.includes(f));
  if (missing.length) throw new Error('缺 ' + missing.join(', '));
  return required.length + ' scripts';
});

check('凭据路径安全回归', () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'security_selftest.js')], { encoding: 'utf8', cwd: REPO });
  if (!/security selftest: PASS/.test(out)) throw new Error(out);
  return 'PASS';
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  process.stdout.write((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.detail ? '  (' + r.detail + ')' : '') + '\n');
}
process.stdout.write('\n' + (results.length - failed) + '/' + results.length + ' checks passed\n');
process.exitCode = failed ? 1 : 0;
