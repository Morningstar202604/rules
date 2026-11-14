#!/usr/bin/env node
'use strict';

/**
 * agent-work-contract installer
 *
 * 用法：
 *   node install.js --tool zcode            # 安装到 ~/.zcode
 *   node install.js --tool claude           # 安装到 ~/.claude
 *   node install.js --tool opencode         # 安装到 ~/.config/opencode
 *   node install.js --tool codex            # 安装到 ~/.codex
 *   node install.js --tool generic --home D:/rules
 *   node install.js --all                   # 已检测到的工具全部安装
 *   node install.js --tool zcode --profile dev  # 只装开发相关技能/代理
 *   node install.js --tool zcode --dry-run  # 只打印将做什么
 *   node install.js --tool zcode --uninstall
 *
 * 设计约束：
 *   - 幂等：重复执行结果一致；覆盖前先备份到 <目标>/.agent-work-contract-backup/<时间戳>/
 *   - 可逆：--uninstall 只删「哈希与安装时一致」的文件，用户改过的一律保留
 *   - 只改本工具自己的条目：配置合并以绝对路径识别，不碰用户已有钩子
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const REPO = __dirname;
const CORE = path.join(REPO, 'core');
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const MANIFEST_NAME = '.agent-work-contract.json';
const BACKUP_DIR = '.agent-work-contract-backup';

function normalizeFsPath(value) {
 if (process.platform === 'win32' && /^\/[A-Za-z]\//.test(value)) {
 return value[1].toUpperCase() + ':\\' + value.slice(3).replaceAll('/', '\\');
 }
 return value;
}

function sameFsPath(left, right) {
 const a = path.resolve(normalizeFsPath(left));
 const b = path.resolve(normalizeFsPath(right));
 return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}


const HOOK_SCRIPTS = [
  'session-start.js',
  'user-prompt.js',
  'guard-write.js',
  'guard-bash.js',
  'repeat-guard.js',
  'plan-sync.js',
  'track-verify.js',
  'stop-guard.js',
  'cleanup-check.js',
  'ledger.js',
];

// A cached plugin is not proof that it is enabled. Until an active official
// installation can be verified for a host, install the bundled skills.
function skillSkipNames(name, home, profile) {
  if (profile === 'dev') return devSkillSkipNames();
  return new Set();
}

// 开发版：只装编程与工程流程相关的技能/代理，避免全行业工具箱淹没开发场景。
const DEV_SKILLS = new Set([
  'agent-designer', 'agent-router', 'agent-work-contract',
  'api-design-reviewer', 'aqg-code-construction', 'aqg-evidence-closeout', 'aqg-startup-preflight',
  'archify', 'audit', 'cache-economy', 'change-integrity', 'ci-cd-pipeline-builder',
  'code-review', 'decision-log', 'deep-security-scan', 'security-audit',
  'discernment-nudge', 'docker', 'env-secrets-manager', 'executing-plans',
  'finishing-a-development-branch', 'frontend-app-builder',
  'frontend-design', 'frontend-testing-debugging', 'git-workflow',
  'incremental-refactor', 'intent-recognition', 'long-run-execution', 'master-checklist',
  'mcp-builder', 'observability-designer', 'performance-profiler', 'postgresql-table-design',
  'plan-and-execute',
  'process-and-artifact-ledger', 'project-lifecycle', 'python', 'quality-gate-checklist',
  'react-best-practices', 'repo-cartography', 'repo-hygiene',
  'rust', 'security-scan', 'senior-architect', 'session-handoff', 'shadcn', 'ship-gate',
  'skill-author', 'skill-router', 'spec-driven-workflow',
  'sql-database-assistant', 'supabase', 'systematic-debugging', 'task-slicing',
  'tdd-guide', 'testing', 'toolchain-playbook', 'typescript', 'ui-ux-accessibility',
  'verification-before-completion', 'web-search', 'writing-plans',
]);

const DEV_AGENT_PREFIXES = ['core-', 'software-', 'fullstack-'];
const DEV_AGENT_EXTRA = new Set(['data-sql-expert', 'data-python-engineer']);

function devSkillSkipNames() {
  const dir = path.join(CORE, 'skills');
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !DEV_SKILLS.has(e.name))
      .map((e) => e.name)
  );
}

function isDevAgentFile(fileName) {
  if (!fileName.endsWith('.md')) return true;
  const base = fileName.slice(0, -3);
  return DEV_AGENT_EXTRA.has(base) || DEV_AGENT_PREFIXES.some((p) => base.startsWith(p));
}

const args = process.argv.slice(2);
const opt = {
  tools: [],
  all: args.includes('--all'),
  dryRun: args.includes('--dry-run'),
  uninstall: args.includes('--uninstall'),
  force: args.includes('--force'),
  home: null,
  profile: 'full',
  withHooks: !args.includes('--no-hooks'),
};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--tool' && args[i + 1]) opt.tools.push(args[++i]);
  else if (args[i] === '--home' && args[i + 1]) opt.home = path.resolve(normalizeFsPath(args[++i]));
  else if (args[i] === '--profile' && args[i + 1]) opt.profile = args[++i];
}
if (!['full', 'dev'].includes(opt.profile)) {
  console.error('未知 profile：' + opt.profile + '（可选：full / dev）');
  process.exit(1);
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function ensureDir(dir) {
  if (!opt.dryRun) fs.mkdirSync(dir, { recursive: true });
}

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error('无法读取文件：' + file + '（' + e.message + '）');
  }
}

function isContained(root, target) {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  return targetAbs === rootAbs || targetAbs.startsWith(rootAbs + path.sep);
}

function isSymlink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

function hasMultipleLinks(file) {
  try { return fs.lstatSync(file).nlink > 1; } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

function assertNoSymlinkPath(target) {
  let current = path.resolve(target);
  while (true) {
    if (isSymlink(current)) throw new Error('拒绝使用符号链接路径：' + target);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertContained(root, target, options = {}) {
  const abs = path.resolve(target);
  if (!isContained(root, abs)) throw new Error('路径超出安装目录，已停止操作：' + target);
  if (options.existing && (isSymlink(abs) || hasMultipleLinks(abs))) {
    throw new Error('拒绝覆盖链接文件：' + target);
  }
  let parent = path.dirname(abs);
  const rootAbs = path.resolve(root);
  while (isContained(rootAbs, parent) && parent !== rootAbs) {
    if (isSymlink(parent)) throw new Error('拒绝写入符号链接目录：' + parent);
    parent = path.dirname(parent);
  }
  return abs;
}

function recordMutation(file, existed) {
  if (!transaction) return;
  const abs = assertContained(transaction.home, file);
  if (!transaction.touched.has(abs)) transaction.touched.set(abs, { existed, backup: null });
}

function recordExternalCreate(file) {
  if (transaction) transaction.externalCreated.add(path.resolve(file));
}

function recordFile(manifest, abs, hash, written, before) {
 const rel = path.relative(manifest.home, abs);
 const prior = manifest.previousFiles.get(rel);
 // Legacy manifests do not establish whether an identical file was created by us.
 const owned = (written && !before) || (prior && prior.owned === true && prior.sha256 === before);
 manifest.files.push({ path: rel, sha256: hash, owned: Boolean(owned) });
}

function copyFile(src, dest, manifest) {
  const abs = assertContained(currentHome, dest, { existing: true });
  const before = sha256(abs);
  ensureDir(path.dirname(abs));
  if (before && before === sha256(src) && !opt.force) {
    recordFile(manifest, abs, before, false, before);
    return 'same';
  }
  if (before) backup(abs);
  else recordMutation(abs, false);
  if (!opt.dryRun) fs.copyFileSync(src, abs);
  recordFile(manifest, abs, sha256(abs), true, before);
  return before ? 'updated' : 'created';
}


const LOCAL_SECTION = '## 十七、本机环境与个人约定（升级时保留）';

function splitLocalSection(text) {
  const idx = text.indexOf(LOCAL_SECTION);
  return idx < 0 ? null : text.slice(idx).trimEnd();
}

function installRules(src, dest, manifest) {
  const destAbs = assertContained(currentHome, dest, { existing: true });
  const existing = (() => {
    try {
      return fs.readFileSync(destAbs, 'utf8');
    } catch {
      return '';
    }
  })();
  const local = splitLocalSection(existing);
  if (!local) return copyFile(src, dest, manifest);

  const normalized = existing.replace(/\r\n/g, '\n');
  const head = normalized.split(LOCAL_SECTION)[0].trimEnd();
  const repoBody = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const currentBody = head.replace(/^<!-- agent-work-contract v[\d.]+ -->\n\n/, '').trimEnd();
  if (repoBody === currentBody) {
    recordFile(manifest, destAbs, sha256(destAbs), false, sha256(destAbs));
    return 'same';
  }

  const merged = `${repoBody}\n\n${local}\n`;
  const abs = assertContained(currentHome, dest, { existing: true });
  const before = sha256(abs);
  if (before) backup(abs);
  if (!opt.dryRun) atomicWriteText(abs, merged);
  recordFile(manifest, abs, sha256(abs), true, before);
  return 'merged';
}

function copyTree(srcDir, destDir, manifest, skipNames, filter) {
  let created = 0;
  let updated = 0;
  let same = 0;
  const walk = (src, dest, depth) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.pytest_cache' || e.name === 'node_modules') continue;
      if (depth === 0 && skipNames && skipNames.has(e.name)) continue;
      if (depth === 0 && filter && !filter(e.name)) continue;
      const s = path.join(src, e.name);
      const d = path.join(dest, e.name);
      if (e.isDirectory()) walk(s, d, depth + 1);
      else if (e.isFile()) {
        const r = copyFile(s, d, manifest);
        if (r === 'created') created += 1;
        else if (r === 'updated') updated += 1;
        else same += 1;
      }
    }
  };
  walk(srcDir, destDir, 0);
  return { created, updated, same };
}

function backup(file) {
  const abs = assertContained(currentHome, file, { existing: true });
  const stamp = manifestStamp;
  const rel = path.relative(currentHome, abs);
  const dest = path.join(currentHome, BACKUP_DIR, stamp, rel);
  assertNoSymlinkPath(dest);
  if (transaction) {
    const state = transaction.touched.get(abs) || { existed: true, backup: null };
    state.existed = true;
    state.backup = dest;
    transaction.touched.set(abs, state);
  }
  if (opt.dryRun) return true;
  ensureDir(path.dirname(dest));
  try {
    fs.copyFileSync(abs, dest);
    return true;
  } catch (e) {
    throw new Error('备份失败，已停止覆盖：' + abs + '（' + e.message + '）');
  }
}

function readJson(file, fallback, options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (options.object && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('根节点必须是 JSON 对象');
    }
    return parsed;
  } catch (e) {
    if (options.strict && fs.existsSync(file)) {
      throw new Error('JSON 配置损坏，已停止覆盖：' + file + '（' + e.message + '）');
    }
    return fallback;
  }
}

function atomicWriteText(abs, text) {
  ensureDir(path.dirname(abs));
  const tmp = path.join(path.dirname(abs), '.' + path.basename(abs) + '.' + manifestStamp + '.tmp');
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, abs);
  } catch (e) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore cleanup failure */ }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    throw new Error('原子写入失败：' + abs + '（' + e.message + '）');
  }
}

