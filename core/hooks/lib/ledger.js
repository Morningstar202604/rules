'use strict';

const fs = require('node:fs');
const path = require('node:path');
const m = require('./memory.js');

const LEDGER_START = '<!-- ledger:start -->';
const LEDGER_END = '<!-- ledger:end -->';

function stateOf(cwd) {
  return m.readState(cwd);
}

function patchState(cwd, fn) {
  return m.updateState(cwd, (state) => {
    const next = fn({ ...state });
    return { ...next, lastLedgerAt: new Date().toISOString() };
  });
}

function setPhase(cwd, phase) {
  if (!['active', 'closing', 'done'].includes(phase)) throw new Error('phase 必须是 active / closing / done');
  return patchState(cwd, (s) => ({ ...s, projectPhase: phase, ...(phase === 'active' ? { procNudged: false, closeoutAt: null } : {}) }));
}

function addProc(cwd, entry) {
  const item = {
    command: String(entry.command || '').slice(0, 200),
    pid: entry.pid ? Number(entry.pid) : null,
    port: entry.port ? Number(entry.port) : null,
    cwd: entry.cwd || cwd,
    note: entry.note ? String(entry.note).slice(0, 200) : '',
    startedAt: entry.startedAt || new Date().toISOString(),
  };
  if (!item.command && !item.pid) throw new Error('add-proc 至少需要 --cmd 或 --pid');
  return patchState(cwd, (s) => {
    const list = Array.isArray(s.runningProcs) ? s.runningProcs : [];
    const same = list.findIndex((p) => (item.pid && p.pid === item.pid) || (item.port && p.port === item.port && p.command === item.command));
    if (same >= 0) list[same] = { ...list[same], ...item };
    else list.push(item);
    return { ...s, runningProcs: list.slice(-40), procNudged: false };
  });
}

function removeProc(cwd, filter) {
  return patchState(cwd, (s) => {
    const list = Array.isArray(s.runningProcs) ? s.runningProcs : [];
    const kept = filter.all
      ? []
      : list.filter((p) => {
          if (filter.pid && p.pid === Number(filter.pid)) return false;
          if (filter.port && p.port === Number(filter.port)) return false;
          if (filter.command && String(p.command).includes(filter.command)) return false;
          return true;
        });
    return { ...s, runningProcs: kept, ...(kept.length === 0 ? { procNudged: true } : {}) };
  });
}

function addFile(cwd, filePath) {
  return patchState(cwd, (s) => {
    const files = Array.isArray(s.changedFiles) ? s.changedFiles : [];
    return { ...s, changedFiles: [...new Set([...files, String(filePath)])].slice(-60) };
  });
}

function addArtifact(cwd, note) {
  return patchState(cwd, (s) => {
    const list = Array.isArray(s.artifacts) ? s.artifacts : [];
    return { ...s, artifacts: [...list, { note: String(note).slice(0, 300), at: new Date().toISOString() }].slice(-30) };
  });
}

