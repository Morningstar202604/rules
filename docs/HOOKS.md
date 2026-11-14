# 钩子说明

9 个事件钩子、`cleanup-check` 收尾辅助和 `ledger` 台账 CLI 位于 `<安装目录>/hooks/`，共用 `<安装目录>/hooks/lib/` 下的 8 个模块（7 个共用模块 + 1 个 Claude Code 输出适配器 `claude-wrap.js`）。全部是纯 Node.js（>= 18）、零第三方依赖、不联网。

## 执行契约

- 从 stdin 读 JSON payload（`{ session_id, cwd, tool_name, tool_input, prompt, ... }`）。
- 向 stdout 写一行 JSON；不输出表示钩子未提出决策，不代表用户授权或宿主许可。
- 任何异常都在 `main().catch(() => {})` 里吞掉，**钩子永不因自身错误阻断用户**。
- 状态文件写在 `<安装目录>/memory/<项目>-<hash>.state.json`，可用 `AGENT_RULES_MEMORY_DIR` 重定向。

## 逐个说明

### session-start.js（SessionStart）

读工作区记忆文件，把路径与标题索引注入上下文；重置 `stopRounds` 与提示标记并写状态文件。记忆按需使用，只读或禁止写入时不要求创建；自动状态写入可能仍发生。

### user-prompt.js（UserPromptSubmit）

注入记忆定位（`lib/recall.js`）；新任务首轮可附可选的路由参考（`lib/router.js`）。纯停止短语（"停""算了""暂停"）会把 `skipGuard` 置为 true，本轮只提示不提醒。

### guard-write.js（PreToolUse · Edit|Write|ApplyPatch）

- 敏感文件（`.env`、`*.pem`、`id_rsa`、`credentials.json`、`accounts.json` 等）→ 只提示，不阻断。
- **工作区外写入 → 只提示，不阻断**；工作区**内**任意多级新目录放行（可在里面自由建目录，同名冲突改名即可）。
- 系统级安装位置（`Program Files` / `ProgramData` / `LocalAppData\Programs` / `/usr` / `/opt` 等下的 `node_modules`、`bin`、`lib`、`share`）同样只提示后放行。
- 规则安装目录（`<规则目录>`）内写入放行（升级自身不受影响）。
- 代码文件写入 → 记 `changedFiles`、`needsVerify=true`，供收尾时提醒补齐验证。

### guard-bash.js（PreToolUse · Bash）

- 13 条危险命令规则（`lib/danger-rules.js`）：`git reset --hard`、`git clean -f`、`rm -rf`、`DROP TABLE`、无 WHERE 的 UPDATE/DELETE、`mkfs`/`dd`、`npm publish`、生产部署、迁移重置、按名杀进程、历史改写等 → 提示 + 给出可回滚做法。
- 密钥类 git 操作（`git add -A`、`git add .env`、`--no-verify`）→ 提示。
- 检测到长驻服务启动命令（dev server / `docker run` / `uvicorn` 等）→ 执行前写入待核实台账条目并提示补充真实 PID；条目不证明进程已启动。构建/测试类一次性命令不登记。交付前按实际进程核对并关闭本轮服务，用户要求保留的除外。
- 钩子只注入 `additionalContext`，不返回 `permissionDecision`；宿主仍可能根据自身权限策略要求确认。

### repeat-guard.js（PreToolUse · 所有工具）

按 `tool_name` + 规范化 `tool_input` 的 sha1 统计**连续**重复：同一签名连续第 3 次提醒、第 5 次强提示、第 8 次建议停止并向用户汇报；一旦换成别的调用，连续计数从 1 重新开始。

- 状态复用 `lib/memory.js` 的 `readState` / `updateState`，写在 `state.json` 的 `repeatGuard` 字段；`turnStartedAt` 变化（新回合）时计数与通知记录清零。
- 签名只用于近似判重：对象键排序，长字符串截断到 160 字符，长数组截断到 12 项，限制嵌套深度；不用于安全判定。
- 通知上限：同一签名最多 3 次（3/5/8 每级只提示一次）；同一签名 60 秒内不重复提示，升级提示不受冷却影响；单回合最多 6 次；`events` 最多 24 条。
- 只输出 `hookSpecificOutput.additionalContext`（`hookEventName: PreToolUse`），**不返回 `permissionDecision`、不返回 `decision: block`、不阻断任何调用**；Claude Code 侧由 `claude-wrap.js` 转成 `systemMessage`。
- 提示里只回显命令等短标量；长字符串（文件内容等）只报长度，避免把敏感数据写进上下文。

### plan-sync.js（PostToolUse · TodoWrite）

把 todo 列表渲染进记忆文件的 `<!-- plan:start --> ... <!-- plan:end -->` 区块，同时写 `openTodos` 供 stop-guard 判断。