function atomicWriteJson(abs, data) {
  atomicWriteText(abs, JSON.stringify(data, null, 2) + '\n');
  const written = readJson(abs, null, { strict: true, object: true });
  if (!written) throw new Error('配置写入后校验失败：' + abs);
}

function writeJson(file, data, manifest) {
  if (opt.dryRun) return;
  const abs = assertContained(currentHome, file, { existing: true });
  if (manifest) {
    manifest.configs = manifest.configs || [];
    const rel = path.relative(manifest.home, abs);
    if (!manifest.configs.includes(rel)) manifest.configs.push(rel);
  }
  if (fs.existsSync(abs)) backup(abs);
  else recordMutation(abs, false);
  atomicWriteJson(abs, data);
}


function writeManifest(file, data) {
  if (opt.dryRun) return;
  const abs = assertContained(currentHome, file, { existing: true });
  if (fs.existsSync(abs)) backup(abs);
  else recordMutation(abs, false);
  atomicWriteJson(abs, data);
}

function nodeBin() {
 return process.execPath;
}

function isNodeExecutable(command) {
 if (typeof command !== 'string') return false;
 const actual = path.basename(normalizeFsPath(command.trim().replace(/^\"|\"$/g, ''))).toLowerCase();
 return actual === 'node' || actual === 'node.exe';
}

function zcodeHookEvents(hooksDir) {
  const mk = (script, statusMessage, extra = {}) => ({
    hooks: [
      {
        type: 'process',
        command: nodeBin(),
        args: [path.join(hooksDir, script)],
        timeoutMs: 8000,
        ...(statusMessage ? { statusMessage } : {}),
      },
    ],
    ...extra,
  });
  return {
    SessionStart: [mk('session-start.js', '加载上下文记忆')],
    UserPromptSubmit: [mk('user-prompt.js', '润色 + 定位上下文')],
    PreToolUse: [
      mk('guard-write.js', '校验敏感路径与改动登记', { matcher: 'Edit|Write|ApplyPatch' }),
      mk('guard-bash.js', '危险命令与密钥校验', { matcher: 'Bash' }),
      mk('repeat-guard.js', '连续重复调用提醒'),
    ],
    PostToolUse: [
      mk('plan-sync.js', '同步计划到记忆文件', { matcher: 'TodoWrite' }),
      mk('track-verify.js', null, { matcher: 'Bash' }),
      mk('checkpoint-remind.js', '长任务检查点提醒'),
    ],
    PostToolUseFailure: [mk('track-verify.js', '记录失败验证', { matcher: 'Bash' })],
    Stop: [mk('stop-guard.js', '完成度校验')],
  };
}

function ownHookScript(script, hooksDir) {
  if (typeof script !== 'string') return false;
  const abs = path.resolve(normalizeFsPath(script));
  return HOOK_SCRIPTS.concat(['checkpoint-remind.js']).some((name) => sameFsPath(abs, path.resolve(hooksDir, name)));
}

function ownZcodeHook(entry, hooksDir) {
  const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
  return list.some((h) => {
    if (!h || h.type !== 'process' || !isNodeExecutable(h.command) || !Array.isArray(h.args)) return false;
    return h.args.length ===1 && ownHookScript(h.args[0], hooksDir);
  });
}

function removeOwnHooks(entries, hooksDir, predicate) {
 return entries.flatMap((entry) => {
 if (!entry || !Array.isArray(entry.hooks)) return [entry];
 const hooks = entry.hooks.filter((hook) => !predicate({ hooks: [hook] }, hooksDir));
 if (hooks.length === entry.hooks.length) return [entry];
 return hooks.length ? [{ ...entry, hooks }] : [];
 });
}

function unmergeZcodeConfig(home, manifest) {
  const cfgPath = path.join(home, 'cli', 'config.json');
  const cfg = readJson(cfgPath, null, { strict: true, object: true });
  if (!cfg || !cfg.hooks || !cfg.hooks.events) return;
  const hooksDir = path.join(home, 'hooks');
  let changed = false;
  for (const [event, entries] of Object.entries(cfg.hooks.events)) {
    if (!Array.isArray(entries)) continue;
const kept = removeOwnHooks(entries, hooksDir, ownZcodeHook);
 if (JSON.stringify(kept) !== JSON.stringify(entries)) {
      changed = true;
      if (kept.length) cfg.hooks.events[event] = kept;
      else delete cfg.hooks.events[event];
    }
  }
  if (changed && !opt.dryRun) writeJson(cfgPath, cfg, manifest);
  if (changed) log('  - 已从 cli/config.json 移除本规则的钩子注册');
}

function mergeZcodeConfig(home, manifest) {
  const cfgPath = path.join(home, 'cli', 'config.json');
  const cfg = readJson(cfgPath, null, { strict: true, object: true });
  if (cfg === null) {
    log('  ! 未找到 cli/config.json，跳过钩子注册（先启动一次 ZCode 生成配置，再重跑安装）');
    return;
  }
  const hooksDir = path.join(home, 'hooks');
  const events = (cfg.hooks && cfg.hooks.events) || {};
  const ours = zcodeHookEvents(hooksDir);
  for (const [event, entries] of Object.entries(ours)) {
    const existing = Array.isArray(events[event]) ? removeOwnHooks(events[event], hooksDir, ownZcodeHook) : [];
    events[event] = [...existing, ...entries];
  }
  cfg.hooks = { ...(cfg.hooks || {}), enabled: true, maxOutputBytes: 65536, timeoutMs: 30000, events };

  // 技能清单预算是软上限：超出后 ZCode 会把所有技能降级成「名字 + 路径」，
  // 触发词全部丢失，技能等于不可用。默认值 20000 撑不住 104 个技能。
  const currentBudget = cfg.skills && Number(cfg.skills.metadataBudget);
  cfg.skills = {
    ...(cfg.skills || {}),
    enabled: true,
    includeInstructions: true,
    metadataBudget: Number.isFinite(currentBudget) && currentBudget >= 60000 ? currentBudget : 60000,
    roots: Array.isArray(cfg.skills && cfg.skills.roots) ? cfg.skills.roots : [],
  };
  cfg.toolConcurrency = { ...(cfg.toolConcurrency || {}), maxConcurrency: Math.max(Number(cfg.toolConcurrency && cfg.toolConcurrency.maxConcurrency) || 0, 16) };
  cfg.features = { compact: true, rewind: true, subagent: true, memory: true, skill: true, mcp: true, ...(cfg.features || {}) };
  cfg.memory = { use: true, ...(cfg.memory || {}) };
  // 严格检查点默认关闭：只在长任务时才值得开，见 docs/HOOKS.md。
  cfg.checkpoints = { strict: false, ...(cfg.checkpoints || {}) };

  writeJson(cfgPath, cfg, manifest);
  log('  + 钩子已注册到 cli/config.json（' + Object.keys(ours).join(', ') + '）');
  log('  + 运行时配置：技能预算 60000 字符 / 并发 16 / features 全开 / 钩子输出 64KB');
}

function claudeHookEvents(hooksDir) {
  const wrap = path.join(hooksDir, 'lib', 'claude-wrap.js');
  const mk = (script, matcher) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [
      {
        type: 'command',
        command: `"${nodeBin()}" "${wrap}" "${path.join(hooksDir, script)}"`,
      },
    ],
  });
  return {
    SessionStart: [mk('session-start.js')],
    UserPromptSubmit: [mk('user-prompt.js')],
    PreToolUse: [mk('guard-write.js', 'Edit|Write'), mk('guard-bash.js', 'Bash'), mk('repeat-guard.js')],
    PostToolUse: [mk('plan-sync.js', 'TodoWrite'), mk('track-verify.js', 'Bash'), mk('checkpoint-remind.js', null)],
    Stop: [mk('stop-guard.js')],
  };
}

function ownClaudeHook(entry, hooksDir) {
  const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
  return list.some((h) => {
    if (!h || h.type !== 'command' || typeof h.command !== 'string') return false;
    const match = h.command.match(/^"([^"]+)" "([^"]+)" "([^"]+)"$/);
 return !!match && isNodeExecutable(match[1]) &&
 sameFsPath(match[2], path.resolve(hooksDir, 'lib', 'claude-wrap.js')) &&
 ownHookScript(match[3], hooksDir);
  });
}

