'use strict';

// 新任务首轮做一次技能路由：调用 skill-router 的离线 TF-IDF，
// 只在本轮判定为「新任务」时执行，避免每轮付 Python 启动成本。
// 失败一律静默降级——路由是增强，不是门禁，绝不能因它阻塞对话。

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TIMEOUT_MS = 2500;
const MAX_LINES = 4;

function findRouter(rulesHome) {
  const candidates = [
    path.join(rulesHome, 'skills', 'skill-router', 'scripts', 'skill_router.py'),
    path.join(rulesHome, 'core', 'skills', 'skill-router', 'scripts', 'skill_router.py'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function findSkillsDir(rulesHome) {
  const candidates = [path.join(rulesHome, 'skills'), path.join(rulesHome, 'core', 'skills')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function route(rulesHome, task, cb) {
  const script = findRouter(rulesHome);
  const skillsDir = findSkillsDir(rulesHome);
  if (!script || !skillsDir) return cb(null);

  execFile(
    process.platform === 'win32' ? 'python' : 'python3',
    [script, task.slice(0, 300), '--skills-dir', skillsDir, '--top', '3'],
    { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
    (err, stdout) => {
      if (err || !stdout) return cb(null);
      const lines = String(stdout).split(/\r?\n/).filter((l) => l.trim());
      const verdict = lines.find((l) => /^verdict:/.test(l));
      if (!verdict || /NO SKILL NEEDED/i.test(verdict)) return cb(null);
      const ranked = lines.filter((l) => /^\s+[\d.]+\s+/.test(l)).slice(0, MAX_LINES);
      if (!ranked.length) return cb(null);
      cb(null, ['【技能路由】候选（按相关度）：', ...ranked].join('\n'));
    }
  );
}

module.exports = { route };
