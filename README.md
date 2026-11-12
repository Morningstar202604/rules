# rules

rules 是一套可移植的 AI 工作契约：**规则 + 技能 + 子代理 + 命令 + 运行时钩子**，一条命令装进任意编程智能体（ZCode / Claude Code / opencode / Codex / 通用目录），装完即用。

不是提示词合集，而是带工程纪律的规范集合：规则、技能、子代理与钩子协同工作；钩子只做状态提示与台账记录，不阻断收尾、不弹权限窗。

## 一条命令复用

```bash
git clone https://gitcode.com/badhope/rules.git
cd rules
node install.js --all                 # 已检测到的工具全部安装
node install.js --tool claude         # 或只装某一个
```

装完重启会话。重复执行是幂等的：已一致的文件跳过，被改过的先备份再覆盖。

| 命令 | 作用 |
|---|---|
| `node install.js --tool <zcode\|claude\|opencode\|codex\|generic>` | 安装到指定工具 |
| `node install.js --all` | 安装到所有已检测到的工具 |
| `node install.js --tool zcode --profile dev` | 只装编程开发相关技能与子代理（约 60 技能 / 35 代理）；默认 `full` 装全量 |
| `node install.js --tool zcode --dry-run` | 只打印计划，不落盘 |
| `node install.js --tool zcode --home D:/rules` | 装到自定义目录（含 portable 场景） |
| `node install.js --tool zcode --no-hooks` | 只装规则/技能/子代理/命令，不装钩子 |
| `node install.js --tool zcode --uninstall` | 卸载；**安装后被改动过的文件一律保留** |
| `npm test` | 跑钩子、凭据安全、安装回归、离线上传 mock 与 Python组件评测 |
| `npm run selftest` | 只跑钩子自检（68 个用例） |
| `npm run verify` | 跑仓库数量、文档、安装器、包内容与凭据安全门禁 |

## 装了什么

```
AGENTS.md              全局工作规范（输出、验证、安全、记忆、切片、边界与移植）
core/skills/           100 个技能（工作契约、AQG 审计、代码审查、调试、架构、前后端、数据、安全、工程管理、技能路由、视觉与文档等）
core/agents/           220 个子代理角色（软件/数据/内容/学术/电商/设计/视频/翻译等战队）
core/commands/         4 个斜杠命令（review / arch-review / security-scan / test-gap）
core/hooks/            8 个事件钩子 + cleanup-check 收尾辅助 + ledger 台账 CLI + 8 个共用模块 + Claude Code 输出适配器
install.js             跨工具安装器
templates/             凭据库、记忆文件的最小模板（不含任何真实凭据）
docs/                  移植说明、分层模型、钩子协议、上传规范、凭据接入、技能清单、插件清单、一键复用提示词
THIRD_PARTY_NOTICES.md 上游技能与子代理的许可声明
```

上传行为详见 [`docs/UPLOAD.md`](docs/UPLOAD.md)：GitHub API 可精确重建提交并快进分支，回读确认远端 HEAD 等于本地 HEAD；无法精确快进时失败，不覆盖远端。

## 钩子做了什么（支持钩子的工具才启用）

| 钩子 | 触发 | 行为 |
|---|---|---|
| `session-start` | 会话开始 | 注入工作区记忆文件路径与标题索引 |
| `user-prompt` | 每轮输入 | 注入记忆定位与可选路由参考；识别"停"类短语静默放行 |
| `guard-write` | 写文件前 | 敏感文件（.env / 密钥 / 凭据）提示；工作区外写入仅提示、不阻断；登记改动待验证 |
| `guard-bash` | 执行命令前 | 13 条危险命令（rm -rf、DROP、force push 之外的不可逆操作等）提示；密钥类 git 操作提示；长驻服务登记到台账 |
| `plan-sync` | TodoWrite 后 | 把计划写进记忆文件的「当前计划」区块 |
| `track-verify` | Bash 执行后 | 识别测试/lint/类型检查命令并记录结果 |
| `stop-guard` | 准备收尾 | 提示「未验证改动 / 记忆未落盘」；`closing` 阶段额外提示未关进程与未完成待办（最多 3 轮，不阻断） |
| `cleanup-check` | 项目收尾串联 | 只在 `phase closing` 时检查临时文件、待同步文档、本轮改动清单，仅提示 |
| `ledger` | 手动 CLI | 台账查询与变更：`status` / `phase` / `add-proc` / `rm-proc` / `add-file` / `artifact` |

所有钩子默认只注入提示或记录台账，**不修改用户命令、不阻断写入、不阻断收尾、不弹权限窗、不杀进程**。详见 `docs/HOOKS.md`。

## 项目阶段与台账

进程与中间产物不再「每轮清」：登记实时发生，清理统一在项目收尾。

```bash
node <规则目录>/hooks/ledger.js status                          # 阶段 / 未完成任务 / 进程 / 改动文件 / 交付物
node <规则目录>/hooks/ledger.js add-proc --cmd "pnpm dev" --pid 1234 --port 5173
node <规则目录>/hooks/ledger.js phase closing                   # 进入收尾阶段，额外检查进程与待办
node <规则目录>/hooks/ledger.js phase done
```

`status` 会把台账渲染进记忆文件的「资源台账」区块，作为「还有哪些在跑」的唯一口径。

## 运行时配置（安装器自动写入 ZCode）