function unmergeClaudeConfig(home, manifest) {
  const cfgPath = path.join(home, 'settings.json');
  const cfg = readJson(cfgPath, null, { strict: true, object: true });
  if (!cfg || !cfg.hooks) return;
  const hooksDir = path.join(home, 'hooks');
  let changed = false;
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    if (!Array.isArray(entries)) continue;
const kept = removeOwnHooks(entries, hooksDir, ownClaudeHook);
 if (JSON.stringify(kept) !== JSON.stringify(entries)) {
      changed = true;
      if (kept.length) cfg.hooks[event] = kept;
      else delete cfg.hooks[event];
    }
  }
  if (changed && !opt.dryRun) writeJson(cfgPath, cfg, manifest);
  if (changed) log('  - 已从 settings.json 移除本规则的钩子注册');
}

function mergeClaudeConfig(home, manifest) {
  const cfgPath = path.join(home, 'settings.json');
  const cfg = readJson(cfgPath, {}, { strict: true, object: true });
  const hooksDir = path.join(home, 'hooks');
  const events = cfg.hooks || {};
  const ours = claudeHookEvents(hooksDir);
  for (const [event, entries] of Object.entries(ours)) {
    const existing = Array.isArray(events[event]) ? removeOwnHooks(events[event], hooksDir, ownClaudeHook) : [];
    events[event] = [...existing, ...entries];
  }
  cfg.hooks = events;
  writeJson(cfgPath, cfg, manifest);
  log('  + 钩子已注册到 settings.json（' + Object.keys(ours).join(', ') + '；Claude 无 PostToolUseFailure，失败验证由 Bash 结果推断）');
}

