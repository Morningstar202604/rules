const fs = require('fs');

const agents = new Set(fs.readdirSync('core/agents').map((f) => f.replace('.md', '')));
const skills = new Set(fs.readdirSync('core/skills'));
const bad = {};

for (const f of fs.readdirSync('core/agents').filter((x) => x.endsWith('.md'))) {
  const t = fs.readFileSync('core/agents/' + f, 'utf8');
  for (const r of new Set([...t.matchAll(/`([a-z0-9][a-z0-9-]{2,40})`/g)].map((m) => m[1]))) {
    if (/^(npm|pnpm|yarn|node|python|git|docker|bash|curl|jq|rg|make|agent)$/.test(r)) continue;
    if (r.includes('/') || r.includes('.') || r.includes(':')) continue;
    if (skills.has(r) || agents.has(r) || !/-/.test(r)) continue;
    (bad[r] = bad[r] || []).push(f.replace('.md', ''));
  }
}

const rows = Object.entries(bad).sort((a, b) => b[1].length - a[1].length);
const bt = '`';
const lines = [];
lines.push('# 可选技能引用清单', '');
lines.push('子代理正文里引用了一批**本仓库未收录**的技能名（来自上游技能包体系）。它们不是错误：每条引用都带「调用失败/未安装时退回通用经验，不阻塞」的兜底。', '');
lines.push('本文件只做登记，方便判断哪些值得补进 core/skills。补进来后，同名引用自动生效。', '');
lines.push('## 高频（≥10 个角色引用，优先考虑）', '');
lines.push('| 技能名 | 引用角色数 | 建议 |', '|---|---|---|');
for (const [n, list] of rows.filter((x) => x[1].length >= 10)) {
  const hint = /fact-check|quality|checklist/.test(n)
    ? '已有同类能力（core-fact-checker 事实核查 / 质量门禁类技能），可直接复用'
    : '按需补充';
  lines.push(`| ${bt}${n}${bt} | ${list.length} | ${hint} |`);
}
lines.push('', '## 全部清单', '', '| 技能名 | 引用角色 |', '|---|---|');
for (const [n, list] of rows) {
  const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? ` 等 ${list.length} 个` : '');
  lines.push(`| ${bt}${n}${bt} | ${shown} |`);
}
lines.push('', '## 处理原则', '');
lines.push('1. **不要为了消除引用而造空壳技能**——空技能比没有更糟（会命中触发词却给不出方法）。');
lines.push('2. 高频且职能明确的优先用现有技能替代：测试类走 test-quality-review，事实核查走 core-fact-checker。');
lines.push('3. 领域模板类（prd-writing-guide、contract-review-checklist 等）已有对应角色正文承载方法论，可长期不补。');

fs.writeFileSync('docs/OPTIONAL-SKILL-REFS.md', lines.join('\n') + '\n');
console.log('written, entries:', rows.length);
