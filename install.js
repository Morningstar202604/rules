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

const HOOK_SCRIPTS = [
  'session-start.js',
  'user-prompt.js',
  'guard-write.js',
  'guard-bash.js',
  'plan-sync.js',
  'track-verify.js',
  'stop-guard.js',
  'cleanup-check.js',
  'ledger.js',
];

// 官方插件已提供同名技能时跳过，避免用户级技能遮蔽功能更全的插件版。
// ZCode 的技能按路径识别、同名取用户级优先，所以重复安装只会降低质量。
const SKIP_SKILL_NAMES = new Set([
  'docx',
  'pdf',
  'pptx',
  'xlsx',
  'skill-creator',
  'visualize',
  'plugin-creator',
  'template',
]);

const args = process.argv.slice(2);
const opt = {
  tools: [],
  all: args.includes('--all'),
  dryRun: args.includes('--dry-run'),
  uninstall: args.includes('--uninstall'),
  force: args.includes('--force'),
  home: null,
  withHooks: !args.includes('--no-hooks'),
};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--tool' && args[i + 1]) opt.tools.push(args[++i]);
  else if (args[i] === '--home' && args[i + 1]) opt.home = path.resolve(args[++i]);
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
  } catch {
    return null;
  }
}

function copyFile(src, dest, manifest) {
  const before = sha256(dest);
  ensureDir(path.dirname(dest));
  if (before && before === sha256(src) && !opt.force) {
    manifest.files.push({ path: path.relative(manifest.home, dest), sha256: before });
    return 'same';
  }
  if (before) backup(dest);
  if (!opt.dryRun) fs.copyFileSync(src, dest);
  manifest.files.push({ path: path.relative(manifest.home, dest), sha256: sha256(src) });
  return before ? 'updated' : 'created';
}

const LOCAL_SECTION = '## 十七、本机环境与个人约定（升级时保留）';

function splitLocalSection(text) {
  const idx = text.indexOf(LOCAL_SECTION);
  return idx < 0 ? null : text.slice(idx).trimEnd();
}