function mergeOpencodeConfig(home, manifest) {
  const cfgPath = path.join(home, 'opencode.json');
  const cfg = readJson(cfgPath, {}, { strict: true });
  const instructions = Array.isArray(cfg.instructions) ? cfg.instructions : [];
  const agentsFile = path.join(home, 'AGENTS.md');
  if (!instructions.includes(agentsFile)) instructions.push(agentsFile);
  cfg.instructions = instructions;
  const skillsDir = path.join(home, 'skills');
  const skills = Array.isArray(cfg.skills) ? cfg.skills : [];
  if (!skills.includes(skillsDir)) skills.push(skillsDir);
  cfg.skills = skills;
  writeJson(cfgPath, cfg, manifest);
  log('  + opencode.json 已登记 instructions 与 skills 目录');
}

const PROFILES = {
  zcode: {
    detect: () => fs.existsSync(path.join(os.homedir(), '.zcode')),
    home: () => path.join(os.homedir(), '.zcode'),
    rules: 'AGENTS.md',
    skills: 'skills',
    agents: 'agents',
    commands: 'commands',
    hooks: 'hooks',
    after: mergeZcodeConfig,
  },
  claude: {
    detect: () => fs.existsSync(path.join(os.homedir(), '.claude')),
    home: () => path.join(os.homedir(), '.claude'),
    rules: 'CLAUDE.md',
    skills: 'skills',
    agents: 'agents',
    commands: 'commands',
    hooks: 'hooks',
    after: mergeClaudeConfig,
  },
  opencode: {
    detect: () => fs.existsSync(path.join(os.homedir(), '.config', 'opencode')),
    home: () => path.join(os.homedir(), '.config', 'opencode'),
    rules: 'AGENTS.md',
    skills: 'skills',
    agents: 'agents',
    commands: 'commands',
    hooks: null,
    after: mergeOpencodeConfig,
  },
  codex: {
    detect: () => fs.existsSync(path.join(os.homedir(), '.codex')),
    home: () => path.join(os.homedir(), '.codex'),
    rules: 'AGENTS.md',
    skills: 'skills',
    agents: 'agents',
    commands: 'commands',
    hooks: null,
    after: null,
  },
  generic: {
    detect: () => false,
    home: () => path.join(os.homedir(), '.agent-rules'),
    rules: 'AGENTS.md',
    skills: 'skills',
    agents: 'agents',
    commands: 'commands',
    hooks: null,
    after: null,
  },
};

