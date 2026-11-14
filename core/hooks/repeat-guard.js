'use strict';

// 重复调用提醒：同一 tool_name + 规范化 tool_input 连续出现 3/5/8 次时升级提示。
// 只注入 additionalContext，绝不返回 permissionDecision 或阻断调用。

const crypto = require('node:crypto');
const m = require('./lib/memory.js');

const MAX_STRING = 160;
const MAX_ARRAY = 12;
const MAX_KEYS = 40;
const MAX_DEPTH = 6;
const MAX_EVENTS = 24;
const MAX_NOTICES_PER_SIGNATURE = 3;
const MAX_NOTICES_PER_TURN = 6;
const COOLDOWN_MS = 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;

function normalizeValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((item) => normalizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY) head.push(`…+${value.length - MAX_ARRAY}`);
    return head;
  }
  const keys = Object.keys(value).sort();
  const out = {};
  for (const key of keys.slice(0, MAX_KEYS)) out[key] = normalizeValue(value[key], depth + 1);
  if (keys.length > MAX_KEYS) out['…'] = `+${keys.length - MAX_KEYS}`;
  return out;
}

function signatureOf(toolName, input) {
  const canonical = JSON.stringify([String(toolName || ''), normalizeValue(input || {})]);
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

function levelFor(count) {
  if (count >= 8) return 3;
  if (count >= 5) return 2;
  if (count >= 3) return 1;
  return 0;
}

// 只回显简短标量，长字符串（文件内容、密钥）一律只报长度，避免把敏感数据写进上下文。
function previewOf(input) {
  if (!input || typeof input !== 'object') return '';
  const parts = [];
  for (const key of Object.keys(input).sort().slice(0, 6)) {
    const value = input[key];
    if (typeof value === 'string') {
      parts.push(value.length > 60 ? `${key}=<${value.length} chars>` : `${key}=${value.length > 40 ? `${value.slice(0, 40)}…` : value}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${value}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}[${value.length}]`);
    } else if (value && typeof value === 'object') {
      parts.push(`${key}{${Object.keys(value).length}}`);
    }
  }
  return parts.join(' ');
}

function summaryOf(toolName, input) {
  const preview = previewOf(input);
  return `工具 ${toolName || '(unknown)'}${preview ? `，参数 ${preview}` : ''}`;
}

function buildMessage(level, count, toolName, input) {
  const head =
    level >= 3
      ? `【连续重复 · 强提示 · 建议停止汇报】同一调用已连续 ${count} 次`
      : level === 2
        ? `【连续重复 · 强提示】同一调用已连续 ${count} 次`
        : `【重复调用提醒】同一调用已连续 ${count} 次`;
  const lines = [head, summaryOf(toolName, input)];
  if (level >= 3) {
    lines.push(
      '建议立即停止本轮重复尝试，向用户汇报：已经尝试了什么、卡在哪里、还需要什么信息或授权。',
    );
  } else if (level === 2) {
    lines.push(
      '停止机械重试：先检查输入是否有误、环境是否变化、是否卡在权限/网络/空结果，必要时换一种做法或向用户说明。',
    );
  } else {
    lines.push('如果上一次结果不符合预期，先定位失败原因或更换做法，不要盲目重试。');
  }
  lines.push('本提示只用于提醒，不阻断调用，也不代表用户授权。');
  return lines.join('\n');
}

// 同一签名最多通知 3 次：3/5/8 每个等级只提示一次，保证第 8 次的停止建议不会被前两级重复消耗。
// 60 秒冷却用于抑制同一/更低等级在短时间内的重复提示；升级提示不受冷却影响。
function decideNotice(notices, signature, level, nowMs) {
  const prior = notices.filter((n) => n && n.signature === signature);
  if (prior.length >= MAX_NOTICES_PER_SIGNATURE) return false;
  if (prior.some((n) => Number(n.level) === level)) return false;
  const lastAt = prior.reduce((latest, n) => Math.max(latest, Date.parse(n.at) || 0), 0);
  const maxLevel = prior.reduce((max, n) => Math.max(max, Number(n.level) || 0), 0);
  if (lastAt && nowMs - lastAt < COOLDOWN_MS && level <= maxLevel) return false;
  return true;
}

function nextState(current, toolName, signature, nowMs) {
  // 回合键优先用 turnStartedAt（user-prompt 每轮重写）；缺失时退回 sessionId。
  // 键变化即重置；另外距上次调用超过 30 分钟也算断档，避免旧状态跨会话累计。
  const turnKey = current.turnStartedAt || current.sessionId || '';
  const previous = current.repeatGuard && typeof current.repeatGuard === 'object' ? current.repeatGuard : {};
  const lastEventMs = previous.lastAt ? Date.parse(previous.lastAt) || 0 : 0;
  const fresh = !lastEventMs || nowMs - lastEventMs <= SESSION_GAP_MS;
  const sameTurn = fresh && (previous.turnKey || '') === turnKey;
  const signatureMatched = sameTurn && previous.signature === signature;
  const count = sameTurn ? (signatureMatched ? (Number(previous.count) || 0) + 1 : 1) : 1;
  const notices = sameTurn && Array.isArray(previous.notices)
    ? previous.notices.slice(-MAX_NOTICES_PER_TURN)
    : [];
  const events = sameTurn && Array.isArray(previous.events)
    ? previous.events.slice(-MAX_EVENTS)
    : [];
  const at = new Date(nowMs).toISOString();
  const level = levelFor(count);

  let notify = false;
  if (level > 0 && notices.length < MAX_NOTICES_PER_TURN && decideNotice(notices, signature, level, nowMs)) {
    notices.push({ signature, level, at });
    notify = true;
  }
  events.push({ at, signature, tool: String(toolName).slice(0, 40), count });

  return {
    notify,
    level,
    count,
    next: {
      turnKey,
      signature,
      count,
      lastAt: at,
      events: events.slice(-MAX_EVENTS),
      notices: notices.slice(-MAX_NOTICES_PER_TURN),
    },
  };
}

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const toolName = payload.tool_name || payload.toolName || '';
  if (!toolName) return;
  const input = payload.tool_input || payload.toolInput || {};
  const cwd = payload.cwd || process.cwd();
  const signature = signatureOf(toolName, input);
  const nowMs = Date.now();

  let result = null;
  m.updateState(cwd, (current) => {
    result = nextState(current, toolName, signature, nowMs);
    return { ...current, repeatGuard: result.next };
  });

  if (!result || !result.notify) return;
  m.emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: buildMessage(result.level, result.count, toolName, input),
    },
  });
}

if (require.main === module) main().catch(() => {});

module.exports = {
  normalizeValue,
  signatureOf,
  levelFor,
  decideNotice,
  nextState,
  MAX_STRING,
  MAX_ARRAY,
  MAX_EVENTS,
  MAX_NOTICES_PER_SIGNATURE,
  MAX_NOTICES_PER_TURN,
  COOLDOWN_MS,
  SESSION_GAP_MS,
};
