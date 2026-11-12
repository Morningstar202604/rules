'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { main } = require('../scripts/gh-api-push');

function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-offline-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-config'), GIT_TERMINAL_PROMPT: '0' } }).trim();
 git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
 const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
 const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
 return { root, git, write, commit };
}
function mock(f, remote, opt = {}) {
 let current = remote; const calls = [];
 const hash = (type, content) => execFileSync('git', ['-C', f.root, 'hash-object', '-t', type, '--stdin'], { input: content, encoding: 'utf8' }).trim();
 const identity = (kind, p) => `${kind} ${p.name} <${p.email}> ${Date.parse(p.date) /1000} ${p.date.slice(-6).replace(':', '')}\n`;
 const request = async (method, url, body) => {
 calls.push({ method, url, body });
 if (opt.network) throw Error('mock network failure');
 if (method === 'GET') return opt.status ? { status: opt.status, body: {} } : { status:200, body: { object: { sha: current } } };
 if (method === 'PATCH') {
 if (opt.changed) return { status:422, body: {} };
 current = body.sha;
 return { status:200, body: { object: { sha: current } } };
 }
 let sha;
 if (url.endsWith('/blobs')) sha = hash('blob', Buffer.from(body.content, 'base64'));
 else if (url.endsWith('/trees')) {
 const input = body.tree.map(e => `${e.mode} ${e.type} ${e.sha}\t${e.path}\n`).join('');
 sha = execFileSync('git', ['-C', f.root, 'mktree'], { input, encoding: 'utf8' }).trim();
 } else {
 const raw = `tree ${body.tree}\n${body.parents.map(p => `parent ${p}\n`).join('')}${identity('author', body.author)}${identity('committer', body.committer)}\n${body.message}`;
 sha = hash('commit', raw);
 }
 return { status:201, body: { sha: opt.badSha ? '0'.repeat(40) : sha } };
 };
 return { calls, run: () => main({ root: f.root, args: ['test', '--branch', 'main'], call: request }) };
}
test('reconstructs multi-commit merge, deletion and executable mode exactly', async t => {
 const f = fixture(t); f.write('old', 'old'); const base = f.commit('base');
 f.git('checkout', '-qb', 'side'); f.write('side', 'side'); f.commit('side');
 f.git('checkout', '-q', '-'); f.git('rm', '-q', 'old'); f.write('run', 'script'); f.git('add', 'run'); f.git('update-index', '--chmod=+x', 'run'); f.git('commit', '-qm', 'delete and mode');
 f.git('merge', '--no-ff', '-qm', 'merge', 'side'); const head = f.git('rev-parse', 'HEAD');
 const m = mock(f, base); await m.run();
 assert.equal(m.calls.filter(c => c.url.endsWith('/commits')).length,3);
 assert.ok(m.calls.some(c => c.body?.tree?.some(e => e.path === 'run' && e.mode === '100755')));
 assert.equal(m.calls.filter(c => c.url.endsWith('/commits')).at(-1).body.tree, f.git('rev-parse', `${head}^{tree}`));
 const patch = m.calls.filter(c => c.method === 'PATCH');
 assert.equal(patch.length,1);
 assert.equal(patch[0].body.sha, head);
 assert.equal(patch[0].body.force, false);
});
test('refuses divergence, changed ref, API failure and object SHA mismatch', async t => {
 const f = fixture(t); f.write('a', 'a'); const base = f.commit('base'); f.write('b', 'b'); const head = f.commit('next');
 for (const [remote, options, pattern] of [[head, { status:401 }, /HTTP\s+401/], [head, { network: true }, /mock network failure/], [base, { changed: head }, /ref 更新失败 HTTP 422/], [base, { badSha: true }, /SHA 不一致/]]) {
 const m = mock(f, remote, options); await assert.rejects(m.run(), pattern);
 if (options.badSha || options.status || options.network) assert.ok(!m.calls.some(c => c.method === 'PATCH'));
 if (options.changed) assert.equal(m.calls.filter(c => c.method === 'PATCH').length,1);
 }
 f.git('checkout', '-qb', 'other', base); f.write('c', 'c'); const other = f.commit('other'); f.git('checkout', '-q', '-');
 const m = mock(f, other); await assert.rejects(m.run(), /不是本地 HEAD 的祖先/); assert.ok(!m.calls.some(c => c.method === 'POST'));
});

 test('upload script classifies auth and network errors and rejects external repositories', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-shell-'));
 t.after(() => fs.rmSync(root, { recursive:true, force:true }));
 const scripts = path.join(root, 'scripts'), bin = path.join(root, 'bin'), vault = path.join(root, 'vault');
 for (const dir of [scripts, bin, vault]) fs.mkdirSync(dir);
 fs.copyFileSync(path.join(__dirname, '../scripts/upload_all.sh'), path.join(scripts, 'upload_all.sh'));
 fs.writeFileSync(path.join(scripts, 'git-askpass.sh'), '#!/bin/sh\nexit 1\n');
 fs.chmodSync(path.join(scripts, 'git-askpass.sh'), 0o755);
 const fakeGit = path.join(bin, 'git');
 fs.writeFileSync(fakeGit, '#!/bin/sh\ncase " $* " in *" push "*) printf "%s\\n" "$MOCK_PUSH" >&2; exit 1;; *" status "*) exit 0;; *) exit 0;; esac\n', { mode:0o755 });
 fs.chmodSync(fakeGit, 0o755);
 execFileSync('git', ['init', '-q'], { cwd: root });
 const platforms = { gitcode:{ accounts:{ badhope:{} } }, gitee:{ accounts:{ badhope:{} } }, github:{ accounts:{ X33834:{}, Morningstar202604:{}, badhope:{} } } };
 fs.writeFileSync(path.join(vault, 'accounts.json'), JSON.stringify({ platforms }));
 const pathValue = [bin, bin.replaceAll('\\', '/'), process.env.PATH].join(path.delimiter === ';' ? ';' : ':');
 const run = (args, error) => spawnSync('bash', [path.join(scripts, 'upload_all.sh'), ...args], { encoding:'utf8', timeout:30000, env:{ ...process.env, PATH:pathValue, GIT_BIN:fakeGit.replaceAll('\\', '/'), AGENT_SECRETS_DIR:vault, UPLOAD_SLEEP:'0', UPLOAD_BACKOFF:'0', UPLOAD_API_FALLBACK:'0', MOCK_PUSH:error } });
 const external = run([os.tmpdir()], ''); assert.notEqual(external.status,0); assert.match(external.stderr, /拒绝上传外部仓库/);
 const auth = run([], 'fatal: Authentication failed'); assert.notEqual(auth.status,0); assert.match(auth.stderr, /认证、权限或分叉/);
 const network = run([], 'fatal: unable to access URL: Failed to connect\nerror: failed to push some refs'); assert.notEqual(network.status,0); assert.match(network.stderr, /push.*失败/); assert.doesNotMatch(network.stderr, /认证、权限或分叉|非明确网络错误/);
 const unknown = run([], 'fatal: unexpected failure'); assert.notEqual(unknown.status,0); assert.match(unknown.stderr, /非明确网络错误/);
});