// 纠偏与关键决策沉淀：追加到记忆文件「## 关键决策与依据」区块。
// 价值在跨会话一致——下次不会再犯同一个判断偏差。
function addDecision(cwd, { title, original, judgment, chosen, why }) {
  const file = m.memoryPathFor(cwd);
  const body = m.readText(file) || '# 工作区记忆文件\n';
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const entry = [
    '',
    `### D-${at} ${String(title || '未命名决策').slice(0, 80)}`,
    `- 用户原方案：${String(original || '-').slice(0, 300)}`,
    `- 我的判断：${String(judgment || '-').slice(0, 300)}`,
    `- 采用方案：${String(chosen || '-').slice(0, 300)}`,
    `- 依据：${String(why || '-').slice(0, 300)}`,
  ].join('\n');

  let next;
  const re = /^(##\s*关键决策与依据\s*$)([\s\S]*?)(?=^##\s|(?![\s\S]))/m;
  if (re.test(body)) {
    next = body.replace(re, (_a, head, mid) => `${head}\n${mid.replace(/\s*$/, '')}${entry}\n\n`);
  } else {
    next = `${body.replace(/\s*$/, '')}\n\n## 关键决策与依据\n${entry}\n`;
  }
  m.ensureDir(path.dirname(file));
  fs.writeFileSync(file, next, 'utf8');
  return { file, title: String(title || '').slice(0, 80) };
}

function snapshot(cwd) {
  const s = stateOf(cwd);
  const open = Array.isArray(s.openTodos) ? s.openTodos.filter(Boolean) : [];
  const procs = Array.isArray(s.runningProcs) ? s.runningProcs : [];
  const files = Array.isArray(s.changedFiles) ? s.changedFiles : [];
  return {
    phase: s.projectPhase || 'active',
    memoryFile: m.memoryPathFor(cwd),
    openTasks: open,
    runningProcs: procs,
    changedFiles: files,
    artifacts: Array.isArray(s.artifacts) ? s.artifacts : [],
    lastVerifyOk: s.lastVerifyOk === true,
    lastVerifyCmd: s.lastVerifyCmd || '',
  };
}

function render(snap) {
  const lines = [LEDGER_START, '## 资源台账', '', `- 更新：${new Date().toISOString()}`, `- 项目阶段：${snap.phase}`, ''];
  lines.push(`### 运行中进程（${snap.runningProcs.length}）`);
  if (!snap.runningProcs.length) lines.push('', '- 无');
  else {
    lines.push('');
    for (const p of snap.runningProcs) {
      const bits = [p.command || '(no cmd)'];
      if (p.pid) bits.push(`pid=${p.pid}`);
      if (p.port) bits.push(`port=${p.port}`);
      if (p.note) bits.push(p.note);
      bits.push(`since ${String(p.startedAt || '').slice(0, 19).replace('T', ' ')}`);
      lines.push(`- ${bits.join(' · ')}`);
    }
  }
  lines.push('', `### 未完成任务（${snap.openTasks.length}）`);
  lines.push('', ...(snap.openTasks.length ? snap.openTasks.map((t) => `- ${t}`) : ['- 无']));
  lines.push('', `### 本轮改动文件（${snap.changedFiles.length}）`);
  lines.push('', ...(snap.changedFiles.length ? snap.changedFiles.map((f) => `- ${f}`) : ['- 无']));
  lines.push('', `### 交付物（${snap.artifacts.length}）`);
  lines.push('', ...(snap.artifacts.length ? snap.artifacts.map((a) => `- ${a.note}`) : ['- 无']));
  lines.push('', LEDGER_END);
  return lines.join('\n');
}

function syncMarkdown(cwd) {
  const file = m.memoryPathFor(cwd);
  const snap = snapshot(cwd);
  const block = render(snap);
  const body = m.readText(file);
  let next;
  const start = body.indexOf(LEDGER_START);
  const end = body.indexOf(LEDGER_END);
  if (start >= 0 && end > start) next = body.slice(0, start) + block + body.slice(end + LEDGER_END.length);
  else next = (body.trim() ? body.replace(/\s*$/, '\n\n') : '') + block + '\n';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, 'utf8');
  } catch {
    /* 台账写盘失败不阻断 */
  }
  return snap;
}

function format(snap) {
  const out = [
    `阶段      : ${snap.phase}`,
    `记忆文件  : ${snap.memoryFile}`,
    `未完成任务: ${snap.openTasks.length}`,
    ...snap.openTasks.slice(0, 10).map((t, i) => `  ${i + 1}. ${t}`),
    `运行进程  : ${snap.runningProcs.length}`,
    ...snap.runningProcs.slice(0, 10).map((p) => `  - ${p.command || '(no cmd)'}${p.pid ? ` pid=${p.pid}` : ''}${p.port ? ` port=${p.port}` : ''}`),
    `改动文件  : ${snap.changedFiles.length}`,
    ...snap.changedFiles.slice(-10).map((f) => `  - ${f}`),
    `最近验证  : ${snap.lastVerifyOk ? '通过' : '未通过/未跑'}${snap.lastVerifyCmd ? ` (${snap.lastVerifyCmd})` : ''}`,
  ];
  return out.join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(args.cwd || process.cwd());
  const cmd = args._[0] || 'status';
  let snap;
  switch (cmd) {
    case 'status':
      snap = syncMarkdown(cwd);
      if (args.json) process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
      else process.stdout.write(format(snap) + '\n');
      return;
    case 'phase':
      setPhase(cwd, args._[1]);
      break;
    case 'add-proc':
      addProc(cwd, { command: args.cmd, pid: args.pid, port: args.port, note: args.note, cwd: args.dir });
      break;
    case 'rm-proc':
      removeProc(cwd, { pid: args.pid, port: args.port, command: args.cmd, all: !!args.all });
      break;
    case 'add-file':
      if (!args.path) throw new Error('add-file 需要 --path');
      addFile(cwd, args.path);
      break;
    case 'artifact':
      if (!args.note) throw new Error('artifact 需要 --note');
      addArtifact(cwd, args.note);
      break;
    case 'decision': {
      if (!args.title) throw new Error('decision 需要 --title');
      const r = addDecision(cwd, {
        title: args.title, original: args.original, judgment: args.judgment,
        chosen: args.chosen, why: args.why,
      });
      process.stdout.write(`决策已记录：${r.title}\n→ ${r.file}\n`);
      return;
    }
    default:
      throw new Error(`未知命令：${cmd}（status|phase|add-proc|rm-proc|add-file|artifact|decision）`);
  }
  snap = syncMarkdown(cwd);
  process.stdout.write(format(snap) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(String(e.message || e) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { stateOf, setPhase, addProc, removeProc, addFile, addArtifact, addDecision, snapshot, syncMarkdown, format, render, main, LEDGER_START, LEDGER_END };
