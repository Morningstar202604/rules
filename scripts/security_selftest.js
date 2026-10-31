'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const TOKEN = 'synthetic-token-for-security-test';
const TMP = path.join(REPO, '.tmp', 'security-selftest');

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function pythonCommand() {
  for (const candidate of [
    ['python', []],
    ['python3', []],
    ['py', ['-3']],
  ]) {
    const result = run(candidate[0], [...candidate[1], '--version']);
    if (result.status === 0) return candidate;
  }
  throw new Error('找不到 Python 3');
}

function assertNoToken(result, label) {
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(TOKEN), false, label);
}

function bashPath(file) {
  const probe = run('bash', ['-lc', 'command -v cygpath']);
  if (probe.status === 0) {
    return run('bash', ['-lc', 'cygpath -u -- "$1"', 'bash', file]).stdout.trim();
  }
  return file.split(path.sep).join('/');
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
try {
  const vault = path.join(TMP, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'accounts.json'), JSON.stringify({
    version: 1,
    platforms: {
      github: {
        api_base: 'https://api.github.com',
        accounts: { tester: { token: TOKEN, status: 'unchecked' } },
      },
    },
  }) + '\n', 'utf8');

  const py = pythonCommand();
  for (const command of ['list', 'sync', 'store-git', 'env', 'path']) {
    const result = run(py[0], [...py[1], path.join('scripts', 'accounts_cli.py'), command], {
      AGENT_SECRETS_DIR: vault,
    });
    assertNoToken(result, `${command} 泄露测试 token`);
    if (command !== 'list' && command !== 'path') assert.notEqual(result.status, 0, `${command} 应拒绝明文凭据路径`);
  }

  const askpass = run(process.execPath, [path.join('scripts', 'git-askpass.js'), 'Password for https://tester@example.invalid'], {
    AGENT_SECRETS_DIR: vault,
    AGENT_GIT_PLATFORM: 'github',
    AGENT_GIT_ACCOUNT: 'tester',
  });
  assert.equal(askpass.status, 0, 'askpass 应成功读取隔离凭据');
  assert.equal(askpass.stdout, `${TOKEN}\n`, 'askpass 返回值只交给 Git 密码通道');
  assert.equal(fs.readFileSync(path.join(vault, 'accounts.json'), 'utf8').includes(TOKEN), true, '隔离凭据应只存在测试 vault');

  const uploader = fs.readFileSync(path.join(REPO, 'scripts', 'upload_all.sh'), 'utf8');
  assert.equal(uploader.includes('a.token'), false, '上传脚本不得读取 token 拼接 URL');
  assert.equal(uploader.includes('GIT_ASKPASS='), true, '上传脚本必须使用 askpass');
  assert.equal(uploader.includes('if out=$(AGENT_SECRETS_DIR='), true, '上传失败必须进入可重试分支');

  const bash = run('bash', ['--version']);
  assert.equal(bash.status, 0, '上传安全回归需要 Git Bash');
  const uploadRepo = path.join(TMP, 'repo');
  fs.mkdirSync(path.join(uploadRepo, 'scripts'), { recursive: true });
  for (const file of ['upload_all.sh', 'git-askpass.sh', 'git-askpass.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', file), path.join(uploadRepo, 'scripts', file));
  }
  fs.writeFileSync(path.join(uploadRepo, 'README.md'), 'isolated\n');
  let git = run('git', ['init', '-q', uploadRepo]);
  assert.equal(git.status, 0, '隔离 Git 仓库初始化失败');
  git = run('git', ['-C', uploadRepo, 'add', '.']);
  assert.equal(git.status, 0, '隔离 Git 仓库暂存失败');
  git = run('git', ['-C', uploadRepo, '-c', 'user.name=security-selftest', '-c', 'user.email=security-selftest@example.invalid', 'commit', '-qm', 'fixture']);
  assert.equal(git.status, 0, '隔离 Git 仓库提交失败');

  const fakeBin = path.join(TMP, 'fake-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const realGit = run('bash', ['-lc', 'command -v git']);
  assert.equal(realGit.status, 0, '找不到真实 git');
  const fakeGit = path.join(fakeBin, 'git');
  fs.writeFileSync(fakeGit, `#!/usr/bin/env bash\nset -euo pipefail\nis_push=0\nurl=''\nfor arg in "$@"; do\n  [ "$arg" = push ] && is_push=1\n  if [ "$is_push" = 1 ] && [[ "$arg" == https://* ]]; then url="$arg"; break; fi\ndone\nif [ "$is_push" = 1 ]; then\n  if [[ "$url" =~ ^https://[^/@:]+:[^/@]*@ ]]; then exit 41; fi\n  askpass="$GIT_ASKPASS"\n  if [[ "$askpass" =~ ^[A-Za-z]:\\\\ ]]; then askpass="$(cygpath -u "$askpass")"; fi\n  password="$("$askpass" "Password for $url")"\n  [ "$password" = "$EXPECTED_TOKEN" ] || exit 42\n  exit 0\nfi\nexec "$REAL_GIT" "$@"\n`);
  fs.chmodSync(fakeGit, 0o755);
  const accountData = { version: 1, platforms: {
    gitcode: { accounts: { badhope: { token: TOKEN } } },
    gitee: { accounts: { badhope: { token: TOKEN } } },
    github: { accounts: {
      X33834: { token: TOKEN }, Morningstar202604: { token: TOKEN }, badhope: { token: TOKEN },
    } },
  } };
  fs.writeFileSync(path.join(vault, 'accounts.json'), JSON.stringify(accountData) + '\n');
  const repoForBash = bashPath(uploadRepo);
  const uploadScript = `${repoForBash}/scripts/upload_all.sh`;
  const upload = run('bash', [uploadScript, repoForBash], {
    AGENT_SECRETS_DIR: vault,
    UPLOAD_SLEEP: '0',
    EXPECTED_TOKEN: TOKEN,
    REAL_GIT: realGit.stdout.trim(),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  });
  assert.equal(upload.status, 0, `隔离上传失败：${upload.stderr}`);
  assertNoToken(upload, '上传输出泄露测试 token');
  assert.match(upload.stdout, /五平台上传完成/);

  process.stdout.write('security selftest: PASS\n');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