| 配置 | 值 | 原因 |
|---|---|---|
| `skills.metadataBudget` | 60000 | 默认 20000 撑不住 100 个技能，超限后触发词全丢 |
| `toolConcurrency.maxConcurrency` | 16 | 允许更多并行工具调用 |
| `features.*` | 全开 | compact / rewind / subagent / memory / skill / mcp |
| `hooks.maxOutputBytes` | 65536 | 台账与收尾报告可能较长 |
| `hooks.timeoutMs` | 30000 | 收尾检查含端口探测 |

同名技能（docx / pdf / pptx / xlsx / skill-creator / visualize / plugin-creator）不因“官方”字样默认跳过：安装器当前会随仓库安装 bundled 技能；只有确认目标工具已启用且可发现、可调用的官方插件/技能时，才应按工具实际覆盖策略选择跳过或保留。缓存目录、市场清单或同名目录都不算已启用证明。详见 [`docs/PLUGINS.md`](docs/PLUGINS.md)。

## 各工具落点

| 工具 | 规则 | 技能 | 子代理 | 命令 | 钩子 |
|---|---|---|---|---|---|
| ZCode | `~/.zcode/AGENTS.md` | `skills/` | `agents/` | `commands/` | `hooks/` + `cli/config.json` 注册 |
| Claude Code | `~/.claude/CLAUDE.md` | `skills/` | `agents/` | `commands/` | `hooks/` + `settings.json` 注册 |
| opencode | `AGENTS.md` + `opencode.json` instructions | `skills/` 并登记 | `agents/` | `commands/` | 无（协议不同） |
| Codex | `AGENTS.md` | `skills/` | `agents/` | `commands/` | 无 |
| 通用 | `~/.agent-rules/AGENTS.md` | `skills/` | `agents/` | `commands/` | 无 |

没有钩子能力的工具自动降级：规则里的「记忆 / 收尾 / 验证」章节仍在，模型按文执行，只是少了自动化状态记录。降级策略见 `docs/PORTABILITY.md`。

## 在任意程序里复用的正确姿势

1. 新机器：`git clone` → `node install.js --all`。
2. 新会话开场说一句：`按 AGENTS.md 与 master-checklist 开工，本轮任务：<描述>`。
3. 需要整套技能路由时：`python ~/.zcode/skills/skill-router/scripts/skill_router.py "<任务>" --skills-dir ~/.zcode/skills`（路径按实际安装位置替换）。
4. 升级：`git pull && node install.js --all`，幂等覆盖，旧文件进 `.agent-work-contract-backup/`。
5. 定制：改仓库再装，不要在目标机器上直接改副本——仓库是唯一源。

## 目录详情

### 技能（100）

| 技能 | 用途 |
|---|---|
| `master-checklist` | 按需参考的工程与交付自查清单，验证深度按任务与风险决定 |
| `rules` | 本套规则的复用与安装（内部技能 ID 仍为 `agent-work-contract`）：多工具、幂等、验证、卸载 |
| `skill-router` | 任务→技能路由，离线确定性打分 |
| `verification-before-completion` | 声称完成前必须出示证据 |
| `aqg-*` | AQG 工程纪律：施工六步、审计裁决、安全评审、测试质量、会话交接等 11 个 |
| `systematic-debugging` / `tdd-guide` / `code-reviewer` / `senior-architect` | 调试、TDD、代码评审、架构 |
| `spec-driven-workflow` / `writing-plans` / `executing-plans` | 规格驱动与计划执行 |
| `frontend-*` / `shadcn` / `react-best-practices` / `ui-ux-accessibility` | 前端实现、测试、设计、可访问性 |
| `python` / `rust` / `typescript` / `sql-database-assistant` / `postgresql-table-design` | 语言与数据库 |
| `security-scan` / `deep-security-scan` / `env-secrets-manager` / `secrets-vault-manager` | 安全扫描与密钥治理 |
| `observability-designer` / `slo-architect` / `performance-profiler` / `ship-gate` / `quality-gate-checklist` | 可观测性、SLO、性能、发布门禁 |
| `session-handoff` / `skill-author` / `skill-finder` / `skill-linter` / `writing-skills` | 会话交接与技能工程 |

完整清单（含每个技能的一句话说明）见 [`docs/SKILLS.md`](docs/SKILLS.md)。

### 子代理（220）

按战队组织：`software-*` / `fullstack-*`、`data-*`、`content-*`、`academic-*`、`ecommerce-*`、`visual-*`、`video-*`、`audio-*`、`translation-*`、`marketing-*`、`product-*`、`finance-*` / `hr-*` / `legal-*`、`game-*`、`education-*`、`math-*`、`core-*`（架构/评审/安全/测试/调研/事实核查）、`project-director`、各战队 `*-team-lead`。

## 裁剪

整套包含完整技能、子代理与工具适配层。只保留核心工作契约时：

```bash
rm -rf core/agents core/skills/{video-*,audio-*,translation-*,visual-*,marketing-*,ecommerce-*,academic-*}
node install.js --tool zcode
```

不改仓库时也可用 `--no-hooks` 或 `--home <dir>` 装到指定位置后手工挑选。

## 安全

- 仓库**不含**任何真实凭据、令牌、密码、个人路径、会话记忆。
- 安装器不联网、不执行远程脚本、不改系统环境变量。
- 覆盖与卸载都走 `.agent-work-contract-backup/`，卸载保留用户改过的文件。
- 凭据接入是独立可选项，见 `docs/SECRETS.md`；不配置也不影响规则运行。

## 许可

本仓库代码与自有文档：MIT（见 `LICENSE`）。随附技能与子代理来自多个上游项目，各自许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，分发前请保留对应声明。

## 变更

见 [`CHANGELOG.md`](CHANGELOG.md)。
