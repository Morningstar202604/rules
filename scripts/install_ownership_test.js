'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const configuredBase = process.env.AWC_TEST_ROOT;
const base = configuredBase && path.isAbsolute(configuredBase)
 ? configuredBase
 : fs.mkdtempSync(path.join(os.tmpdir(), 'awc-install-tests-'));
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'install-test-'));
const env = { ...process.env, HOME: root, USERPROFILE: root, AGENT_SECRETS_DIR: path.join(root, 'vault'), TEMP: root, TMP: root };
function run(tool, home, ...flags) {
 const r = spawnSync(process.execPath, [path.join(repo, 'install.js'), '--tool', tool, '--home', home, ...flags], { env, encoding: 'utf8' });
 assert.equal(r.status,0, r.stdout + r.stderr);
 return r;
}
function runFail(tool, home, ...flags) {
 const r = spawnSync(process.execPath, [path.join(repo, 'install.js'), '--tool', tool, '--home', home, ...flags], { env, encoding: 'utf8' });
 assert.notEqual(r.status,0, r.stdout + r.stderr);
 return r;
}
function json(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
try {
 for (const tool of ['zcode', 'claude']) {
 const home = path.join(root, tool), hooks = path.join(home, 'hooks');
 const config = tool === 'zcode' ? path.join(home, 'cli', 'config.json') : path.join(home, 'settings.json');
 fs.mkdirSync(path.dirname(config), { recursive: true });
 const user = tool === 'zcode' ? { type: 'process', command: process.execPath, args: [path.join(hooks, 'custom.js')] } : { type: 'command', command: `node "${path.join(hooks, 'custom.js')}"` };
 const events = { SessionStart: [{ matcher: 'custom', hooks: [user] }] };
 fs.writeFileSync(config, JSON.stringify(tool === 'zcode' ? { hooks: { events } } : { hooks: events }));
 const existing = path.join(home, 'AGENTS.md');
 const rule = tool === 'claude' ? path.join(home, 'CLAUDE.md') : existing;
 fs.copyFileSync(path.join(repo, 'AGENTS.md'), rule);
 run(tool, home); run(tool, home);
 const installed = json(config); const get = c => tool === 'zcode' ? c.hooks.events : c.hooks;
 assert.deepEqual(get(installed).SessionStart[0].hooks[0], user);
 const manifest = json(path.join(home, '.agent-work-contract.json'));
 assert.equal(manifest.files.find(x => x.path === path.basename(rule)).owned, false);
 assert.equal(manifest.files.find(x => x.path === path.join('hooks', 'session-start.js')).owned, true);
 run(tool, home, '--uninstall');
 assert.ok(fs.existsSync(rule));
 assert.ok(!fs.existsSync(path.join(hooks, 'session-start.js')));
 assert.deepEqual(get(json(config)).SessionStart[0].hooks[0], user);
 }
 const home = path.join(root, 'legacy');
 run('generic', home);
 const file = path.join(home, '.agent-work-contract.json');
 const manifest = json(file); for (const item of manifest.files) delete item.owned;
 fs.writeFileSync(file, JSON.stringify(manifest));
 run('generic', home); run('generic', home, '--uninstall');
 assert.ok(fs.existsSync(path.join(home, 'AGENTS.md')));
 const zhome = path.join(root, 'node-change');
 const zconfig = path.join(zhome, 'cli', 'config.json');
 fs.mkdirSync(path.dirname(zconfig), { recursive: true });
 fs.writeFileSync(zconfig, '{}');
 run('zcode', zhome);
 const zcfg = json(zconfig);
 for (const entries of Object.values(zcfg.hooks.events)) {
 for (const entry of entries) for (const hook of entry.hooks) hook.command = path.join(root, 'old-runtime', process.platform === 'win32' ? 'node.exe' : 'node');
 }
 fs.writeFileSync(zconfig, JSON.stringify(zcfg));
 run('zcode', zhome);
 assert.equal(json(zconfig).hooks.events.SessionStart.length,1);
 run('zcode', zhome, '--uninstall');
 assert.equal(json(zconfig).hooks.events.SessionStart, undefined);

 for (const tool of ['zcode', 'claude']) {
 const noHooksHome = path.join(root, 'no-hooks-' + tool);
 const noHooksConfig = tool === 'zcode' ? path.join(noHooksHome, 'cli', 'config.json') : path.join(noHooksHome, 'settings.json');
 fs.mkdirSync(path.dirname(noHooksConfig), { recursive: true });
 fs.writeFileSync(noHooksConfig, '{}');
 run(tool, noHooksHome);
 const getEvents = c => tool === 'zcode' ? c.hooks.events : c.hooks;
 const config = json(noHooksConfig);
 const own = getEvents(config).SessionStart[0];
 const user = tool === 'zcode' ? { type: 'process', command: process.execPath, args: [path.join(noHooksHome, 'hooks', 'custom.js')] } : { type: 'command', command: 'custom' };
 own.hooks.push(user);
 fs.writeFileSync(noHooksConfig, JSON.stringify(config));
 const alternativeHome = process.platform === 'win32' ? noHooksHome.toUpperCase() : noHooksHome;
 run(tool, alternativeHome, '--no-hooks', '--dry-run');
 assert.equal(getEvents(json(noHooksConfig)).SessionStart[0].hooks.length,2);
 run(tool, alternativeHome, '--no-hooks');
 assert.deepEqual(getEvents(json(noHooksConfig)).SessionStart[0].hooks, [user]);
 assert.ok(!fs.existsSync(path.join(noHooksHome, 'hooks', 'session-start.js')));
 run(tool, noHooksHome);
 run(tool, alternativeHome, '--uninstall');
 assert.deepEqual(getEvents(json(noHooksConfig)).SessionStart[0].hooks, [user]);
 }

 const vault = env.AGENT_SECRETS_DIR;
 const credential = path.join(vault, 'accounts_cli.py');
 fs.writeFileSync(credential, 'old credential cli');
 const outside = path.join(root, 'backup-outside');
 fs.mkdirSync(outside);
 const backupDir = path.join(vault, '.agent-work-contract-backup');
 fs.rmSync(backupDir, { recursive: true, force: true });
 fs.symlinkSync(outside, backupDir, process.platform === 'win32' ? 'junction' : 'dir');
 runFail('generic', path.join(root, 'blocked-backup'));
 assert.equal(fs.readFileSync(credential, 'utf8'), 'old credential cli');
 assert.deepEqual(fs.readdirSync(outside), []);
 fs.unlinkSync(backupDir);
 const clock = path.join(root, 'clock.js');
 fs.writeFileSync(clock, "const D = Date; global.Date = class extends D { constructor(...args) { super(...(args.length ? args : ['2020-01-01T00:00:00.000Z'])); } };\n");
 const stampDir = path.join(backupDir, '2020-01-01T00-00-00-000Z');
 fs.mkdirSync(stampDir, { recursive: true });
 const victim = path.join(root, 'victim');
 fs.writeFileSync(victim, 'do not overwrite');
 fs.linkSync(victim, path.join(stampDir, 'accounts_cli.py'));
 const result = spawnSync(process.execPath, ['--require', clock, path.join(repo, 'install.js'), '--tool', 'generic', '--home', path.join(root, 'blocked-hardlink')], { env, encoding: 'utf8' });
 assert.notEqual(result.status,0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(victim, 'utf8'), 'do not overwrite');
 assert.equal(fs.readFileSync(credential, 'utf8'), 'old credential cli');
 fs.rmSync(backupDir, { recursive: true, force: true });

 const shared = path.join(root, 'shared');
 run('generic', shared);
 assert.ok(fs.existsSync(path.join(shared, 'skills', 'visualize', 'SKILL.md')));
 const before = fs.readFileSync(path.join(shared, '.agent-work-contract.json'), 'utf8');
 runFail('codex', shared);
 assert.equal(fs.readFileSync(path.join(shared, '.agent-work-contract.json'), 'utf8'), before);

 const staleHome = path.join(root, 'stale');
 run('generic', staleHome);
 const staleManifestPath = path.join(staleHome, '.agent-work-contract.json');
 const staleManifest = json(staleManifestPath);
 const stale = staleManifest.files.find(x => x.owned === true && x.path.startsWith('skills' + path.sep));
 assert.ok(stale);
 const oldPath = path.join(staleHome, 'old-owned-file');
 fs.copyFileSync(path.join(staleHome, stale.path), oldPath);
 staleManifest.files.push({ path: 'old-owned-file', sha256: stale.sha256, owned: true });
 fs.writeFileSync(path.join(staleHome, 'unknown-user-file'), 'user');
 fs.writeFileSync(staleManifestPath, JSON.stringify(staleManifest));
 run('generic', staleHome);
 assert.ok(!fs.existsSync(oldPath));
 assert.equal(fs.readFileSync(path.join(staleHome, 'unknown-user-file'), 'utf8'), 'user');
 console.log('install ownership tests passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
