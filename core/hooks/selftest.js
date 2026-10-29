'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NODE = process.execPath;
const H = __dirname;

const ROOT = process.env.AGENT_RULES_TEST_TMP
  ? path.resolve(process.env.AGENT_RULES_TEST_TMP)
  : path.join(__dirname, '..', '..', '.tmp', 'selftest');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* stale temp, best effort */ }
fs.mkdirSync(ROOT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(ROOT, 'run-'));

const ISOLATED_MEMORY = path.join(ROOT, 'memory');
fs.mkdirSync(ISOLATED_MEMORY, { recursive: true });
process.env.ZCODE_MEMORY_DIR = ISOLATED_MEMORY;

const m = require('./lib/memory.js');

const ALLOWED_TOP_KEYS = new Set([
  'additionalContext', 'additional_context', 'continue', 'decision',
  'hookSpecificOutput', 'reason', 'stopReason', 'suppressOutput', 'systemMessage',
]);
const ALLOWED_HSO = {
  PreToolUse: new Set(['hookEventName', 'additionalContext', 'permissionDecision', 'permissionDecisionReason', 'updatedInput']),
  UserPromptSubmit: new Set(['hookEventName', 'additionalContext']),
  SessionStart: new Set(['hookEventName', 'additionalContext']),
  PostToolUse: new Set(['hookEventName', 'additionalContext']),
  PostToolUseFailure: new Set(['hookEventName', 'additionalContext']),
  Stop: new Set(['hookEventName', 'additionalContext']),
};

function newCwd(name) {
  const dir = path.join(RUN, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function prepState(cwd, patch) {
  m.writeState(cwd, patch);
}

function run(script, payload) {
  const out = execFileSync(NODE, [path.join(H, script)], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, ZCODE_MEMORY_DIR: ISOLATED_MEMORY },
  }).trim();
  return out;
}

function parseOut(out) {
  if (!out) return null;
  return JSON.parse(out);
}

function checkSchema(obj) {
  if (!obj) return null;
  const extra = Object.keys(obj).filter((k) => !ALLOWED_TOP_KEYS.has(k));
  const hso = obj.hookSpecificOutput;
  const hsoExtra = hso ? Object.keys(hso).filter((k) => !(ALLOWED_HSO[hso.hookEventName] || new Set()).has(k)) : [];
  if (extra.length || hsoExtra.length || (hso && !ALLOWED_HSO[hso.hookEventName])) return '非法键/事件';
  return null;
}

const CASE_CWD = newCwd('shared_ws');

