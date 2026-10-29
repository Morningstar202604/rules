const fs = require('fs');

// 为缺少「何时调用」的角色描述补一句触发语义。
// 规则：描述已含触发短语的跳过；补充句用领域动词 + 场景名词，便于 agent-router 与模型匹配。
function triggerFor(name, desc) {
  const dom = name.split('-')[0];
  const map = {
    audio: '当用户要做播客、音频节目、配音或声音设计时调用。',
    video: '当用户要做视频、剪辑、调色、动效或字幕时调用。',
    visual: '当用户要做视觉设计、海报、Logo、排版或插画时调用。',
    content: '当用户要写文案、长文、社媒内容或短视频脚本时调用。',
    marketing: '当用户要做营销策划、投放、增长或品牌传播时调用。',
    ecommerce: '当用户要做电商运营、选品、Listing 或履约时调用。',
    data: '当用户要做数据分析、指标口径、报表或实验时调用。',
    finance: '当用户要做财务核算、预算、税务或资金规划时调用。',
    legal: '当用户要做合同审查、合规、隐私或知识产权事务时调用。',
    hr: '当用户要做招聘、绩效、薪酬、培训或员工关系时调用。',
    translation: '当用户要做翻译、本地化、术语统一或译文校对时调用。',
    education: '当用户要做课程设计、课件、出题或测评时调用。',
    academic: '当用户要做学术论文、文献综述、投稿或审稿回复时调用。',
    math: '当用户要做数学建模、模型求解或竞赛论文时调用。',
    game: '当用户要做游戏玩法、关卡、数值或叙事设计时调用。',
    product: '当用户要做产品需求、PRD、原型、路线图或用户研究时调用。',
    core: '当用户需要独立评审、核查或专项审计时调用。',
  };
  if (map[dom]) return map[dom];
  if (/review|qa/.test(name)) return '当用户需要该项评审或质检门禁时调用。';
  if (/writer|copy|script/.test(name)) return '当用户需要该类内容创作时调用。';
  if (/analyst|researcher/.test(name)) return '当用户需要该类分析或调研时调用。';
  if (/designer/.test(name)) return '当用户需要该类设计产出时调用。';
  if (/engineer|developer/.test(name)) return '当用户需要该类工程实现时调用。';
  if (/lead|manager/.test(name)) return '当用户需要该类任务统筹与分派时调用。';
  return '当用户需要该角色的专项能力时调用。';
}

let patched = 0;
for (const f of fs.readdirSync('core/agents').filter((x) => x.endsWith('.md'))) {
  const p = 'core/agents/' + f;
  let t = fs.readFileSync(p, 'utf8');
  const m = t.match(/^description:\s*(.*)$/m);
  if (!m) continue;
  const desc = m[1].trim();
  if (/当用户|触发|需要.*时|时调用|适用于|Use when/.test(desc)) continue;

  const name = f.replace('.md', '');
  const trimmed = desc.replace(/[。.]$/, '');
  const next = `${trimmed}。${triggerFor(name, desc)}`;
  t = t.replace(/^description:.*$/m, 'description: ' + next);
  fs.writeFileSync(p, t);
  patched += 1;
}
console.log('patched', patched);
