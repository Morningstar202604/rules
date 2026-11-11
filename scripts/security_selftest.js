'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const TOKEN = 'synthetic-token-for-security-test';
const TMP = fs.mkdtempSync(path.join(REPO, 'security-selftest-'));

function run(command, args, env = {}) {
 const result = spawnSync(command, args, {
 cwd: REPO,
 encoding: 'utf8',
 timeout:30000,
 env: { ...process.env, ...env },
 });
 if (result.error && result.error.code !== 'ENOENT') throw result.error;
 return result;
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
  // copyFileSync 不保留可执行位；Linux CI 上直接执行 askpass 会 EACCES。
  fs.chmodSync(path.join(uploadRepo, 'scripts', 'git-askpass.sh'), 0o755);
  fs.chmodSync(path.join(uploadRepo, 'scripts', 'git-askpass.js'), 0o755);
  fs.writeFileSync(path.join(uploadRepo, 'README.md'), 'isolated\n');
  // Source the uploader with a readonly function, never a real git executable.
 const guard = path.join(TMP, 'git-guard.sh');
 const gitLog = path.join(TMP, 'git-calls.log');
 fs.writeFileSync(guard, `git() {
 if [ "$#" -eq 4 ] && [ "$1" = -C ] && [ "$3" = rev-parse ] && [ "$4" = --is-inside-work-tree ]; then
 printf 'probe\n' >> "$FAKE_GIT_LOG"; printf 'true\n'; return 0
 fi
 if [ "$#" -eq 5 ] && [ "$1" = -C ] && [ "$3" = status ] && [ "$4" = --porcelain ] && [ "$5" = --untracked-files=all ]; then
 printf 'status\n' >> "$FAKE_GIT_LOG"; return 0
 fi
 if [ "$#" -eq 7 ] && [ "$1" = -c ] && [ "$2" = credential.helper= ] && [ "$3" = -C ] && [ "$5" = push ]; then
 local url="$6" askpass="$GIT_ASKPASS" password
 [[ "$url" == https://* ]] || return 40
 [[ "$url" =~ ^https://[^/@:]+:[^/@]*@ ]] && return 41
 if command -v cygpath >/dev/null 2>&1; then askpass="$(cygpath -u "$askpass")"; fi
 password="$("$askpass" "Password for $url")" || return 42
 [ "$password" = "$EXPECTED_TOKEN" ] || return 42
 printf 'push %s\n' "$url" >> "$FAKE_GIT_LOG"
 return 0
 fi
 printf 'unexpected\n' >> "$FAKE_GIT_LOG"
 return 99
}
readonly -f git
`);
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
  const guardTest = run('bash', ['--noprofile', '--norc', '-c',
 'source "$1"; [[ $(type -t git) = function ]] || exit 98; (unset -f git)2>/dev/null && exit 97; git unexpected; [[ $? = 99 ]]',
 'security-selftest', bashPath(guard)], { FAKE_GIT_LOG: bashPath(gitLog), BASH_ENV: '' });
 assert.equal(guardTest.status,0, 'Git 拦截器必须只读且拒绝未知命令');
 assert.equal(fs.readFileSync(gitLog, 'utf8').trim(), 'unexpected');
 fs.unlinkSync(gitLog);
 const upload = run('bash', ['--noprofile', '--norc', '-c',
 'source "$1"; [[ $(type -t git) = function ]] || exit 98; source "$2" "$3"',
 'security-selftest', bashPath(guard), uploadScript, repoForBash], {
 AGENT_SECRETS_DIR: vault,
 UPLOAD_SLEEP: '0',
 UPLOAD_BACKOFF: '0',
 EXPECTED_TOKEN: TOKEN,
 FAKE_GIT_LOG: bashPath(gitLog),
 BASH_ENV: '',
 });
 assert.equal(upload.status, 0, `隔离上传失败：${upload.stderr}`);
  assertNoToken(upload, '上传输出泄露测试 token');
  assert.match(upload.stdout, /五平台上传完成/);
 const calls = fs.readFileSync(gitLog, 'utf8').trim().split(/\r?\n/);
 assert.deepEqual(calls.slice(0,2), ['probe', 'status']);
 assert.equal(calls.length,7, '必须恰好经过五次 fake git push');
 assert.deepEqual(new Set(calls.slice(2)), new Set([
 'push https://badhope@gitcode.com/badhope/rules.git',
 'push https://badhope@gitee.com/badhope/rules.git',
 'push https://X33834@github.com/X33834/rules.git',
 'push https://Morningstar202604@github.com/Morningstar202604/rules.git',
 'push https://badhope@github.com/badhope/rules.git',
 ]));

  process.stdout.write('security selftest: PASS\n');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
