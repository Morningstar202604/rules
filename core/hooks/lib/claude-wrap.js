'use strict';

/**
 * Claude Code 输出适配器（不是钩子，不计入 8 个钩子）。
 *
 * 用法：command: "<node>" "<hooks>/lib/claude-wrap.js" "<hooks>/guard-bash.js"
 *
 * 为什么需要：
 *   - 我们的钩子按「ZCode 协议」输出顶层 additionalContext；Claude Code 只认
 *     hookSpecificOutput.additionalContext（SessionStart / UserPromptSubmit / PostToolUse）。
 *   - PreToolUse 在 Claude Code 里没有 additionalContext 通道，只支持
 *     permissionDecision 与 systemMessage；本适配器把提示改写成 systemMessage，
 *     保持「只提示、不阻断」的原有设计。
 *   - Stop 的 decision/reason 两边一致，原样透传。
 */

const { execFileSync } = require('node:child_process');

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

function parse(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function adapt(out, event) {
  if (!out || typeof out !== 'object') return null;
  if (out.decision === 'block') return out;

  const text =
    (out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) ||
    out.additionalContext ||
    '';

  if (!text) return out;

  if (event === 'SessionStart' || event === 'UserPromptSubmit' || event === 'PostToolUse') {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
  }
 if (event === 'PreToolUse') {
 const { additionalContext, ...hookSpecificOutput } = out.hookSpecificOutput || {};
 return {
 ...out,
 additionalContext: undefined,
 hookSpecificOutput: Object.keys(hookSpecificOutput).length ? hookSpecificOutput : undefined,
 systemMessage: text,
 };
 }
  return { systemMessage: text };
}

async function main() {
  const target = process.argv[2];
  if (!target) return;
  const raw = await readStdin();
  const event = parse(raw).hook_event_name || process.env.CLAUDE_HOOK_EVENT || '';

  let outRaw = '';
  try {
    outRaw = execFileSync(process.execPath, [target], {
      input: raw,
      encoding: 'utf8',
      timeout: 14000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return;
  }

  const out = parse(outRaw);
  const adapted = adapt(out, event);
  if (adapted) process.stdout.write(JSON.stringify(adapted));
}

main().catch(() => {});