const CASES = [
  { name: 'guard-write: 写 .env 只提示不阻断', script: 'guard-write.js',
    payload: { tool_name: 'Write', cwd: CASE_CWD, tool_input: { file_path: 'web/scholarhub/.env' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-write: 写 accounts.json 只提示不阻断', script: 'guard-write.js',
    payload: { tool_name: 'Edit', cwd: CASE_CWD, tool_input: { file_path: 'C:/Users/example/.agent-secrets/accounts.json' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-write: 写 .pem 只提示不阻断', script: 'guard-write.js',
    payload: { tool_name: 'ApplyPatch', cwd: CASE_CWD, tool_input: { path: 'deploy/server.pem' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-write: 写 .keystore 只提示不阻断', script: 'guard-write.js',
    payload: { tool_name: 'Write', cwd: CASE_CWD, tool_input: { file_path: 'keystore/release.keystore' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-write: .env.example 模板不误报', script: 'guard-write.js',
    setup: (cwd) => { fs.mkdirSync(path.join(cwd, 'config'), { recursive: true }); },
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'config', '.env.example') } }),
    expect: (o) => o === null },
  { name: 'guard-write: design tokens 不误报', script: 'guard-write.js',
    setup: (cwd) => { fs.mkdirSync(path.join(cwd, 'design'), { recursive: true }); },
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'design', 'tokens.json') } }),
    expect: (o) => o === null },
  { name: 'guard-write: 真实 credentials.json 仍提示', script: 'guard-write.js',
    setup: (cwd) => { fs.mkdirSync(path.join(cwd, 'ops'), { recursive: true }); },
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'ops', 'credentials.json') } }),
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('密钥保护') },
  { name: 'guard-bash: git add -A 只提示不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'git add -A && git commit -m x' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: force push 放行（用户长期授权）', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'git push origin main --force' } },
    expect: (o) => o === null },
  { name: 'guard-bash: reset --hard 只提示不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'git reset --hard HEAD~3' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: rm -rf 只提示不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'rm -rf ./dist' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: DROP TABLE 只提示不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'psql -c "DROP TABLE users;"' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: npm run deploy 只提示不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'npm run deploy' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: 安全命令放行', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'npm run build' } },
    expect: (o) => o === null },
  { name: 'guard-bash: yolo 模式下同样只提示', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, permission_mode: 'yolo', tool_input: { command: 'rm -rf ./dist' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: yolo 模式下 git add -A 不弹窗', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, permission_mode: 'yolo', tool_input: { command: 'git add -A' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: build 模式下也不弹窗（仅提示）', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, permission_mode: 'build', tool_input: { command: 'rm -rf ./dist' } },
    expect: (o) => o?.hookSpecificOutput?.permissionDecision === undefined && !!o?.hookSpecificOutput?.additionalContext },
  { name: 'guard-bash: git log 放行', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'git log --oneline -5' } },
    expect: (o) => o === null },
  { name: 'guard-bash: rm -r -f 分参数命中', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'rm -r -f build' } },
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('rm-rf') },
  { name: 'guard-bash: 无 WHERE 的 UPDATE 命中', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'psql -c "UPDATE users SET active=false;"' } },
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('sql-no-where') },
  { name: 'guard-bash: 带 WHERE 的 UPDATE 放行', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'psql -c "UPDATE users SET active=false WHERE id=1;"' } },
    expect: (o) => o === null },
  { name: 'recall: 业务句不当作喊停', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '停止服务并重启 nginx' }),
    expect: (o, cwd) => m.readState(cwd).skipGuard === false },
  { name: 'recall: 纯停止短语当作喊停', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '停' }),
    expect: (o, cwd) => m.readState(cwd).skipGuard === true },
  { name: 'guard-bash: 长驻服务启动登记台账', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'npm run dev' } },
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('台账') && o?.hookSpecificOutput?.additionalContext?.includes('项目收尾时统一关闭') },
  { name: 'guard-bash: 指定端口提示先查占用', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'vite dev --port 5173' } },
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('5173') },
  { name: 'guard-bash: 时间戳不误判为端口', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'vite dev --port 5173 && echo 2026-10-25 21:40' } },
    expect: (o) => { const t = o?.hookSpecificOutput?.additionalContext || ''; return t.includes('5173') && !t.includes('端口 40'); } },
  { name: 'guard-bash: 按名称杀进程提示不要误杀', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'taskkill /f /im node.exe' } },
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('误杀') },
  { name: 'guard-bash: 普通测试命令仍放行', script: 'guard-bash.js',
    payload: { tool_name: 'Bash', cwd: CASE_CWD, tool_input: { command: 'npm test' } },
    expect: (o) => o === null },
  { name: 'stop-guard: active 阶段进程不阻断', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { runningProcs: [{ command: 'npm run dev', startedAt: new Date().toISOString() }], stopRounds: 0 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o === null },
  { name: 'stop-guard: closing 阶段未关进程阻断收尾', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { projectPhase: 'closing', runningProcs: [{ command: 'npm run dev', startedAt: new Date().toISOString() }], stopRounds: 0 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o?.decision === 'block' && !!o.reason?.includes('项目已进入收尾') },
  { name: 'guard-write: 工作区内写入放行', script: 'guard-write.js',
    setup: (cwd) => { fs.mkdirSync(path.join(cwd, 'src'), { recursive: true }); },
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'src', 'a.ts') } }),
    expect: (o) => o === null },
  { name: 'guard-write: 工作区外写入提示边界', script: 'guard-write.js',
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(os.tmpdir(), 'outside-boundary-probe.ts') } }),
    expect: (o) => o?.hookSpecificOutput?.additionalContext?.includes('工作区边界') },
  { name: 'guard-write: 规则目录内写入放行', script: 'guard-write.js',
    payload: (cwd) => ({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(m.RULES_HOME, 'hooks', 'x.js') } }),
    expect: (o) => o === null },
  { name: 'session-start: 已有记忆给索引', script: 'session-start.js',
    setup: (cwd) => {
      fs.writeFileSync(m.memoryPathFor(cwd), '# 上下文记忆\n\n## 已验证事实\n\n- 自检写入\n', 'utf8');
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd, source: 'startup' }),
    expect: (o) => !!o?.additionalContext && o.additionalContext.includes('标题索引') && o.additionalContext.includes('已验证事实') },
  { name: 'session-start: 无记忆提示建立', script: 'session-start.js',
    payload: (cwd) => ({ session_id: 'st-sess2', cwd, source: 'startup' }),
    expect: (o) => !!o?.additionalContext && o.additionalContext.includes('尚不存在') },
  { name: 'user-prompt: 普通指令注入润色与定位', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '继续做上次没完成的部分' }),
    expect: (o) => !!o?.additionalContext && o.additionalContext.includes('润色') && o.additionalContext.includes('上下文记忆') },
  { name: 'user-prompt: 斜杠命令跳过润色只留定位', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '/commit' }),
    expect: (o) => !!o?.additionalContext && !o.additionalContext.includes('润色') && o.additionalContext.includes('上下文记忆') },
  { name: 'user-prompt: 新任务注入意图识别', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '帮我重构支付模块，要求兼容旧接口并补齐回归测试' }),
    expect: (o) => !!o?.additionalContext && o.additionalContext.includes('意图识别') && o.additionalContext.includes('intent-recognition') },
  { name: 'user-prompt: 新任务注入角色派发', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '帮我写一篇小红书种草文案，推广新款保温杯' }),
    // 路由依赖外部 Python（CI 的 windows runner 可能没有）：有则必须注入，
    // 无则必须优雅降级（不注入、不报错）。两种情况都算通过，崩溃才算失败。
    expect: (o) => o === null || (!!o?.additionalContext
      && (!o.additionalContext.includes('角色派发') || o.additionalContext.includes('subagent_type'))) },
  { name: 'user-prompt: 纯确认不触发意图识别', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '继续' }),
    expect: (o) => !!o?.additionalContext && !o.additionalContext.includes('意图识别') },
  { name: 'user-prompt: 短句不触发意图识别', script: 'user-prompt.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, prompt: '好的' }),
    expect: (o) => !o?.additionalContext || !o.additionalContext.includes('意图识别') },
  { name: 'plan-sync: 计划落盘并回报剩余', script: 'plan-sync.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'TodoWrite',
      tool_input: { todos: [ { content: '实现 A', status: 'pending' }, { content: '实现 B', status: 'completed' } ] } }),
    expect: (o, cwd) => {
      const body = m.readText(m.memoryPathFor(cwd));
      const state = m.readState(cwd);
      return !!o?.additionalContext && o.additionalContext.includes('剩余 1 项')
        && body.includes('## 当前计划') && body.includes('- [ ] 实现 A') && body.includes('- [x] 实现 B')
        && JSON.stringify(state.openTodos) === JSON.stringify(['实现 A']);
    } },
  { name: 'plan-sync: 全部完成回报', script: 'plan-sync.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'TodoWrite',
      tool_input: { todos: [ { content: '实现 A', status: 'completed' }, { content: '实现 B', status: 'completed' } ] } }),
    expect: (o) => !!o?.additionalContext && o.additionalContext.includes('全部 2 项完成') },
  { name: 'track-verify: 验证通过解除门禁', script: 'track-verify.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash',
      tool_input: { command: 'npm test' }, tool_response: { exitCode: 0 } }),
    expect: (o, cwd) => o === null && m.readState(cwd).lastVerifyOk === true },
  { name: 'track-verify: 验证失败标记待验', script: 'track-verify.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash',
      tool_input: { command: 'npm run lint' }, tool_response: { exitCode: 1 } }),
    expect: (o, cwd) => o === null && m.readState(cwd).needsVerify === true && m.readState(cwd).verifyFailed === true },
  { name: 'track-verify: 零失败输出不算失败', script: 'track-verify.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash',
      tool_input: { command: 'npm test' }, tool_response: { status: 'completed', stdout: 'Tests: 10 passed, 0 failed' } }),
    expect: (o, cwd) => o === null && m.readState(cwd).lastVerifyOk === true && m.readState(cwd).needsVerify === false },
  { name: 'track-verify: PostToolUseFailure 记录失败', script: 'track-verify.js',
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash', hook_event_name: 'PostToolUseFailure',
      tool_input: { command: 'pytest -q' }, error: 'process exited with code 1' }),
    expect: (o, cwd) => o === null && m.readState(cwd).needsVerify === true
      && m.readState(cwd).verifyFailed === true && !!m.readState(cwd).lastVerifyError },
  { name: 'stop-guard: active 阶段未完成待办不阻断', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { openTodos: ['完成剩余模块'], stopRounds: 0 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o === null },
  { name: 'stop-guard: closing 阶段未完成待办阻断', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { projectPhase: 'closing', openTodos: ['完成剩余模块'], stopRounds: 0 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o?.decision === 'block' && !!o.reason?.includes('未完成') },
  { name: 'stop-guard: closing 三轮后放行', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { projectPhase: 'closing', openTodos: ['完成剩余模块'], stopRounds: 0 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    multiRun: 4,
    expect: (o) => o === null },
  { name: 'stop-guard: 干净状态放行', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, {}),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o === null },
  { name: 'stop-guard: 严格检查点模式开关可读且默认关闭', script: 'stop-guard.js',
    setup: () => { /* 依赖真实 cli/config.json，不伪造 */ },
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => {
      const { strictCheckpointsEnabled } = require('./stop-guard.js');
      const v = strictCheckpointsEnabled();
      // 返回值必须是布尔，且默认（未配置 checkpoints.strict=true）为 false
      if (typeof v !== 'boolean') throw new Error('非布尔: ' + typeof v);
      if (v !== false) throw new Error('测试环境不应启用 strict');
      return o === null;
    } },
  { name: 'ledger decision: 追加到关键决策区块', script: 'stop-guard.js',
    setup: (cwd) => {
      const ledger = require('./lib/ledger.js');
      ledger.addDecision(cwd, {
        title: 'T1', original: '原方案', judgment: '判断', chosen: '采用', why: '依据',
      });
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o, cwd) => {
      const body = m.readText(m.memoryPathFor(cwd));
      return body.includes('## 关键决策与依据') && body.includes('T1')
        && body.includes('用户原方案：原方案') && body.includes('采用方案：采用');
    } },
  { name: 'stop-guard: 用户喊停时 skipGuard 放行且计数归零', script: 'stop-guard.js',
    setup: (cwd) => prepState(cwd, { skipGuard: true, openTodos: ['不该阻断'], stopRounds: 2 }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o, cwd) => o === null && m.readState(cwd).skipGuard === true && Number(m.readState(cwd).stopRounds || 0) === 0 },
  { name: 'cleanup-check: 用户喊停时 skipGuard 放行', script: 'cleanup-check.js',
    setup: (cwd) => {
      prepState(cwd, { skipGuard: true, changedFiles: ['src/a.ts'], turnStartedAt: new Date().toISOString(), cleanupNudged: false });
      fs.writeFileSync(path.join(cwd, 'tmp-stop.js'), 'x', 'utf8');
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o === null },
  { name: 'cleanup-check: 只阻断一次，后续不重复', script: 'cleanup-check.js',
    setup: (cwd) => {
      prepState(cwd, { changedFiles: ['src/a.ts'], turnStartedAt: new Date().toISOString(), cleanupNudged: false });
      fs.writeFileSync(path.join(cwd, 'tmp-once.js'), 'x', 'utf8');
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    multiRun: 2,
    expect: (o) => o === null },
  { name: 'cleanup-check: 临时文件与改动阻断', script: 'cleanup-check.js',
    setup: (cwd) => {
      prepState(cwd, { changedFiles: ['src/a.ts'], turnStartedAt: new Date().toISOString(), cleanupNudged: false });
      fs.writeFileSync(path.join(cwd, 'tmp-scratch.js'), 'x', 'utf8');
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o?.decision === 'block' && !!o.reason?.includes('临时/备份文件') },
  { name: 'cleanup-check: 已提醒不重复', script: 'cleanup-check.js',
    setup: (cwd) => prepState(cwd, { changedFiles: ['src/a.ts'], turnStartedAt: new Date().toISOString(), cleanupNudged: true }),
    payload: (cwd) => ({ session_id: 'st-sess', cwd }),
    expect: (o) => o === null },
  { name: 'checkpoint-remind: 记忆新鲜时不提醒', script: 'checkpoint-remind.js',
    setup: (cwd) => {
      fs.writeFileSync(m.memoryPathFor(cwd), '# 记忆\n\n## 当前状态\n\n- 下一步：继续\n');
      prepState(cwd, { toolCalls: 14 });
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash' }),
    expect: (o, cwd) => o === null && m.readState(cwd).toolCalls === 15 },
  { name: 'checkpoint-remind: 记忆过旧时提醒', script: 'checkpoint-remind.js',
    setup: (cwd) => {
      const f = m.memoryPathFor(cwd);
      fs.writeFileSync(f, '# 记忆\n\n## 当前状态\n\n- 下一步：继续\n');
      const old = new Date(Date.now() - 60 * 60 * 1000);
      try { fs.utimesSync(f, old, old); } catch { /* ignore */ }
      prepState(cwd, { toolCalls: 14 });
    },
    payload: (cwd) => ({ session_id: 'st-sess', cwd, tool_name: 'Bash' }),
    expect: (o, cwd) => !!o?.additionalContext && o.additionalContext.includes('长任务心跳') && m.readState(cwd).toolCalls === 15 },
];

let failed = 0;
let caseSeq = 0;
for (const c of CASES) {
  caseSeq += 1;
  const cwd = newCwd(`${String(caseSeq).padStart(2, '0')}_${c.name.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36)}`);
  let obj = null;
  let runs = c.multiRun || 1;
  try {
    if (c.setup) c.setup(cwd);
    const payload = typeof c.payload === 'function' ? c.payload(cwd) : { ...c.payload, cwd };
    let last = null;
    let outputs = [];
    for (let i = 0; i < runs; i += 1) {
      const out = run(c.script, payload);
      last = out;
      outputs.push(out);
    }
    if (c.multiRun) {
      const parsed = outputs.map((out) => (out ? JSON.parse(out) : null));
      const blocked = parsed.slice(0, -1).every((o) => o?.decision === 'block');
      obj = parsed[parsed.length - 1];
      if (!blocked) {
        console.log(`FAIL ${c.name} -> 前 N-1 轮未按预期阻断`);
        failed += 1;
        continue;
      }
    } else {
      obj = last ? JSON.parse(last) : null;
    }
  } catch (e) {
    console.log(`FAIL ${c.name} -> ${String(e.message).slice(0, 120)}`);
    failed += 1;
    continue;
  }
  const schemaErr = checkSchema(obj);
  if (schemaErr) {
    console.log(`FAIL ${c.name} -> ${schemaErr}`);
    failed += 1;
    continue;
  }
  if (c.expect(obj, cwd)) console.log(`ok   ${c.name}`);
  else { console.log(`FAIL ${c.name} -> 决策不符`); failed += 1; }
}

console.log(failed === 0 ? `\nALL ${CASES.length} CASES PASS` : `\n${failed}/${CASES.length} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