let currentHome = null;
let manifestStamp = '';
let transaction = null;

function trackExternalMutation(file, existed) {
  if (!transaction) return;
  const abs = path.resolve(file);
  if (!transaction.external.has(abs)) transaction.external.set(abs, { existed, backup: null });
}

function rollbackTransaction() {
  if (!transaction || opt.dryRun) return;
  for (const [file, state] of transaction.external) {
    try {
      if (state.existed && state.backup) fs.copyFileSync(state.backup, file);
      else if (!state.existed && fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      log('  ! 外部文件回滚失败：' + file + '（' + e.message + '）');
    }
  }
  for (const [file, state] of [...transaction.touched].reverse()) {
    try {
      if (state.existed && state.backup) fs.copyFileSync(state.backup, file);
      else if (!state.existed && fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      log('  ! 安装文件回滚失败：' + file + '（' + e.message + '）');
    }
  }
}

function validateManifest(manifest, home) {
  if (!manifest || !Array.isArray(manifest.files)) throw new Error('安装清单损坏，拒绝卸载');
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split(/[\\\\/]/).includes('..')) {
      throw new Error('安装清单包含越界路径，拒绝卸载');
    }
    assertContained(home, path.join(home, item.path));
    if (typeof item.sha256 !== 'string' || !item.sha256) throw new Error('安装清单缺少文件哈希，拒绝卸载');
  }
}