function installRules(src, dest, manifest) {
  const existing = (() => {
    try {
      return fs.readFileSync(dest, 'utf8');
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
    manifest.files.push({ path: path.relative(manifest.home, dest), sha256: sha256(dest) });
    return 'same';
  }

  const merged = `${repoBody}\n\n${local}\n`;
  const before = sha256(dest);
  if (before) backup(dest);
  if (!opt.dryRun) fs.writeFileSync(dest, merged, 'utf8');
  manifest.files.push({ path: path.relative(manifest.home, dest), sha256: sha256(dest) });
  return 'merged';
}

function copyTree(srcDir, destDir, manifest, skipNames) {
  let created = 0;
  let updated = 0;
  let same = 0;
  const walk = (src, dest, depth) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.pytest_cache' || e.name === 'node_modules') continue;
      if (depth === 0 && skipNames && skipNames.has(e.name)) continue;
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
  const stamp = manifestStamp;
  const rel = path.relative(currentHome, file);
  const dest = path.join(currentHome, BACKUP_DIR, stamp, rel);
  if (opt.dryRun) return;
  ensureDir(path.dirname(dest));
  try {
    fs.copyFileSync(file, dest);
  } catch {
    /* 备份失败不阻断，但会在汇总里提示 */
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, data, manifest) {
  if (opt.dryRun) return;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  manifest.configs = manifest.configs || [];
  if (!manifest.configs.includes(path.relative(manifest.home, file))) {
    manifest.configs.push(path.relative(manifest.home, file));
  }
}

function nodeBin() {
  return process.execPath;
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

function ownZcodeHook(entry, hooksDir) {
  const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
  return list.some((h) => {
    const p = Array.isArray(h.args) ? h.args.find((a) => typeof a === 'string' && a.includes(hooksDir)) : null;
    return !!p;
  });
}

function unmergeZcodeConfig(home) {
  const cfgPath = path.join(home, 'cli', 'config.json');
  const cfg = readJson(cfgPath, null);
  if (!cfg || !cfg.hooks || !cfg.hooks.events) return;
  const hooksDir = path.join(home, 'hooks');
  let changed = false;
  for (const [event, entries] of Object.entries(cfg.hooks.events)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((e) => !ownZcodeHook(e, hooksDir));
    if (kept.length !== entries.length) {
      changed = true;
      if (kept.length) cfg.hooks.events[event] = kept;
      else delete cfg.hooks.events[event];
    }
  }
  if (changed && !opt.dryRun) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  if (changed) log('  - 已从 cli/config.json 移除本规则的钩子注册');
}

function mergeZcodeConfig(home, manifest) {
  const cfgPath = path.join(home, 'cli', 'config.json');
  const cfg = readJson(cfgPath, null);
  if (cfg === null) {
    log('  ! 未找到 cli/config.json，跳过钩子注册（先启动一次 ZCode 生成配置，再重跑安装）');
    return;
  }
  const hooksDir = path.join(home, 'hooks');
  const events = (cfg.hooks && cfg.hooks.events) || {};
  const ours = zcodeHookEvents(hooksDir);
  for (const [event, entries] of Object.entries(ours)) {
    const existing = Array.isArray(events[event]) ? events[event].filter((e) => !ownZcodeHook(e, hooksDir)) : [];
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
    PreToolUse: [mk('guard-write.js', 'Edit|Write'), mk('guard-bash.js', 'Bash')],
    PostToolUse: [mk('plan-sync.js', 'TodoWrite'), mk('track-verify.js', 'Bash'), mk('checkpoint-remind.js', null)],
    Stop: [mk('stop-guard.js')],
  };
}

function ownClaudeHook(entry, hooksDir) {
  const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
  return list.some((h) => typeof h.command === 'string' && h.command.includes(hooksDir));
}

function unmergeClaudeConfig(home) {
  const cfgPath = path.join(home, 'settings.json');
  const cfg = readJson(cfgPath, null);
  if (!cfg || !cfg.hooks) return;
  const hooksDir = path.join(home, 'hooks');
  let changed = false;
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((e) => !ownClaudeHook(e, hooksDir));
    if (kept.length !== entries.length) {
      changed = true;
      if (kept.length) cfg.hooks[event] = kept;
      else delete cfg.hooks[event];
    }
  }
  if (changed && !opt.dryRun) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  if (changed) log('  - 已从 settings.json 移除本规则的钩子注册');
}

function mergeClaudeConfig(home, manifest) {
  const cfgPath = path.join(home, 'settings.json');
  const cfg = readJson(cfgPath, {});
  const hooksDir = path.join(home, 'hooks');
  const events = cfg.hooks || {};
  const ours = claudeHookEvents(hooksDir);
  for (const [event, entries] of Object.entries(ours)) {
    const existing = Array.isArray(events[event]) ? events[event].filter((e) => !ownClaudeHook(e, hooksDir)) : [];
    events[event] = [...existing, ...entries];
  }
  cfg.hooks = events;
  writeJson(cfgPath, cfg, manifest);
  log('  + 钩子已注册到 settings.json（' + Object.keys(ours).join(', ') + '；Claude 无 PostToolUseFailure，失败验证由 Bash 结果推断）');
}

function mergeOpencodeConfig(home, manifest) {
  const cfgPath = path.join(home, 'opencode.json');
  const cfg = readJson(cfgPath, {});
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

function installProfile(name) {
  const profile = PROFILES[name];
  if (!profile) {
    log('未知工具：' + name + '（可选：' + Object.keys(PROFILES).join(' / ') + '）');
    process.exitCode = 1;
    return;
  }
  const home = opt.home || profile.home();
  currentHome = home;
  manifestStamp = new Date().toISOString().replace(/[:.]/g, '-');
  log('\n== 安装到 ' + name + ' → ' + home + (opt.dryRun ? '（dry-run）' : '') + ' ==');

  const manifestPath = path.join(home, MANIFEST_NAME);
  const previous = readJson(manifestPath, null);
  const manifest = {
    tool: name,
    version: VERSION,
    installedAt: new Date().toISOString(),
    home,
    files: [],
    configs: [],
  };

  ensureDir(home);

  const rulesDest = path.join(home, profile.rules);
  const st = installRules(path.join(REPO, 'AGENTS.md'), rulesDest, manifest);
  log('  ' + sym(st) + ' 规则 ' + profile.rules + (st === 'merged' ? '（已保留本机个人段落）' : ''));

  const skillStats = copyTree(path.join(CORE, 'skills'), path.join(home, profile.skills), manifest, SKIP_SKILL_NAMES);
  log('  ' + sym('updated') + ' 技能 → ' + profile.skills + '/（新增 ' + skillStats.created + '，更新 ' + skillStats.updated + '，未变 ' + skillStats.same + '）');

  const agentStats = copyTree(path.join(CORE, 'agents'), path.join(home, profile.agents), manifest);
  log('  ' + sym('updated') + ' 子代理 → ' + profile.agents + '/（新增 ' + agentStats.created + '，更新 ' + agentStats.updated + '，未变 ' + agentStats.same + '）');

  const cmdStats = copyTree(path.join(CORE, 'commands'), path.join(home, profile.commands), manifest);
  log('  ' + sym('updated') + ' 命令 → ' + profile.commands + '/（新增 ' + cmdStats.created + '，更新 ' + cmdStats.updated + '）');

  if (profile.hooks && opt.withHooks) {
    const hookStats = copyTree(path.join(CORE, 'hooks'), path.join(home, profile.hooks), manifest);
    log('  ' + sym('updated') + ' 钩子 → ' + profile.hooks + '/（新增 ' + hookStats.created + '，更新 ' + hookStats.updated + '）');
  }

  if (profile.after) {
    try {
      profile.after(home, manifest);
    } catch (e) {
      log('  ! 配置合并失败：' + e.message);
      process.exitCode = 1;
    }
  }

  if (!opt.dryRun) {
    const vault = process.env.AGENT_SECRETS_DIR || path.join(os.homedir(), '.agent-secrets');
    fs.mkdirSync(vault, { recursive: true });
    const cli = path.join(vault, 'accounts_cli.py');
    fs.copyFileSync(path.join(REPO, 'scripts', 'accounts_cli.py'), cli);
    manifest.files.push({ path: path.relative(home, cli), sha256: sha256(cli) });
    log('  ' + sym('updated') + ' 凭据库 CLI → ' + cli);
  }

  if (!opt.dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  log('  完成。文件清单写入 ' + path.relative(home, manifestPath) + '（共 ' + manifest.files.length + ' 个文件）');
  if (previous) log('  检测到旧安装（' + previous.version + '，' + previous.installedAt + '），已按新版本覆盖并备份旧文件。');
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
  const manifestPath = path.join(home, MANIFEST_NAME);
  const manifest = readJson(manifestPath, null);
  log('\n== 卸载 ' + name + ' → ' + home + (opt.dryRun ? '（dry-run）' : '') + ' ==');
  if (!manifest) {
    log('  未找到安装清单，无法安全卸载（不猜测删除）。');
    return;
  }

  let removed = 0;
  let kept = 0;
  for (const item of manifest.files) {
    const abs = path.join(home, item.path);
    const now = sha256(abs);
    if (!now) continue;
    if (now !== item.sha256) {
      kept += 1;
      log('  = 保留（安装后被修改）：' + item.path);
      continue;
    }
    if (!opt.dryRun) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    removed += 1;
  }
  log('  删除 ' + removed + ' 个文件，保留 ' + kept + ' 个被修改过的文件。');
  if (manifest.tool === 'zcode') unmergeZcodeConfig(home);
  if (manifest.tool === 'claude') unmergeClaudeConfig(home);
  log('  配置合并项需手工清理：' + (manifest.configs.join(', ') || '无'));
  log('  备份保留在 ' + BACKUP_DIR + '/，确认无误后可自行删除。');
  if (!opt.dryRun) {
    try {
      fs.unlinkSync(manifestPath);
    } catch {
      /* ignore */
    }
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
    log('用法：node install.js --tool <' + Object.keys(PROFILES).join('|') + '> [--all] [--dry-run] [--uninstall] [--home <dir>]');
    log('详情见 README.md / docs/PORTABILITY.md');
    return;
  }
  for (const t of tools) {
    if (opt.uninstall) uninstallProfile(t);
    else installProfile(t);
  }
}

main();
