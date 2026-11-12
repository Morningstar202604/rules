// GitHub Git Data API: reproduce local Git objects, or refuse to update the ref.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
let ROOT = path.resolve(__dirname, '..');
function git(...args) { return execFileSync('git', ['-C', ROOT, ...args], { maxBuffer:64 *1024 *1024 }); }
function text(...args) { return git(...args).toString('utf8').trim(); }
function parseCommit(sha) {
 const raw = git('cat-file', 'commit', sha);
 const s = raw.toString('utf8');
 if (!Buffer.from(s).equals(raw)) throw Error('非 UTF-8 提交不支持');
 const at = s.indexOf('\n\n');
 if (at <0) throw Error('无效提交');
 const lines = s.slice(0, at).split('\n');
 const tree = /^tree ([0-9a-f]{40})$/.exec(lines.shift() || '');
 const parents = [];
 while (lines[0]?.startsWith('parent ')) {
 const m = /^parent ([0-9a-f]{40})$/.exec(lines.shift());
 if (!m) throw Error('无效父提交');
 parents.push(m[1]);
 }
 function identity(line, kind) {
 const m = new RegExp(`^${kind} (.+) <([^<>]*)> ([0-9]+) ([+-][0-9]{4})$`).exec(line || '');
 if (!m) throw Error('不支持的提交身份');
 const offset = (Number(m[4].slice(1,3)) *60 + Number(m[4].slice(3))) * (m[4][0] === '-' ? -1 :1);
 if (Math.abs(offset) >1439) throw Error('无效时区');
 const date = new Date(Number(m[3]) *1000 + offset *60000).toISOString().replace('.000Z', '') + m[4].slice(0,3) + ':' + m[4].slice(3);
 return { name: m[1], email: m[2], date };
 }
 if (!tree) throw Error('无效 tree');
 const author = identity(lines.shift(), 'author');
 const committer = identity(lines.shift(), 'committer');
 if (lines.length) throw Error('签名或扩展提交头无法精确重建');
 return { tree: tree[1], parents, author, committer, message: s.slice(at +2) };
}
function collectTree(sha, trees, blobs) {
 if (trees.has(sha)) return;
 const entries = [];
 for (const part of git('ls-tree', '-z', sha).toString('latin1').split('\0').filter(Boolean)) {
 const m = /^(\d+) (tree|blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(part);
 if (!m || m[2] === 'commit') throw Error('不支持子模块');
 const bytes = Buffer.from(m[4], 'latin1');
 const name = bytes.toString('utf8');
 if (!Buffer.from(name).equals(bytes)) throw Error('不支持非 UTF-8 路径');
 const mode = m[1].padStart(6, '0');
 if (!['040000', '100644', '100755', '120000'].includes(mode)) throw Error('不支持的文件模式');
 entries.push({ path: name, mode, type: m[2], sha: m[3] });
 if (m[2] === 'tree') collectTree(m[3], trees, blobs);
 else if (!blobs.has(m[3])) {
 const data = git('cat-file', 'blob', m[3]);
 if (data.length >5 *1024 *1024) throw Error('blob 超过5 MiB');
 blobs.set(m[3], data);
 }
 }
 trees.set(sha, entries);
}
function call(method, url, body, token) {
 return new Promise((resolve, reject) => {
 const data = body ? JSON.stringify(body) : null;
 const req = https.request(url, { method, headers: { 'User-Agent': 'agent-rules-push', Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, res => {
 let result = '';
 res.on('data', chunk => { result += chunk; });
 res.on('error', reject);
 res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(result) }); } catch { reject(Error('API 返回无效 JSON')); } });
 });
 req.setTimeout(60000, () => req.destroy(Error('request timeout')));
 req.on('error', reject);
 if (data) req.write(data);
 req.end();
 });
}
async function main(options = {}) {
 if (options.root) ROOT = options.root;
 const request = options.call || call;
 const args = options.args ? [...options.args] : process.argv.slice(2);
 const owner = args.shift();
 let repoName = 'rules', branch = 'main', dry = false;
 while (args.length) {
 const arg = args.shift();
 if (arg === '--repo') repoName = args.shift();
 else if (arg === '--branch') branch = args.shift();
 else if (arg === '--dry-run') dry = true;
 else throw Error('未知参数');
 }
 if (!/^[A-Za-z0-9._-]+$/.test(owner || '') || !/^[A-Za-z0-9._-]+$/.test(repoName || '') || !branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) throw Error('无效参数');
 const head = text('rev-parse', '--verify', 'HEAD^{commit}');
 if (!/^[0-9a-f]{40}$/.test(head)) throw Error('仅支持 SHA-1 仓库');
 const vault = process.env.AGENT_SECRETS_DIR || path.join(os.homedir(), '.agent-secrets');
 const file = path.join(vault, 'accounts.json');
 if (!options.call && process.platform === 'win32') {
 try {
 const user = os.userInfo().username;
 execFileSync('icacls', [file, '/reset'], { stdio: 'ignore' });
 execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:R`, '/grant', '*S-1-5-18:F', '/grant', '*S-1-5-32-544:F'], { stdio: 'ignore' });
 } catch { throw Error('Windows ACL 无法收紧，拒绝读取凭据库'); }
 }
 const token = options.call ? 'offline-test' : JSON.parse(fs.readFileSync(file, 'utf8'))?.platforms?.github?.accounts?.[owner]?.token;
 if (!token) throw Error('账号未配置');
 const base = `https://api.github.com/repos/${owner}/${repoName}`;
 const refPath = branch.split('/').map(encodeURIComponent).join('/');
 const getRef = () => request('GET', `${base}/git/ref/heads/${refPath}`, null, token);
 const ref = await getRef();
 const remote = ref.body?.object?.sha;
 if (ref.status !==200 || !/^[0-9a-f]{40}$/.test(remote || '')) throw Error(`读取 ref失败 HTTP ${ref.status}`);
 try { git('merge-base', '--is-ancestor', remote, head); } catch { throw Error('远端不是本地 HEAD 的祖先，拒绝推送'); }
 if (remote === head) { console.log('远端已是本地 HEAD'); return; }
 const commits = text('rev-list', '--reverse', '--topo-order', `${remote}..${head}`).split('\n').map(sha => ({ sha, ...parseCommit(sha) }));
 const trees = new Map(), blobs = new Map();
 for (const c of commits) collectTree(c.tree, trees, blobs);
 console.log(`commits: ${commits.length}, trees: ${trees.size}, blobs: ${blobs.size}`);
 if (dry) { console.log('dry-run：未写入远端，实际写入仍需校验 SHA'); return; }
 async function create(kind, expected, body) {
 const r = await request('POST', `${base}/git/${kind}`, body, token);
 if (r.status !==201 || r.body?.sha !== expected) throw Error(`${kind} 创建失败或 SHA 不一致 (HTTP ${r.status})`);
 }
 for (const [sha, blob] of blobs) await create('blobs', sha, { content: blob.toString('base64'), encoding: 'base64' });
 for (const [sha, tree] of trees) await create('trees', sha, { tree });
 for (const { sha, ...commit } of commits) await create('commits', sha, commit);
 const patch = await request('PATCH', `${base}/git/refs/heads/${refPath}`, { sha: head, force: false }, token);
 if (patch.status !==200 || patch.body?.object?.sha !== head) throw Error(`ref 更新失败 HTTP ${patch.status}`);
 const verified = await getRef();
 if (verified.body?.object?.sha !== head) throw Error('ref 回读校验失败');
 console.log(`pushed ${owner}/${repoName}: ${remote.slice(0,7)} -> ${head.slice(0,7)}`);
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode =1; });
module.exports = { main };