### track-verify.js（PostToolUse / PostToolUseFailure · Bash）

用正则识别验证类命令（`npm test`、`vitest`、`pytest`、`cargo test`、`tsc --noEmit`、`eslint` 等），记录 `lastVerifyOk` 与 `needsVerify` 状态。

### stop-guard.js（Stop）

按项目阶段分支，只注入提醒、不返回 `decision: block`：

- `active`（默认）：提示 `needsVerify`（改了代码没验证）与记忆未落盘；未完成任务与运行中进程属于正常进行中，不提示。
- `closing`：额外提示 `runningProcs` 未清零与 `openTodos` 未完成，然后串联 `cleanup-check`。

同一轮最多提示 3 次；用户喊停或达到上限时不再重复。

`persistentProcs`（`state.json` 里的正则数组）可声明"常驻不关"的进程，命中即从存活清单剔除。

### ledger.js（手动 CLI，非事件钩子）

手动操作台账的 CLI；钩子也会更新状态，台账可能不完整或过时，须结合实际进程核对：

```bash
node hooks/ledger.js status
node hooks/ledger.js phase active|closing|done
node hooks/ledger.js add-proc --cmd "pnpm dev" --pid 1234 --port 5173
node hooks/ledger.js rm-proc --pid 1234 | --port 5173 | --all
node hooks/ledger.js add-file --path src/app.tsx
node hooks/ledger.js artifact --note "dist/"
node hooks/ledger.js decision --title "..." --original "..." --judgment "..." --chosen "..." --why "..."
```

`decision` 把纠偏与关键决策追加到记忆文件的 `## 关键决策与依据` 区块（跨会话可读），用于记录「用户原方案 / 我的判断 / 采用方案 / 依据」。按 AGENTS.md §五 第 18 条纠偏后仅在允许写入且有跨会话价值时记录，不覆盖用户明确要求。

除 `status` 与 `decision` 外每次变更都会同步渲染记忆文件的 `<!-- ledger:start --> ... <!-- ledger:end -->` 区块。状态字段：`projectPhase`、`runningProcs`、`changedFiles`、`artifacts`。

### checkpoint-remind.js（PostToolUse）

长任务心跳。每 15 次工具调用检查一次记忆文件的 mtime：

- 超过 25 分钟未更新 → 提醒写「## 当前状态」（当前切片 / 上一步结果 / 下一步）。
- 45 分钟冷却，不重复刷屏。

它与 `stop-guard` 的严格检查点模式互补；两者均为提醒，不授予权限，也不阻断收尾。

### 严格检查点模式（配置开关）

`cli/config.json`：

```json
{ "checkpoints": { "strict": false } }
```

设为 `true` 后，`stop-guard` 在 active 阶段发现「记忆文件超过 60 分钟未更新 + 仍有未完成待办」会提醒检查点过期，不会阻断收尾。默认关闭；是否启用按任务和用户约束决定。

### cleanup-check.js（被 stop-guard 在 closing 阶段调用，也可独立运行）

扫描工作区（深度 3、上限 3000 文件）找临时文件（`.tmp/.bak/.orig/.rej/*~/.swp/.log` 等）、本轮报告文件、被改动文档、改动文件清单；`git ls-files` 能识别为已跟踪的文件不算临时；同一轮最多提醒一次，不阻断收尾。

## 自检

```bash
npm run selftest
# ALL 72 CASES PASS
```

自检在 `<仓库>/.tmp/selftest/` 建临时工作区，通过 `ZCODE_MEMORY_DIR` 把记忆重定向到临时目录，不碰真实状态。可用 `AGENT_RULES_TEST_TMP` 改位置。

## Claude Code 适配器

`hooks/lib/claude-wrap.js` 不是钩子，是输出适配层：接收 Claude Code 的事件 JSON，转调目标钩子，再把钩子的 ZCode 风格输出改写成 Claude Code 能识别的形状。

| 事件 | 转换 |
|---|---|
| `SessionStart` / `UserPromptSubmit` / `PostToolUse` | `additionalContext` → `hookSpecificOutput.additionalContext`（补 `hookEventName`） |
| `PreToolUse` | `additionalContext` → `systemMessage`（Claude Code 的 PreToolUse 没有 additionalContext 通道） |
| `Stop` | `decision:block` + `reason` 原样透传 |
| 其它 | `additionalContext` → `systemMessage` |

## 新增钩子的步骤

1. 在 `core/hooks/` 写脚本，复用 `lib/memory.js` 的 stdin/emit/state。
2. 在 `install.js` 的 `zcodeHookEvents()`、`claudeHookEvents()` 里登记。
3. 在 `core/hooks/selftest.js` 加用例（含 schema 校验）。
4. 更新本文件与 `README.md` 的钩子表。
5. `npm run selftest` 全绿再提交。
