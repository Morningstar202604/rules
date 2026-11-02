'use strict';

// 这里只保留「是否算一次新的实质任务」的判断，用于决定要不要注入可选的路由参考。
// 不再注入提示词润色、意图识别模板或固定决策流程——那些只会挤占模型的判断空间。

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

// 是否是「可能值得给一点参考」的实质任务输入
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

// 保留导出以免旧调用方报错；不再注入任何内容。
function build() {
  return '';
}

module.exports = { build, shouldSkip, needsIntentRecognition };

