// 通过 GitHub REST API 推送当前工作树快照（绕过 git 协议，适用于 github.com:443 不通时）。
// 用法：node scripts/gh-api-push.js <owner> [--branch main]
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

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
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    throw new Error('owner/branch 参数包含非法字符');
  }
  return { owner, branch };
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
        resolve({ code: res.statusCode, body: parsed });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    req.on('error', () => resolve({ code: 0, body: null }));
    if (data) req.write(data);
    req.end();
  });
}

function listFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

(async () => {
  const { owner, branch } = parseArgs();
  const token = loadToken(owner);
  const repo = `https://api.github.com/repos/${owner}/rules`;

  const ref = await call('GET', `${repo}/git/ref/heads/${branch}`, null, token);
  if (ref.code !== 200 || !ref.body?.object?.sha) { console.error('ref read failed', ref.code); process.exit(1); }
  const parentSha = ref.body.object.sha;

  const parentCommit = await call('GET', `${repo}/git/commits/${parentSha}`, null, token);
  if (parentCommit.code !== 200 || !parentCommit.body?.tree?.sha) { console.error('parent commit read failed', parentCommit.code); process.exit(1); }
  const baseTree = parentCommit.body.tree.sha;

  const files = listFiles();
  console.log('files:', files.length);

  // 关键：Git Data API 的 tree 是「叠加」语义，删除文件必须显式传 sha:null，
  // 否则远端会保留已删文件（这是运行态垃圾清理后仍残留的原因）。
  const remoteTree = await call('GET', `${repo}/git/trees/${baseTree}?recursive=1`, null, token);
  if (remoteTree.code !== 200) { console.error('tree read failed', remoteTree.code); process.exit(1); }
  const remotePaths = new Set(
    (remoteTree.body.tree || []).filter((x) => x.type === 'blob').map((x) => x.path)
  );
  const localPaths = new Set(files);
  const deletions = [...remotePaths].filter((p) => !localPaths.has(p));

  const tree = [];
  for (const p of deletions) {
    tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
  }
  if (deletions.length) console.log('deletions:', deletions.length);

  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (buf.length > 5 * 1024 * 1024) { console.log('skip large', f); continue; }
    tree.push({ path: f, mode: '100644', type: 'blob', content: buf.toString('utf8') });
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

  const msg = execSync('git log -1 --format=%s', { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = await call('POST', `${repo}/git/commits`, {
    message: msg, tree: currentTree, parents: [parentSha],
  }, token);
  if (commit.code !== 201) { console.error('commit failed', commit.code, commit.body); process.exit(1); }

  const upd = await call('PATCH', `${repo}/git/refs/heads/${branch}`, { sha: commit.body.sha, force: false }, token);
  if (upd.code !== 200) { console.error('ref update failed', upd.code); process.exit(1); }

  console.log(`pushed ${owner}: ${parentSha.slice(0, 7)} -> ${commit.body.sha.slice(0, 7)}`);
})();
