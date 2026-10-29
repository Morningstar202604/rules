'use strict';

const m = require('./memory.js');

const RECALL_HINT = /回顾|回顾一下|上下文|继续(做|干|上次)?|接着|上次|之前(的|说到)|进度|做到哪|恢复|刚才|前面(说|提)|现在到哪|下一步/;
const STOP_INTENT = /^\s*(?:停|停止|停下|暂停|先停|算了|到此为止|不用了|不再做|取消|结束|够了|先这样|改天再|明天再|我自己来)[\s。！!，,。；;]*$/;

function statePathOf(cwd) {
  return m.statePathFor(cwd);
}

function markTurnStart(cwd, payload, prompt) {
  const state = m.readState(cwd);
  m.writeState(cwd, {
    ...state,
    stopRounds: 0,
    memNudge: false,
    cleanupNudged: false,
    turnStartedAt: new Date().toISOString(),
    skipGuard: STOP_INTENT.test(prompt),
    sessionId: payload.session_id || state.sessionId || null,
  });
}

// 每轮注入只保留「文件路径 + 未完成项数 + 台账摘要」三行；
// 标题索引只在回顾类请求时才给，避免每轮重复占上下文。
// 「当前状态」只抽 3 行（下一步 / 当前切片 / 上一步结果），长任务断点恢复靠它。
function extractCurrentState(body) {
  // JS 不支持 \Z：用 (?=^##\s|$) 收尾；m 模式下 $ 匹配行尾。
  const m = body.match(/^##\s*当前状态\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^[-*]\s*(下一步|当前切片|上一步结果)\s*[:：]\s*(.+)$/);
    if (kv && kv[2].trim()) out.push(`${kv[1]}：${kv[2].trim().slice(0, 120)}`);
  }
  return out.slice(0, 3);
}

function build(cwd, payload, prompt) {
  const file = m.memoryPathFor(cwd);
  const body = m.readText(file);
  const state = m.readState(cwd);

  const open = Array.isArray(state.openTodos) ? state.openTodos.filter(Boolean) : [];
  const procs = Array.isArray(state.runningProcs) ? state.runningProcs : [];
  const phase = state.projectPhase || 'active';

  const lines = [
    `【上下文记忆】${file}`,
    `阶段=${phase}；未完成任务=${open.length}；台账进程=${procs.length}。`,
  ];
  if (open.length) lines.push(`未完成：${open.slice(0, 5).map((t, i) => `${i + 1}) ${t}`).join('；')}`);

  const cur = body.trim() ? extractCurrentState(body) : [];
  if (cur.length) lines.push(`断点：${cur.join(' | ')}`);

  if (!body.trim()) lines.push('该文件尚未建立：本轮给出计划时先创建并写入目标、约束、计划、决策与验证结论。');

  if (RECALL_HINT.test(prompt) && body.trim()) {
    const index = m.headingIndex(body);
    lines.push('本轮为上下文回顾：先读该文件，按下述索引跳读；禁止重扫代码库、禁止复述历史对话全文。');
    if (index.length) lines.push(...index);
  }

  lines.push('纪律：事实以记忆文件为准；发现不符先更新文件；不贴大段代码或日志。');
  return lines.join('\n');
}

module.exports = { build, markTurnStart, RECALL_HINT, STOP_INTENT };
