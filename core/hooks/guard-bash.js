'use strict';

const { checkGitCommand } = require('./lib/guards.js');
const { DANGER_RULES } = require('./lib/danger-rules.js');
const m = require('./lib/memory.js');

// 只有「真的会常驻监听」的命令才算长驻服务。
// 旧正则把 "npx vite build" / "npx vitest" 也匹配成服务（vite 是其中的前缀词），
// 于是每次构建都往 runningProcs 里塞一条无端口记录；stop-guard 对 port=null
// 一律视为「仍在运行」，结果每轮收尾都误报「本轮启动的进程还没关闭（20 个）」。
const SERVE_RE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b|\bvite\s+(dev|preview)|\bnext\s+dev\b|\bnuxt\s+dev\b|\bwebpack\s+serve\b|\buvicorn\b|\bgunicorn\b|\bflask\s+run\b|\bpython[0-9.]*\s+-m\s+http\.server\b|\bmanage\.py\s+runserver\b|\bdocker\s+(run|compose\s+up)\b|\bjava\s+-jar\b|\bdotnet\s+run\b|\brails\s+(s|server)\b|\bphp\s+-S\b/i;
// 一次性命令白名单：命中这些词就绝不登记为长驻服务（构建/测试/类型检查/格式）
const ONESHOT_RE = /\b(build|test|tests|typecheck|type-check|lint|coverage|report)\b|\bvitest\b|\btsc\b|\beslint\b|\bprettier\b/i;
// 巡检命令：只是查看端口/进程/日志，文字里出现 uvicorn/vite 等词不代表要起服务。
// 之前把 `netstat ... | grep uvicorn` / `Get-CimInstance Win32_Process` 全都登记成
// 长驻进程，导致收尾校验每轮误报 20 条。
// 判定改成「第一段可执行命令就是巡检工具」：`npm run dev && echo` 第一段是服务，仍登记；
// `netstat | grep 5173` 第一段是巡检，放过。
const INSPECT_RE = /^(netstat|tasklist|taskkill|Get-CimInstance|Get-NetTCPConnection|Get-Process|wmic|pgrep|pkill|ps|grep|findstr|head|tail|echo|cat|type|dir|ls|-Foreach-Object|Format-Table)\b/i;

function firstSegment(cmd) {
  return String(cmd).split(/&&|\|\||[;|]/)[0].trim().replace(/^sudo\s+/, '');
}
const PORT_RE = /(?:--port[=\s]+|(?<!\d):)([1-9]\d{2,4})(?!\d)/;
const PORT_ARG_RE = /\b(?:http\.server|serve|runserver)\s+(?:--port[=\s]+)?([1-9]\d{2,4})(?!\d)/;
const KILL_RE = /\b(kill|killall|pkill|taskkill|Stop-Process)\b/i;
const FOREIGN_KILL_RE = /\b(taskkill\s+\/[fF]\s+\/im|killall\s+-9|pkill\s+-9|Stop-Process\s+-Name)\b/i;

function portHint(cmd) {
  const m2 = PORT_RE.exec(cmd) || PORT_ARG_RE.exec(cmd);
  return m2 ? m2[1] : null;
}

async function main() {
  const payload = m.parsePayload(await m.readStdin());
  const toolName = payload.tool_name || payload.toolName || '';
  const input = payload.tool_input || payload.toolInput || {};

  if (toolName !== 'Bash') return;
  const cmd = String(input.command || '');
  if (!cmd.trim()) return;

  const secret = checkGitCommand(cmd);
  const dangers = DANGER_RULES.filter((r) => r.re.test(cmd));

  const blocks = [];
  if (secret) blocks.push(secret);
  for (const d of dangers) {
    blocks.push([`· ${d.id}：${d.why}`, `  更安全的做法：${d.fix}`].join('\n'));
  }

  if (SERVE_RE.test(cmd) && !ONESHOT_RE.test(cmd) && !INSPECT_RE.test(firstSegment(cmd))) {
    const port = portHint(cmd);
    blocks.push(
      [
        '· 检测到长驻服务启动命令：已记录待核实条目，不代表进程已启动；交付前关闭本轮启动的服务，用户要求保留的除外。',
        port
          ? `  启动前先确认端口 ${port} 未被占用；被占用就换端口，不要结束占用它的进程。`
          : '  启动前先确认目标端口未被占用；被占用就换端口，不要结束占用它的进程。',
        '  启动成功并拿到真实 PID 后可执行 ledger.js add-proc --cmd "<命令>" --pid <PID> --port <端口> 补充记录；只关闭本轮启动的进程。',
      ].join('\n')
    );

    const cwd = payload.cwd || process.cwd();
    const state = m.readState(cwd);
    const entry = { command: cmd.slice(0, 160), port: port ? Number(port) : null, startedAt: new Date().toISOString() };
    const list = Array.isArray(state.runningProcs) ? state.runningProcs : [];
    m.writeState(cwd, { ...state, runningProcs: [...list, entry].slice(-40), procNudged: false });
  }

  if (FOREIGN_KILL_RE.test(cmd)) {
    blocks.push(
      [
        '· 按名称批量结束进程：会误杀同名但无关的程序',
        '  只能按本轮记录的 PID 精确停止；他人进程一律不动，冲突时改端口或换目录。',
      ].join('\n')
    );
  } else if (KILL_RE.test(cmd)) {
    blocks.push(
      [
        '· 进程结束操作：确认目标 PID 来自本轮启动',
        '  非本轮启动的进程禁止结束；不确定就先查 PID 与端口归属。',
      ].join('\n')
    );
  }

  if (!blocks.length) return;

  const head = secret
    ? '【密钥保护 + 危险操作确认】'
    : '【危险操作确认】命中 ' + (dangers.length ? dangers.map((d) => d.id).join(', ') : '进程/服务生命周期');

  const reason = [
    head,
    '',
    cmd.length > 300 ? cmd.slice(0, 300) + '…' : cmd,
    '',
    ...blocks,
  ].join('\n');

  m.emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: reason,
    },
  });
}

main().catch(() => {});
