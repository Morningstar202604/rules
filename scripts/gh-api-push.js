// 通过 GitHub REST API 推送当前工作树快照（绕过 git 协议，适用于 github.com:443 不通时）。
// 用法：node scripts/gh-api-push.js <owner> [--branch main]
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = process.env.GH_TOKEN || (() => {
  const vault = path.join(os.homedir(), '.agent-secrets', 'accounts.json');
  const v = JSON.parse(fs.readFileSync(vault, 'utf8'));
  return v.platforms.github.accounts.badhope.token;
})();

function call(method, url, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      method,
      headers: {
        'User-Agent': 'agent-rules-push',
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d.slice(0, 200); }
        resolve({ code: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => resolve({ code: 0, body: String(e) }));
    if (data) req.write(data);
    req.end();
  });
}

function listFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

(async () => {
  const owner = process.argv[2] || 'badhope';
  const branch = process.argv[3] || 'main';
  const repo = `https://api.github.com/repos/${owner}/rules`;

  const ref = await call('GET', `${repo}/git/ref/heads/${branch}`);
  if (ref.code !== 200) { console.error('ref read failed', ref.code, ref.body); process.exit(1); }
  const parentSha = ref.body.object.sha;

  const parentCommit = await call('GET', `${repo}/git/commits/${parentSha}`);
  const baseTree = parentCommit.body.tree.sha;

  const files = listFiles();
  console.log('files:', files.length);

  const tree = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (buf.length > 5 * 1024 * 1024) { console.log('skip large', f); continue; }
    tree.push({ path: f, mode: '100644', type: 'blob', content: buf.toString('utf8') });
  }

  // 分块提交 tree（避免单请求过大）
  let currentTree = baseTree;
  const CHUNK = 120;
  for (let i = 0; i < tree.length; i += CHUNK) {
    const chunk = tree.slice(i, i + CHUNK);
    const t = await call('POST', `${repo}/git/trees`, { base_tree: currentTree, tree: chunk });
    if (t.code !== 201) { console.error('tree failed at', i, t.code, t.body); process.exit(1); }
    currentTree = t.body.sha;
    console.log(`  tree chunk ${i}-${i + chunk.length} ok`);
  }

  const msg = execSync('git log -1 --format=%s', { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = await call('POST', `${repo}/git/commits`, {
    message: msg, tree: currentTree, parents: [parentSha],
  });
  if (commit.code !== 201) { console.error('commit failed', commit.code, commit.body); process.exit(1); }

  const upd = await call('PATCH', `${repo}/git/refs/heads/${branch}`, { sha: commit.body.sha, force: true });
  if (upd.code !== 200) { console.error('ref update failed', upd.code, upd.body); process.exit(1); }

  console.log(`pushed ${owner}: ${parentSha.slice(0, 7)} -> ${commit.body.sha.slice(0, 7)}`);
})();
