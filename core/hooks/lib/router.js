'use strict';

// 新任务首轮做一次技能路由 + 角色路由：
//   - skill-router：用哪些技能
//   - agent-router：派给哪支子代理战队（team-lead）
// 只在本轮判定为「新任务」时执行，避免每轮付 Python 启动成本。
// 失败一律静默降级——路由是增强，不是门禁，绝不能因它阻塞对话。

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TIMEOUT_MS = 2500;
const MAX_LINES = 3;

// Python 解释器探测：Windows 常见只有 python/launcher，Linux/macOS 常见 python3。
// CI 的 windows-latest 默认没有 `python` 命令，必须回退，否则路由静默失效。
let interpreter = null;

function candidates() {
  if (process.platform === 'win32') return ['python', 'python3', 'py'];
  return ['python3', 'python'];
}

function probe(idx, cb) {
  if (idx >= candidates().length) return cb(null);
  const bin = candidates()[idx];
  execFile(bin, ['--version'], { timeout: 3000, windowsHide: true }, (err) => {
    if (err) return probe(idx + 1, cb);
    interpreter = bin;
    cb(bin);
  });
}

function withInterpreter(cb) {
  if (interpreter) return cb(interpreter);
  probe(0, cb);
}

function findScript(rulesHome, skillName, fileName) {
  const candidates = [
    path.join(rulesHome, 'skills', skillName, 'scripts', fileName),
    path.join(rulesHome, 'core', 'skills', skillName, 'scripts', fileName),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function findSkillsDir(rulesHome) {
  const candidates = [path.join(rulesHome, 'skills'), path.join(rulesHome, 'core', 'skills')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function findAgentsDir(rulesHome) {
  const candidates = [path.join(rulesHome, 'agents'), path.join(rulesHome, 'core', 'agents')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function run(args, cb) {
  withInterpreter((bin) => {
    if (!bin) return cb(null);
    execFile(
      bin,
      args,
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout) => cb(err ? null : String(stdout || ''))
    );
  });
}

function routeSkills(rulesHome, task, cb) {
  const script = findScript(rulesHome, 'skill-router', 'skill_router.py');
  const skillsDir = findSkillsDir(rulesHome);
  if (!script || !skillsDir) return cb(null);

  run([script, task.slice(0, 300), '--skills-dir', skillsDir, '--top', '3'], (stdout) => {
    if (!stdout) return cb(null);
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
    const verdict = lines.find((l) => /^verdict:/.test(l));
    if (!verdict || /NO SKILL NEEDED/i.test(verdict)) return cb(null);
    const ranked = lines.filter((l) => /^\s+[\d.]+\s+/.test(l)).slice(0, MAX_LINES);
    if (!ranked.length) return cb(null);
    cb(['【技能路由】候选（按相关度）：', ...ranked].join('\n'));
  });
}

function routeAgents(rulesHome, task, cb) {
  const script = findScript(rulesHome, 'agent-router', 'agent_router.py');
  const agentsDir = findAgentsDir(rulesHome);
  if (!script || !agentsDir) return cb(null);

  run([script, task.slice(0, 300), '--agents-dir', agentsDir, '--top', '2'], (stdout) => {
    if (!stdout) return cb(null);
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
    const verdict = lines.find((l) => /^verdict:/.test(l));
    if (!verdict || /NO AGENT NEEDED/i.test(verdict)) return cb(null);
    const ranked = lines.filter((l) => /^\s+[\d.]+\s+/.test(l)).slice(0, 2);
    if (!ranked.length) return cb(null);
    cb([
      '【角色派发】新任务必须派给子代理执行，不得自己在主线程硬做。建议战队：',
      ...ranked,
      '用法：Agent(subagent_type="<team-lead>")，由 lead 在队内拆分子角色；跨领域任务可并行派多个 lead。',
    ].join('\n'));
  });
}

function routeAll(rulesHome, task, cb) {
  let done = 0;
  const out = [];
  const finish = () => {
    done += 1;
    if (done === 2) cb(out.filter(Boolean));
  };
  routeAgents(rulesHome, task, (s) => { if (s) out.push(s); finish(); });
  routeSkills(rulesHome, task, (s) => { if (s) out.push(s); finish(); });
}

module.exports = { routeAll, routeSkills, routeAgents };
