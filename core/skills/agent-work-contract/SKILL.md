---
name: agent-work-contract
description: Use when the user wants to reuse, install, migrate, or sync this working contract (rules + skills + subagents + commands + hooks) into another machine or another AI coding tool, or asks 复用规则 / 装到新机器 / 换工具也要一样 / 把这套规范搬过去.

description_zh: "把本套规则、技能、子代理、命令与钩子复用到任意机器/任意编程智能体：安装、升级、验证、卸载。"
license: MIT
metadata:
  version: "1.0.0"
  category: meta
---

# agent-work-contract — 复用与安装

本技能负责「把这套规则搬到别处并确认真的生效」，不负责改规则内容。

## 何时用

- 用户说：复用这套规则 / 装到新机器 / 换个 AI 工具也要一样 / 同步一下规则。
- 需要判断某台机器上的安装是否完整、是否落后于仓库版本。
- 需要卸载或回滚。

## 安装（标准流程）

1. 确认 Node.js >= 18：`node --version`。
2. 取得仓库（未克隆则克隆，已克隆则 `git pull --ff-only`）：
   `git clone https://gitcode.com/badhope/rules.git rules`
3. 安装：
   - 全部已检测到的工具：`node install.js --all`
   - 指定工具：`node install.js --tool zcode|claude|opencode|codex|generic`
   - 只装规则不装钩子：追加 `--no-hooks`
   - 先看计划不落盘：追加 `--dry-run`
4. 验证（缺一不可）：
   - `node core/hooks/selftest.js` → `ALL 63 CASES PASS`
   - `node scripts/verify.js` → all repository checks passed
   - 目标工具的规则文件存在且含 `agent-work-contract` 标记
   - 支持钩子的工具：配置里能看到本仓库 hooks 的绝对路径
5. 报告：装了哪些工具、文件数、哪些降级（无钩子）、失败项与原因。

## 升级

```bash
cd <repo> && git pull --ff-only && node install.js --all
```

幂等；被本地改过的文件先备份到 `<安装目录>/.agent-work-contract-backup/<时间戳>/`。

## 卸载

```bash
node install.js --tool <工具> --uninstall
```

只删除安装后未被修改过的文件；用户改过的保留并列出。ZCode / Claude 会同时移除钩子注册条目。

## 判断标准

- **已装好**：规则文件、技能目录（数量与 `docs/SKILLS.md` 一致）、子代理、命令齐全；有钩子能力的工具配置里挂上了脚本；自检与 verify 全绿。
- **装了但没生效**：技能数量不符、配置里没有 hooks 路径、会话重启后技能未被列出。原因通常是路径写错或装到了另一个用户目录。
- **降级**：工具本身无钩子协议（opencode / Codex / 通用目录），此时只保证规则、技能、子代理、命令，运行时门禁按 `docs/PORTABILITY.md` 由模型自律替代。

## 边界

- 不改仓库内容；需要定制就改仓库并提交，再重新安装。
- 不复制 `memory/`、`state/`、`backup/`、凭据文件到新机器；这些是本机运行态。
- 不把凭据写进任何安装产物。
