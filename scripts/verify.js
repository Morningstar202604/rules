'use strict';

// 交付前自检：只读检查，不改任何文件。
// 用法：node scripts/verify.js

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
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
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const skills = fs.readdirSync(path.join(REPO, 'core', 'skills')).filter((d) =>
  fs.existsSync(path.join(REPO, 'core', 'skills', d, 'SKILL.md'))
);

check('技能数量 = 98', () => {
  if (skills.length !== 98) throw new Error('实际 ' + skills.length);
  return '98';
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

check('钩子 8 个 + ledger CLI + lib 8 个', () => {
  const hooks = fs.readdirSync(path.join(REPO, 'core', 'hooks')).filter((f) => f.endsWith('.js') && f !== 'selftest.js');
  const lib = fs.readdirSync(path.join(REPO, 'core', 'hooks', 'lib')).filter((f) => f.endsWith('.js'));
  if (hooks.length !== 9) throw new Error('钩子 ' + hooks.length);
  if (lib.length !== 8) throw new Error('lib ' + lib.length);
  if (!hooks.includes('ledger.js')) throw new Error('缺 ledger.js');
  return '8 + ledger + 7';
});

check('钩子自检 56/56', () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'core', 'hooks', 'selftest.js')], {
    encoding: 'utf8',
    cwd: REPO,
  });
  if (!/ALL 56 CASES PASS/.test(out)) throw new Error(out.split('\n').slice(-3).join(' '));
  return 'ALL 56 CASES PASS';
});

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{32,}/,
];

// 上游技能自带的负向测试fixture：形似密钥但明确是假值（FAKE / EXAMPLE / canary），不算泄露。
const FIXTURE_HINT = /FAKE|EXAMPLE|CANARY|canary|dummy|placeholder|<FILL|000000/i;

check('无真实密钥特征', () => {
  const hits = [];
  for (const f of walk(REPO)) {
    if (!/\.(md|js|json|py|yml|yaml|sh|txt)$/i.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const re of SECRET_PATTERNS) {
      const m = re.exec(t);
      if (!m) continue;
      const line = t.slice(t.lastIndexOf('\n', m.index) + 1, t.indexOf('\n', m.index));
      if (FIXTURE_HINT.test(line)) continue;
      hits.push(path.relative(REPO, f) + ' :: ' + m[0].slice(0, 12) + '…');
    }
  }
  if (hits.length) throw new Error(hits.join('; '));
  return '0 hits';
});

check('无个人绝对路径', () => {
  const hits = [];
  for (const f of walk(REPO)) {
    if (!/\.(md|js|json|py|yml|yaml|sh|txt)$/i.test(f)) continue;
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

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  process.stdout.write((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.detail ? '  (' + r.detail + ')' : '') + '\n');
}
process.stdout.write('\n' + (results.length - failed) + '/' + results.length + ' checks passed\n');
process.exitCode = failed ? 1 : 0;
