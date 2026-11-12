'use strict';

const m = require('./lib/memory.js');

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const cwd = payload.cwd || process.cwd();
  const source = payload.source || 'startup';
  const file = m.memoryPathFor(cwd);
  const body = m.readText(file);
  const index = body ? m.headingIndex(body) : [];

  const state = m.readState(cwd);
  m.writeState(cwd, {
    ...state,
    stopRounds: 0,
    memNudge: false,
    cleanupNudged: false,
    sessionId: payload.session_id || state.sessionId || null,
  });

  const lines = [
    '【上下文记忆契约 · 会话启动】',
    `本工作区的上下文记忆文件：${file}`,
    body
 ? '该文件已存在。需要恢复上下文时可先按标题索引查阅，再按需核对实际现状。'
 : '该文件尚不存在。仅在允许写入且确有跨步骤或跨会话价值时按需创建；只读任务或用户禁止写入时不创建。',
  ];
  if (index.length) lines.push('', `标题索引（${index.length} 条，用于快速定位）：`, ...index);
  lines.push(
    '',
 '记忆只是可能过时的参考；以用户当前要求和可验证的实际现状为准，允许写入时按需更新。',
 `恢复中断的任务时：如有记忆可先查阅并核对现状，再继续未完成事项。会话来源=${source}。`
  );

  m.emit({ additionalContext: lines.join('\n') });
}

main().catch(() => {});
