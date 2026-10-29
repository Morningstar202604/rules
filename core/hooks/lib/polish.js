'use strict';

// 每轮注入保持短小：完整规则在 AGENTS.md §九，这里只做提醒。
// 旧版把整段规则 + 最多 4000 字原请求回贴进上下文，每轮多出上千 token，
// 对长会话是纯负担；模型本来就能看到用户原话，无需重复。
const MAX_PROMPT = 600;

// 新任务首轮才提示意图识别：同一任务内不重复，避免每轮堆积。
const INTENT_HINT_MIN_LEN = 12;
const TRIVIAL_RE = /^(继续|对|好|好的|行|可以|嗯|停|暂停|不用了|算了|取消|结束)[\s。！!，,。；;]*$/;

function shouldSkip(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 2) return true;
  if (t.startsWith('/') || t.startsWith('!')) return true;
  if (/^\[(Request interrupted|Tool use|系统|system)/i.test(t)) return true;
  return false;
}

// 是否是「需要识别意图」的实质任务输入
function needsIntentRecognition(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < INTENT_HINT_MIN_LEN) return false;
  if (TRIVIAL_RE.test(t)) return false;
  if (t.startsWith('/') || t.startsWith('!')) return false;
  if (/^\[(Request interrupted|Tool use|系统|system)/i.test(t)) return false;
  if (/^(继续|接着|然后呢|下一步)[\s。！!]*$/.test(t)) return false;
  return true;
}

function build(prompt, opts = {}) {
  if (shouldSkip(prompt)) return '';
  const shown = prompt.length > MAX_PROMPT ? prompt.slice(0, MAX_PROMPT) + '\u2026' : prompt;
  const lines = [
    '【提示词润色】按 AGENTS.md §九：回复开头给「原始请求 → 润色后 + 假设」块；已足够精确则写一行「原请求已专业，无需改写」。',
    '自动化契约：不询问、不用 AskUserQuestion；需要选方向时列 5 个候选对比后自选并执行。',
    `原始请求摘要（完整原文见用户消息）：${shown}`,
  ];
  if (opts.intent && needsIntentRecognition(prompt)) {
    lines.push('【意图识别】新任务：先按 skill `intent-recognition` 产出四层识别（真实目标 / 项目定位 / 硬约束 / 验收定义 + 假设），再动手。');
  }
  return lines.join('\n');
}

module.exports = { build, shouldSkip, needsIntentRecognition };