function preflightProfile(name, profile, home) {
  const config = name === 'zcode' ? path.join(home, 'cli', 'config.json')
    : name === 'claude' ? path.join(home, 'settings.json')
      : name === 'opencode' ? path.join(home, 'opencode.json') : null;
  if (config && fs.existsSync(config)) readJson(assertContained(home, config, { existing: true }), {}, { strict: true, object: true });
}

function installCredentialCli() {
  const vault = path.resolve(normalizeFsPath(process.env.AGENT_SECRETS_DIR || path.join(os.homedir(), '.agent-secrets')));
  assertNoSymlinkPath(vault);
  const cli = path.join(vault, 'accounts_cli.py');
  assertNoSymlinkPath(cli);
  const src = path.join(REPO, 'scripts', 'accounts_cli.py');
  ensureDir(vault);
  const before = sha256(cli);
  if (before && hasMultipleLinks(cli)) throw new Error('拒绝覆盖凭据库硬链接：' + cli);
  const sourceHash = sha256(src);
  if (before && before === sourceHash) {
    log('  = 保留已一致的凭据库 CLI → ' + cli);
    return;
  }
  trackExternalMutation(cli, Boolean(before));
  const state = transaction && transaction.external.get(path.resolve(cli));
  if (before) {
 const backupPath = path.join(vault, BACKUP_DIR, manifestStamp, 'accounts_cli.py');
 assertNoSymlinkPath(backupPath);
 if (hasMultipleLinks(backupPath)) throw new Error('拒绝覆盖凭据备份硬链接：' + backupPath);
 if (!opt.dryRun) {
 ensureDir(path.dirname(backupPath));
 fs.copyFileSync(cli, backupPath);
      if (state) state.backup = backupPath;
    }
    log('  ~ 已备份旧凭据库 CLI → ' + backupPath);
  }
  if (!opt.dryRun) {
    fs.copyFileSync(src, cli);
    try { fs.chmodSync(cli, 0o600); } catch { /* Windows ACL 由用户权限继承 */ }
  }
  log('  ' + (before ? '~' : '+') + ' 凭据库 CLI → ' + cli);
}

