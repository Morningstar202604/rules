'use strict';

const path = require('node:path');
const m = require('./lib/memory.js');
const polish = require('./lib/polish.js');
const recall = require('./lib/recall.js');
const router = require('./lib/router.js');

const RULES_HOME = path.resolve(__dirname, '..');

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const cwd = payload.cwd || process.cwd();
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';

  // 新任务判定：距上个实质任务输入超过 30 分钟，或本会话尚未提示过意图识别。
  const stateBefore = m.readState(cwd);
  const lastAt = stateBefore.lastIntentAt ? Date.parse(stateBefore.lastIntentAt) : 0;
  const gapMs = lastAt ? Date.now() - lastAt : Infinity;
  const isNewTask = polish.needsIntentRecognition(prompt) && gapMs > 30 * 60 * 1000;

  recall.markTurnStart(cwd, payload, prompt);

  const parts = [];
  const p = polish.build(prompt, { intent: isNewTask });
  if (p) parts.push(p);

  if (isNewTask) {
    const routed = await new Promise((resolve) => router.route(RULES_HOME, prompt, (_e, out) => resolve(out)));
    if (routed) parts.push(routed);
  }

  if (prompt.trim()) {
    const r = recall.build(cwd, payload, prompt);
    if (r) parts.push(r);
  }

  if (isNewTask) {
    m.writeState(cwd, { ...m.readState(cwd), lastIntentAt: new Date().toISOString() });
  }

  if (!parts.length) return;
  m.emit({ additionalContext: parts.join('\n\n') });
}

main().catch(() => {});
