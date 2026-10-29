'use strict';

// 长任务心跳：检测「干了很久但没更新记忆文件」，提醒落检查点。
// 挂在 PostToolUse，只在确实需要时提示一次（冷却期内不重复），避免刷屏。

const fs = require('node:fs');
const path = require('node:path');
const m = require('./lib/memory.js');

// 每 N 次工具调用检查一次，避免每次工具调用都读文件
const CHECK_EVERY = 15;
// 距上次记忆更新超过该时长则提醒（毫秒）
const STALE_MS = 25 * 60 * 1000;
// 提醒冷却（毫秒）
const COOLDOWN_MS = 45 * 60 * 1000;

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await m.readStdin()) || '{}');
  } catch {
    return;
  }
  const cwd = payload.cwd || process.cwd();
  const state = m.readState(cwd);

  const n = (state.toolCalls || 0) + 1;
  if (n % CHECK_EVERY !== 0) {
    m.writeState(cwd, { ...state, toolCalls: n });
    return;
  }

  const now = Date.now();
  const lastNudge = state.checkpointNudgedAt ? Date.parse(state.checkpointNudgedAt) : 0;
  if (lastNudge && now - lastNudge < COOLDOWN_MS) {
    m.writeState(cwd, { ...state, toolCalls: n });
    return;
  }

  const file = m.memoryPathFor(cwd);
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    mtime = 0;
  }

  const stale = !mtime || now - mtime > STALE_MS;
  if (!stale) {
    m.writeState(cwd, { ...state, toolCalls: n });
    return;
  }

  m.writeState(cwd, { ...state, toolCalls: n, checkpointNudgedAt: new Date().toISOString() });
  m.emit({
    additionalContext: [
      '【长任务心跳】已经做了一段时间，但记忆文件没有更新。',
      `文件：${file}`,
      '现在花 30 秒写一次「## 当前状态」：当前切片、上一步结果、下一步。',
      '目的是中断或上下文压缩后能从这里接着跑，而不是重新摸索。',
    ].join('\n'),
  });
}

main().catch(() => {});