function installProfile(name) {
  const profile = PROFILES[name];
  if (!profile) {
    log('未知工具：' + name + '（可选：' + Object.keys(PROFILES).join(' / ') + '）');
    process.exitCode = 1;
    return;
  }
  const home = opt.home || profile.home();
  assertNoSymlinkPath(home);
  currentHome = home;
  manifestStamp = new Date().toISOString().replace(/[:.]/g, '-');
  log('\n== 安装到 ' + name + ' → ' + home + (opt.dryRun ? '（dry-run）' : '') + ' ==');

  const manifestPath = path.join(home, MANIFEST_NAME);
 const previous = readJson(manifestPath, null, { strict: true, object: true });
 const manifest = {
    tool: name,
    version: VERSION,
    installedAt: new Date().toISOString(),
    home,
    files: [],
 configs: [],
 };
 Object.defineProperty(manifest, 'previousFiles', {
 value: new Map((previous && Array.isArray(previous.files) ? previous.files : [])
 .filter((item) => item && typeof item.path === 'string')
 .map((item) => [item.path, item])),
 enumerable: false,
 });
  transaction = { home, touched: new Map(), external: new Map() };

 try {
 if (previous) {
 validateManifest(previous, home);
 if (previous.tool !== name || typeof previous.home !== 'string' || !sameFsPath(previous.home, home)) {
 throw new Error('安装清单宿主或 home 不匹配，拒绝共享安装目录');
 }
 }
 preflightProfile(name, profile, home);
    ensureDir(home);

    const rulesDest = path.join(home, profile.rules);
    const st = installRules(path.join(REPO, 'AGENTS.md'), rulesDest, manifest);
    log('  ' + sym(st) + ' 规则 ' + profile.rules + (st === 'merged' ? '（已保留本机个人段落）' : ''));

    const skillStats = copyTree(path.join(CORE, 'skills'), path.join(home, profile.skills), manifest, skillSkipNames(name, home, opt.profile));
    log('  ' + sym('updated') + ' 技能 → ' + profile.skills + '/（新增 ' + skillStats.created + '，更新 ' + skillStats.updated + '，未变 ' + skillStats.same + '）');

    const agentStats = copyTree(
      path.join(CORE, 'agents'),
      path.join(home, profile.agents),
      manifest,
      undefined,
      (fileName) => opt.profile !== 'dev' || isDevAgentFile(fileName)
    );
    log('  ' + sym('updated') + ' 子代理 → ' + profile.agents + '/（新增 ' + agentStats.created + '，更新 ' + agentStats.updated + '，未变 ' + agentStats.same + '）');

    const cmdStats = copyTree(path.join(CORE, 'commands'), path.join(home, profile.commands), manifest);
    log('  ' + sym('updated') + ' 命令 → ' + profile.commands + '/（新增 ' + cmdStats.created + '，更新 ' + cmdStats.updated + '）');

    if (profile.hooks && opt.withHooks) {
      const hookStats = copyTree(path.join(CORE, 'hooks'), path.join(home, profile.hooks), manifest);
      log('  ' + sym('updated') + ' 钩子 → ' + profile.hooks + '/（新增 ' + hookStats.created + '，更新 ' + hookStats.updated + '）');
    }

    // 共享脚本与运行时库：技能脚本依赖 core/scripts/、core/client/、core/installer/ 下的模块。
    for (const dirName of ['scripts', 'client', 'installer']) {
      const srcDir = path.join(CORE, dirName);
      if (!fs.existsSync(srcDir)) continue;
      const destDir = path.join(home, dirName);
      const stats = copyTree(srcDir, destDir, manifest);
      log('  ' + sym('updated') + ' ' + dirName + '/ → ' + dirName + '/（新增 ' + stats.created + '，更新 ' + stats.updated + '）');
    }

 if (profile.after && (opt.withHooks || name === 'opencode')) profile.after(home, manifest);
 else if (!opt.withHooks && name === 'zcode') unmergeZcodeConfig(home, manifest);
 else if (!opt.withHooks && name === 'claude') unmergeClaudeConfig(home, manifest);
 if (!opt.dryRun) installCredentialCli();

  if (previous) {
 const current = new Set(manifest.files.map((item) => item.path));
 for (const item of previous.files) {
 if (current.has(item.path)) continue;
 const abs = assertContained(home, path.join(home, item.path), { existing: true });
 const now = sha256(abs);
 if (!now) continue;
 if (item.owned === true && now === item.sha256) {
 if (!opt.dryRun) { backup(abs); fs.unlinkSync(abs); }
 log(' - 清理升级遗留文件：' + item.path);
 } else {
 log(' = 保留未知或已修改的遗留文件：' + item.path);
 manifest.files.push(item);
 }
 }
 }
 if (!opt.dryRun) writeManifest(manifestPath, manifest);
    log('  完成。文件清单写入 ' + path.relative(home, manifestPath) + '（共 ' + manifest.files.length + ' 个文件）');
    if (previous) log('  检测到旧安装（' + previous.version + '，' + previous.installedAt + '），已按新版本覆盖并备份旧文件。');
  } catch (e) {
    rollbackTransaction();
    log('  ! 安装失败，已回滚：' + e.message);
    process.exitCode = 1;
  } finally {
    transaction = null;
  }
}

