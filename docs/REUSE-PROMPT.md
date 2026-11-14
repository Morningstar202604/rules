# 一键复用提示词

在三台机器、任何编程智能体（Claude Code / ZCode / opencode / Codex / Cursor 等）里，把下面整段粘贴给智能体即可。它自己完成克隆、安装、验证。

## 标准版（推荐）

```text
把 rules 这套规则安装到本机并启用。

1. 若尚未克隆：git clone https://gitcode.com/badhope/rules.git ~/rules
   已有则：cd ~/rules && git pull --ff-only
2. 检测本机已安装的编程智能体，执行：node install.js --all
   （只想要某一个：node install.js --tool zcode|claude|opencode|codex|generic）
3. 验证：
   - node <repo>/core/hooks/selftest.js 输出 "ALL 72 CASES PASS"
   - 目标工具的规则文件已更新（如 ~/.zcode/AGENTS.md、~/.claude/CLAUDE.md）
   - 支持钩子的工具里，配置文件能看到本仓库 hooks 路径
4. 报告：装了哪些工具、各写了多少文件、哪些走降级（无钩子）、有没有失败项。
不要修改仓库内容；需要定制就单独提。
```

## 极简版

```text
安装 https://gitcode.com/badhope/rules 到本机所有编程智能体：
git clone 后 node install.js --all，然后运行 core/hooks/selftest.js 确认 63/63 通过。
```

## 只借用规则、不装钩子

```text
git clone https://gitcode.com/badhope/rules.git
node install.js --tool <工具> --no-hooks
```

适合不允许注册钩子的托管环境（CI、云端沙箱）。规则、技能、子代理、命令照常生效。

## 装到项目内（随项目走）

```text
git clone https://gitcode.com/badhope/rules.git .agent-rules
node .agent-rules/install.js --tool generic --home ./.agent-rules-installed
# 然后把 <项目>/AGENTS.md 里的规则指向 .agent-rules-installed/AGENTS.md
```

## 新会话开场白（装好之后）

```text
按 AGENTS.md 与 master-checklist 开工。任务：<一句话描述>。
开工先盘点可用能力（技能 / MCP / 子代理），交付带三清单（改了 / 没动 / 未验证）。
```

## 升级

```text
cd ~/rules && git pull --ff-only && node install.js --all
```

幂等覆盖；被本地改过的文件会先备份到 `<安装目录>/.agent-work-contract-backup/<时间戳>/`。
