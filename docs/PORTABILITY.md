# 移植与降级策略

## 1. 原则

- **仓库是唯一源**：规则、技能、子代理、命令、钩子都在仓库内；目标机器只放安装副本。
- **能力按工具实际情况降级**：不支持钩子的工具不假装有钩子；规则文本仍然生效，只是少了运行时强制。
- **运行态不纳管**：`memory/`、`state/`、`backup/`、`.agent-work-contract.json`、日志属于本机，永远不进仓库。记忆仅按任务需要维护；只读任务不因移植规则强制写入。

## 2. 各工具能力矩阵

| 能力 | ZCode | Claude Code | opencode | Codex | 通用目录 |
|---|---|---|---|---|---|
| 全局规则文件 | `AGENTS.md` | `CLAUDE.md` | `AGENTS.md`（instructions 登记） | `AGENTS.md` | `AGENTS.md` |
| 技能目录 | `skills/` 自动扫描 | `skills/` 自动扫描 | `skills/`（`opencode.json` 登记） | `skills/` | `skills/` |
| 子代理 | `agents/*.md` | `agents/*.md` | `agents/*.md` | `agents/*.md` | `agents/*.md` |
| 斜杠命令 | `commands/*.md` | `commands/*.md` | `commands/*.md` | `commands/*.md` | `commands/*.md` |
| 钩子 | 支持（`cli/config.json`） | 支持（`settings.json`） | 不支持 | 不支持 | 不支持 |
| 运行时状态记录 | 9 个事件钩子 + cleanup-check + ledger 台账 | 8 个事件钩子（无 `PostToolUseFailure`，失败由 Bash 结果推断） | 无 | 无 | 无 |

## 3. 无钩子工具的降级清单

钩子承担四类自动化，没有钩子时改由规则文本 + 模型自律：

| 能力 | 钩子实现 | 无钩子时 |
|---|---|---|
| 记忆文件注入 | `session-start` / `user-prompt` | 需要恢复上下文时按需读 `memory/<项目>-<hash>.md`；路径规则见 `AGENTS.md` §十 |
| 计划落盘 | `plan-sync` | 允许写入且需要持久化时才手工记录计划；只读任务在对话中保留信息 |
| 验证状态记录 | `track-verify` + `stop-guard` | 按任务与风险选择验证，报告实际证据及限制；不强制 test/lint/typecheck |
| 进程/临时文件 | `guard-bash` + `ledger` + `stop-guard` + `cleanup-check` | 收尾前自查 `netstat`/`lsof` 与目录列表 |

## 4. 钩子协议差异

**ZCode**（`~/.zcode/cli/config.json`）

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "SessionStart": [{ "hooks": [{ "type": "process", "command": "<node>", "args": ["<hooks>/session-start.js"], "timeoutMs": 8000 }] }],
      "PreToolUse": [{ "matcher": "Edit|Write|ApplyPatch", "hooks": [{ "type": "process", "command": "<node>", "args": ["<hooks>/guard-write.js"] }] }]
    }
  }
}
```

- 输出协议：stdout 一行 JSON，字段限 `additionalContext` / `hookSpecificOutput` / `decision` / `continue` / `reason` / `suppressOutput` / `systemMessage`。
- `PreToolUse` 全程只走 `additionalContext`，不弹权限窗，也不以权限决策阻断工作区外写入。

**Claude Code**（`~/.claude/settings.json`）

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "\"<node>\" \"<hooks>/guard-write.js\"" }] }]
  }
}
```

- 同一套脚本可直接用：读 stdin JSON、stdout 输出 JSON 的约定一致。
- 差异：Claude Code 没有 `PostToolUseFailure` 事件，`track-verify` 只挂 `PostToolUse`，失败判定依赖 Bash 返回的 `exitCode` / 输出。

**opencode / Codex**：没有等价钩子协议，安装器只装规则、技能、子代理、命令。

## 5. 迁移到新机器

```bash
git clone https://gitcode.com/badhope/rules.git rules
cd rules
node --version          # 需要 >= 18
node install.js --all
```

迁移后检查：

1. 目标工具的规则文件已更新（`~/.zcode/AGENTS.md` 等）。
2. 技能目录数量与 `docs/SKILLS.md` 一致（102 个）。
3. 支持钩子的工具：`cli/config.json` / `settings.json` 里能看到 8 个本仓库事件钩子脚本路径；`cleanup-check` 由 `stop-guard` 在收尾阶段串联，`ledger` 为手动 CLI。
4. 跑一次 `npm run selftest`，应为 `ALL 72 CASES PASS`。

## 6. 定制与上游同步

- 只改仓库，然后在每台机器 `git pull && node install.js --all`。
- 需要保留本机差异时，把差异写进目标工具的「项目级」规则（如 `<repo>/AGENTS.md`），不要改安装副本。
- 本仓库不跟踪上游技能仓库的自动更新；升级技能时手动替换 `core/skills/<name>/` 并更新 `THIRD_PARTY_NOTICES.md`。
