// 通过 GitHub REST API 对当前分支做「安全快进」推送（绕过 github.com:443 的 git 协议）。
// 约束：远端 HEAD 必须是本地 HEAD 的祖先；只新增/更新本地文件，绝不删除远端独有文件，绝不 force。
// 用法：node scripts/gh-api-push.js <owner> [--repo rules] [--branch main] [--dry-run]
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function normalizePath(value) {
  if (process.platform === 'win32' && /^\/[A-Za-z]\//.test(value)) {
    return value[1].toUpperCase() + ':\\' + value.slice(3).replaceAll('/', '\\');
  }
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const owner = positional[0] || 'badhope';
  const branchIndex = args.indexOf('--branch');
  const branch = branchIndex >= 0 && args[branchIndex + 1] ? args[branchIndex + 1] : (positional[1] || 'main');
  const repoIndex = args.indexOf('--repo');
  const repoName = repoIndex >= 0 && args[repoIndex + 1] ? args[repoIndex + 1] : 'rules';
  const dryRun = args.includes('--dry-run');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repoName) || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    throw new Error('owner/repo/branch 参数包含非法字符');
  }
  return { owner, repoName, branch, dryRun };
}

function secureVaultFile(file) {
  if (process.platform !== 'win32') return;
  try {
    const user = os.userInfo().username;
    const { execFileSync } = require('node:child_process');
    execFileSync('icacls', [file, '/reset'], { stdio: 'ignore' });
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:R`, '/grant', '*S-1-5-18:F', '/grant', '*S-1-5-32-544:F'], { stdio: 'ignore' });
  } catch {
    throw new Error('Windows ACL 无法收紧，拒绝读取凭据库');
  }
}

function loadToken(owner) {
  const vault = normalizePath(process.env.AGENT_SECRETS_DIR || path.join(os.homedir(), '.agent-secrets'));
  const file = path.join(vault, 'accounts.json');
  secureVaultFile(file);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const token = value?.platforms?.github?.accounts?.[owner]?.token;
  if (!token) throw new Error('GitHub 账号未配置：' + owner);
  return token;
}

function call(method, url, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const attempt = (retriesLeft) => {
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': 'agent-rules-push',
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': data ? Buffer.byteLength(data) : 0,
        },
      }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(d); } catch { parsed = null; }
          // 5xx / 429 值得重试；4xx 直接返回让调用方读错误信息。
          if ((res.statusCode >= 500 || res.statusCode === 429) && retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1), 2000 * (4 - retriesLeft));
            return;
          }
          finish({ code: res.statusCode, body: parsed });
        });
      });
      req.setTimeout(60000, () => req.destroy(new Error('request timeout')));
      req.on('error', (e) => {
        const msg = (e && e.message) || String(e);
        if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 2000 * (4 - retriesLeft));
          return;
        }
        finish({ code: 0, body: null, error: msg });
      });
      if (data) req.write(data);
      req.end();
    };
    attempt(3);
  });
}

function gitEntries() {
  const out = execFileSync('git', ['ls-files', '-s'], { cwd: ROOT, encoding: 'utf8' });
  const entries = new Map();
  for (const line of out.split('\n')) {
    const match = line.match(/^(\d+) ([0-9a-f]+) \d+\t(.+)$/);
    if (match) entries.set(match[3], { mode: match[1], sha: match[2] });
  }
  return entries;
}

function gitBlob(file) {
  return execFileSync('git', ['show', `HEAD:${file}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function createBlob(repo, file, token) {
  const buf = gitBlob(file);
  if (buf.length > 5 * 1024 * 1024) throw new Error('文件超过 GitHub API 5 MiB 限制：' + file);
  const result = await call('POST', `${repo}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  }, token);
  if (result.code !== 201 || !result.body?.sha) {
    throw new Error('blob 创建失败：' + file + '（HTTP ' + result.code + (result.error ? ' ' + result.error : '') + '）');
  }
  return result.body.sha;
}

(async () => {
  const { owner, repoName, branch, dryRun } = parseArgs();
  const token = loadToken(owner);
  const repo = `https://api.github.com/repos/${owner}/${repoName}`;

  const ref = await call('GET', `${repo}/git/ref/heads/${branch}`, null, token);
  if (ref.code !== 200 || !ref.body?.object?.sha) { console.error('ref read failed', ref.code); process.exit(1); }
  const parentSha = ref.body.object.sha;

  // 安全闸门：远端提交必须存在于本地且是 HEAD 的祖先，否则拒绝用 API 覆盖。
  try {
    execFileSync('git', ['cat-file', '-e', `${parentSha}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    execFileSync('git', ['merge-base', '--is-ancestor', parentSha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    console.error(`拒绝 API 推送：远端 HEAD ${parentSha.slice(0, 7)} 不在本地历史中；先 fetch 并确认快进，不能用 API 覆盖。`);
    process.exit(2);
  }

  const parentCommit = await call('GET', `${repo}/git/commits/${parentSha}`, null, token);
  if (parentCommit.code !== 200 || !parentCommit.body?.tree?.sha) { console.error('parent commit read failed', parentCommit.code); process.exit(1); }
  const baseTree = parentCommit.body.tree.sha;

  const entries = gitEntries();
  const files = [...entries.keys()];
  console.log('files:', files.length);

  const remoteTree = await call('GET', `${repo}/git/trees/${baseTree}?recursive=1`, null, token);
  if (remoteTree.code !== 200) { console.error('tree read failed', remoteTree.code); process.exit(1); }
  const remoteEntries = new Map(
    (remoteTree.body.tree || [])
      .filter((x) => x.type === 'blob')
      .map((x) => [x.path, { sha: x.sha, mode: x.mode }])
  );
  const localPaths = new Set(files);
  const remoteOnly = [...remoteEntries.keys()].filter((p) => !localPaths.has(p));
  if (remoteOnly.length) {
    console.log(`保留远端独有文件 ${remoteOnly.length} 个（API 推送不删除任何远端文件）。`);
  }

  let reused = 0;
  let created = 0;
  const tree = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const local = entries.get(f);
    const remote = remoteEntries.get(f);
    if (remote && remote.sha === local.sha) {
      reused += 1;
      continue;
    }
    created += 1;
    if (!dryRun) {
      const sha = await createBlob(repo, f, token);
      tree.push({ path: f, mode: local.mode, type: 'blob', sha });
    }
  }
  console.log(`changed blobs: ${created}, unchanged: ${reused}`);
  if (dryRun) {
    console.log('dry-run：未写入远端。');
    return;
  }
  if (!tree.length) {
    console.log('远端内容已一致，无需提交。');
    return;
  }

  // 分块提交 tree（避免单请求过大）
  let currentTree = baseTree;
  const CHUNK = 60;
  for (let i = 0; i < tree.length; i += CHUNK) {
    const chunk = tree.slice(i, i + CHUNK);
    const t = await call('POST', `${repo}/git/trees`, { base_tree: currentTree, tree: chunk }, token);
    if (t.code !== 201) { console.error('tree failed at', i, t.code, t.body); process.exit(1); }
    currentTree = t.body.sha;
    console.log(`  tree chunk ${i}-${i + chunk.length} ok`);
  }

  // 用本地提交的完整 message + author/committer + 时间复现同一 commit SHA。
  // 注意：git 的 commit 对象 message 以单个 \n 结尾，GitHub API 不会自动补，必须自己带。
  const meta = execSync('git log -1 --format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B', {
    cwd: ROOT, encoding: 'utf8',
  }).replace(/\s+$/, '');
  const parts = meta.split('\x00');
  const message = parts.slice(6).join('\x00').replace(/\s+$/, '') + '\n';
  const [an, ae, aI, cn, ce, cI] = parts;
  const commit = await call('POST', `${repo}/git/commits`, {
    message,
    tree: currentTree,
    parents: [parentSha],
    author: { name: an, email: ae, date: aI },
    committer: { name: cn, email: ce, date: cI },
  }, token);
  if (commit.code !== 201) { console.error('commit failed', commit.code, commit.body); process.exit(1); }

  const upd = await call('PATCH', `${repo}/git/refs/heads/${branch}`, { sha: commit.body.sha, force: false }, token);
  if (upd.code !== 200) { console.error('ref update failed', upd.code); process.exit(1); }

  const localSha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  console.log(`pushed ${owner}: ${parentSha.slice(0, 7)} -> ${commit.body.sha.slice(0, 7)}${commit.body.sha === localSha ? ' (same as local)' : ' (local ' + localSha.slice(0, 7) + ')'}`);
})();
