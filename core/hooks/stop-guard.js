'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const m = require('./lib/memory.js');
const cleanupCheck = require('./cleanup-check.js');

const MAX_ROUNDS = 3;

// 严格检查点模式：config.json 里 `checkpoints.strict: true` 时启用。
// 默认关闭——普通问答被拦会烦人；长期跑的任务可自行打开。
const STRICT_STALE_MS = 60 * 60 * 1000;

function strictCheckpointsEnabled() {
  try {
    const cfgPath = path.join(m.RULES_HOME, 'cli', 'config.json');
    if (!fs.existsSync(cfgPath)) return false;
    let raw = fs.readFileSync(cfgPath, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const cfg = JSON.parse(raw);
    return !!(cfg.checkpoints && cfg.checkpoints.strict === true);
  } catch {
    return false;
  }
}

function portOpen(port, timeoutMs = 120) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

function persistentMatchers(state) {
  // 常驻服务白名单：某些项目本身就是「一直挂着」的服务（如 QQ 机器人三件套）。
  // 用户明确要求这类进程不得在收尾时被清掉，也不该每轮报「进程未关闭」。
  // 用 state.persistentProcs（正则字符串数组）声明，命中即从存活清单里剔除。
  const raw = Array.isArray(state.persistentProcs) ? state.persistentProcs : [];
  const out = [];
  for (const p of raw) {
    try {
      out.push(new RegExp(String(p), 'i'));
    } catch {
      /* 非法正则忽略，不能让守卫自己崩掉 */
    }
  }
  return out;
}

async function liveEntries(state) {
  const list = Array.isArray(state.runningProcs) ? state.runningProcs.filter(Boolean) : [];
  if (!list.length) return [];
  const keepPatterns = persistentMatchers(state);
  const still = [];
  for (const item of list) {
    const cmd = item && typeof item === 'object' ? String(item.command || '') : '';
    if (cmd && keepPatterns.some((re) => re.test(cmd))) continue;
    const port = item && typeof item === 'object' ? item.port : null;
    if (!port) {
      // 没有端口就无法判断死活。旧逻辑一律当作「还在跑」，于是任何一条误登记
      // （比如把 `npx vite build` 当成 dev server）都会让收尾检查永久误报。
      // 现在只保留 10 分钟内的无端口条目（给启动中的服务一个宽限），其余丢弃。
      const started = item && typeof item === 'object' ? Date.parse(item.startedAt || '') : NaN;
      if (Number.isFinite(started) && Date.now() - started < 10 * 60 * 1000) still.push(item);
      continue;
    }
    if (await portOpen(port)) still.push(item);
  }
  return still;
}

async function runGuard(payload) {
  const cwd = payload.cwd || process.cwd();
  const file = m.memoryPathFor(cwd);
  const state = m.readState(cwd);

  const liveProcs = await liveEntries(state);
  if (liveProcs.length !== (Array.isArray(state.runningProcs) ? state.runningProcs.length : 0)) {
    m.writeState(cwd, { ...state, runningProcs: liveProcs });
  }

  if (state.skipGuard) {
    if (Number(state.stopRounds || 0)) m.writeState(cwd, { ...state, stopRounds: 0 });
    if (!liveProcs.length || state.projectPhase !== 'closing') return null;
    const body = [
      '【收尾提醒 · 用户已喊停，本次不阻断】',
      `仍有 ${liveProcs.length} 个本轮启动的进程在跑：`,
      ...liveProcs.slice(0, 8).map((p) => `  · ${typeof p === 'string' ? p : p.command || p.pid || JSON.stringify(p)}`),
      '请在离开前手动关闭这些进程（只关自己启动的，不要动别人的进程）。',
    ].join('\n');
    return { additionalContext: body };
  }

  const rounds = Number(state.stopRounds || 0);
  if (rounds >= MAX_ROUNDS) {
    m.writeState(cwd, { ...state, stopRounds: 0 });
    if (!liveProcs.length || state.projectPhase !== 'closing') return null;
    const body = [
      '【收尾提醒 · 已达到阻断轮次上限，本次不阻断】',
      `仍有 ${liveProcs.length} 个本轮启动的进程在跑：`,
      ...liveProcs.slice(0, 8).map((p) => `  · ${typeof p === 'string' ? p : p.command || p.pid || JSON.stringify(p)}`),
      '请在离开前手动关闭这些进程。',
    ].join('\n');
    return { additionalContext: body };
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const dirtyAt = state.memoryDirtyAt ? Date.parse(state.memoryDirtyAt) : 0;
  const memoryStale = !!dirtyAt && mtimeMs < dirtyAt && !state.memNudge;
  const openTodos = Array.isArray(state.openTodos) ? state.openTodos.filter(Boolean) : [];
  const needsVerify = state.needsVerify === true && state.lastVerifyOk !== true;
  const phase = state.projectPhase || 'active';
  const closing = phase === 'closing';

  // 项目级收尾之前，未完成任务与未关进程都是「进行中」而不是「收尾缺陷」：
  // 每轮都要求清零会让多轮开发无法保留现场、反复重启服务。
  // 因此 active 阶段只拦「改了代码没验证」和「改动没落盘」；
  // 进程与未完成任务只在 closing / done 阶段强制清零。
  const reasons = [];
  if (closing && liveProcs.length) {
    reasons.push(
      `项目已进入收尾，但仍有 ${liveProcs.length} 个本轮启动的进程在跑：`,
      ...liveProcs.slice(0, 8).map((p) => `  · ${typeof p === 'string' ? p : p.command || p.pid || JSON.stringify(p)}`),
      '按台账逆序停止这些进程并确认端口已释放；只关自己启动的，不要动别人的进程。'
    );
  }
  if (closing && openTodos.length) {
    reasons.push(
      `项目已进入收尾，但计划里还有 ${openTodos.length} 项未完成：`,
      ...openTodos.map((t, i) => `  ${i + 1}. ${t}`),
      '直接继续做完，不要只描述下一步，也不要把剩余项推给用户。'
    );
  }
  if (needsVerify) {
    const files = Array.isArray(state.changedFiles) ? state.changedFiles.slice(-5) : [];
    if (state.lastVerifyEmpty) {
      reasons.push(
        '上次验证命令虽然退出码为 0，但没有真实执行任何测试（0 tests / 全部 skipped）。这不叫验证通过：',
        '  请检查测试文件是否被正确发现、是否有 .only/.skip 把用例排除、是否只写了恒真断言。',
        '  确认测试真的会失败（改坏被测代码应看到红），再跑一次。'
      );
    } else {
      reasons.push(
        '本轮改了代码但没跑验证，不允许说「完成」：',
        ...(files.length ? [`  改动：${files.join('、')}`] : []),
        '  先跑项目自带的验证命令（test / typecheck / lint / gate），把真实结果贴出来；没跑通过就不要收尾。'
      );
    }
  }
  if (memoryStale) {
    reasons.push(
      `本轮已有改动尚未落盘。把关键事实、决策与依据、已验证结论（命令与文件行号）、新发现的坑写入 ${file}，`,
      '并更新「当前计划」区块、「资源台账」与「待办与阻塞」。只写摘要要点，不要贴大段代码或日志。'
    );
  }

  // 严格检查点模式：长任务跑了很久但记忆文件一直没更新，且还有未完成待办。
  // 只在 active 阶段、确实有待办时生效，避免无任务的问答被误拦。
  if (!memoryStale && openTodos.length && strictCheckpointsEnabled() && mtimeMs) {
    const age = Date.now() - mtimeMs;
    if (age > STRICT_STALE_MS) {
      reasons.push(
        `严格检查点模式：记忆文件已 ${Math.round(age / 60000)} 分钟未更新，但还有 ${openTodos.length} 项待办。`,
        '先把「## 当前状态」更新为：当前切片、上一步结果、下一步，然后继续。',
        '（关闭方式：cli/config.json 里 checkpoints.strict 设为 false）'
      );
    }
  }

  if (!reasons.length) {
    if (rounds) m.writeState(cwd, { ...state, stopRounds: 0 });
    // 未进入收尾阶段时不串联 cleanup-check：中途清理会破坏现场并拖慢每一轮。
    if (!closing) return null;
    const cleanup = await cleanupCheck.runCached(payload, state);
    return cleanup || null;
  }

  m.writeState(cwd, {
    ...state,
    stopRounds: rounds + 1,
    ...(memoryStale ? { memNudge: true } : {}),
  });

  const body = ['【完成度校验 · 第 ' + (rounds + 1) + '/' + MAX_ROUNDS + ' 轮】', ...reasons].join('\n');
  return { continue: true, decision: 'block', reason: body, additionalContext: body };
}

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const guard = await runGuard(payload);
  if (guard) m.emit(guard);
}

if (require.main === module) main();

module.exports = { runGuard, strictCheckpointsEnabled };