function sym(status) {
  if (status === 'created') return '+';
  if (status === 'updated') return '~';
  return '=';
}

function uninstallProfile(name) {
  const profile = PROFILES[name];
  if (!profile) {
    log('未知工具：' + name);
    process.exitCode = 1;
    return;
  }
  const home = opt.home || profile.home();
  assertNoSymlinkPath(home);
  currentHome = home;
  manifestStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(home, MANIFEST_NAME);
  const manifest = readJson(manifestPath, null, { strict: true, object: true });
  log('\n== 卸载 ' + name + ' → ' + home + (opt.dryRun ? '（dry-run）' : '') + ' ==');
  if (!manifest) {
    log('  未找到安装清单，无法安全卸载（不猜测删除）。');
    return;
  }
  validateManifest(manifest, home);
  if (typeof manifest.home !== 'string' || !sameFsPath(manifest.home, home)) throw new Error('安装清单 home 不匹配，拒绝卸载');
  if (manifest.tool !== name) throw new Error('安装清单工具不匹配，拒绝卸载');

  const configPath = manifest.tool === 'zcode' ? path.join(home, 'cli', 'config.json')
    : manifest.tool === 'claude' ? path.join(home, 'settings.json') : null;
  if (configPath && fs.existsSync(configPath)) readJson(assertContained(home, configPath, { existing: true }), null, { strict: true, object: true });

  let removed = 0;
  let kept = 0;
  const removable = [];
  for (const item of manifest.files) {
    const abs = assertContained(home, path.join(home, item.path), { existing: true });
    const now = sha256(abs);
    if (!now) continue;
    if (now !== item.sha256) {
      kept += 1;
      log('  = 保留（安装后被修改）：' + item.path);
    } else if (item.owned !== true) {
      kept += 1;
      log('  = 保留（安装前已存在）：' + item.path);
    } else removable.push(abs);
  }

  transaction = { home, touched: new Map(), external: new Map() };
  try {
    if (!opt.dryRun) {
      for (const abs of removable) backup(abs);
      if (configPath && fs.existsSync(configPath)) backup(configPath);
      backup(manifestPath);
    }
    if (manifest.tool === 'zcode') unmergeZcodeConfig(home, null);
    if (manifest.tool === 'claude') unmergeClaudeConfig(home, null);
    for (const abs of removable) {
      if (!opt.dryRun) fs.unlinkSync(abs);
      removed += 1;
    }
    log('  删除 ' + removed + ' 个文件，保留 ' + kept + ' 个被修改过的文件。');
    log('  配置合并项已安全处理；备份保留在 ' + BACKUP_DIR + '/，确认无误后可自行删除。');
    if (!opt.dryRun) fs.unlinkSync(manifestPath);
  } catch (e) {
    rollbackTransaction();
    log('  ! 卸载失败，已回滚：' + e.message);
    process.exitCode = 1;
  } finally {
    transaction = null;
  }
}

function main() {
  let tools = opt.tools;
  if (opt.all) {
    tools = Object.entries(PROFILES)
      .filter(([, p]) => p.detect())
      .map(([n]) => n);
    if (!tools.length) tools = ['generic'];
  }
  if (!tools.length) {
    log('用法：node install.js --tool <' + Object.keys(PROFILES).join('|') + '> [--all] [--profile full|dev] [--dry-run] [--uninstall] [--home <dir>]');
    log('详情见 README.md / docs/PORTABILITY.md');
    return;
  }
 if (opt.home && new Set(tools).size >1) {
 throw new Error('多个宿主不能共享同一个 --home');
 }
 for (const t of tools) {
 if (opt.uninstall) uninstallProfile(t);
    else installProfile(t);
  }
}

main();
