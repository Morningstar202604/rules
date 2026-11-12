'use strict';

const fs = require('node:fs');
const path = require('node:path');
const m = require('./lib/memory.js');
const { classifyTarget } = require('./lib/guards.js');

const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.cs', '.rb', '.php', '.lua', '.sh', '.ps1', '.sql', '.css', '.scss', '.less',
  '.wxml', '.wxss',
]);

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile',
];

const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|out|\.git|\.venv|venv|__pycache__|\.next|target|coverage|\.zcode|\.aqg|\.workbuddy)([\\/]|$)/i;

function findManifest(startDir, stopDir) {
  let dir = startDir;
  const stop = path.resolve(stopDir);
  for (let i = 0; i < 10; i += 1) {
    for (const name of MANIFESTS) {
      if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    }
    const parent = path.dirname(dir);
    if (parent === dir || path.resolve(dir) === stop) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const input = payload.tool_input || payload.toolInput || {};
  const target = input.file_path || input.path || input.notebook_path || '';
  if (!target) return;

  const kind = classifyTarget(target);
  if (kind) {
    m.emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: [
          `【密钥保护】检测到对${kind}的写操作：${target}`,
          '规则：凭据、令牌、私钥原则上不由 AI 读取或改写，也不得复制进对话产物。',
          '此钩子仅作提示，不代表用户授权或宿主许可；须遵守实际权限和用户要求。',
        ].join('\n'),
      },
    });
    return;
  }

  const cwd = payload.cwd || process.cwd();
  const abs = path.resolve(cwd, String(target));
  if (abs.startsWith(path.resolve(m.MEMORY_DIR) + path.sep)) return;
  if (SKIP_PATH.test(abs)) return;

  const root = path.resolve(cwd);
  const rulesHome = path.resolve(m.RULES_HOME);
  const isUnder = (base, p) => p === base || p.startsWith(base + path.sep);
  const allowedOutside = isUnder(rulesHome, abs);
  const inside = isUnder(root, abs);
  //额外提示豁免目录不构成授权；Windows 用 ; 分隔，其他平台用 :。
  const extraRoots = String(process.env.AGENT_ALLOWED_ROOTS || '')
    .split(process.platform === 'win32' ? ';' : ':')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
  const extraAllowed = extraRoots.some((d) => isUnder(d, abs));
  if (!inside && !allowedOutside && !extraAllowed) {
    // 唯一例外：系统级安装位置（包管理器/工具链只能装在那里）。
    const SYSTEM_DIRS = [
      process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
      process.env.APPDATA, '/usr', '/opt', '/etc',
    ].filter(Boolean).map((p) => path.resolve(p));
    const systemAllowed = SYSTEM_DIRS.some((d) => isUnder(d, abs)) && /(^|[\\/])(node_modules|bin|lib|share)([\\/]|$)/i.test(abs);

    if (!systemAllowed) {
      m.emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: [
            `【工作区提示 · 外部写入】目标在工作区外：${abs}`,
            `当前工作区：${root}`,
            '默认把产物放在工作区内（可在里面自由建多级目录），同名冲突就改名。',
            '若确实需要写到工作区外（系统安装、工具强制路径、C 盘配置等），此提示不阻断，但不授予权限；须遵守宿主权限及用户要求，并在交付里说明写了什么、为什么不能放工作区。',
          ].join('\n'),
        },
      });
      return;
    }
    m.emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: [
          `【系统安装位置】${abs}`,
          '此钩子仅提示，不代表系统安装必要或已获授权；遵守实际权限，并在交付里说明外部写入原因。',
        ].join('\n'),
      },
    });
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  const looksCode = CODE_EXT.has(ext) || (payload.tool_name || payload.toolName) === 'ApplyPatch';
  const manifest = looksCode ? findManifest(path.dirname(abs), cwd) : null;

  m.updateState(cwd, (state) => {
    const next = { ...state, memoryDirtyAt: new Date().toISOString() };
    if (manifest) {
      next.needsVerify = true;
      next.lastVerifyOk = false;
      next.verifyProject = path.relative(cwd, path.dirname(manifest)) || '.';
      next.changedFiles = [...new Set([...(state.changedFiles || []), path.relative(cwd, abs)])].slice(-20);
    }
    return next;
  });
}

main().catch(() => {});
