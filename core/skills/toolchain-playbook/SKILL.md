---
name: toolchain-playbook
description: "本机工具链速查与选型：搜索、JSON/YAML 处理、Git 平台、包管理、运行时、构建与容器。触发：选工具、命令怎么写、本机装了什么、该用哪个 CLI。"
license: MIT
metadata:
  version: "1.0"
---

# 本机工具链速查

> 以下工具仅为候选；环境事实以当前宿主实际探测为准。原参考清单是 2026-10 在本机核对过的结果。新增工具先 `command -v` 确认再写进文档。

## 使用前先识别宿主

1.先识别操作系统、当前 shell、命令解析器和工具来源；Windows 可用 `ver`、`where <工具>`、`Get-Command <工具>`，类 Unix 可用 `uname`、`command -v <工具>`。不要仅凭扩展名、环境变量或历史经验判断 shell。
2. Windows 不默认 PowerShell：优先调用下表中的专用工具及 Node 脚本 / Node 文件 API；只有专用工具缺失时才使用 `cmd` 或 PowerShell，并记录降级理由、编码和退出码假设。
3. 工具清单是能力提示，不是安装事实；写入文档或执行前先在当前宿主解析实际路径。路径、版本、默认编码和行尾均以现场探测为准。

## 已确认可用

| 类别 | 工具 |备注 |
|---|---|---|
| 搜索 | `rg`（ripgrep） | 随 ZCode 分发，优先用它替代 grep / findstr |
| 文本处理 | `jq`、`yq` |结构化数据改写；机器读写 JSON 时显式 UTF-8 / ASCII 安全转义 |
|版本控制 | `git`、`gh` | gh 已登录时可直接操作 PR/Issue；不要假设 credential helper 或登录状态 |
| 包管理 | `pnpm`、`npm` | 项目默认 pnpm；先读 package.json/packageManager |
|运行时 | `node`、`python`、`uv`、`cargo` | Python 按 `python3 → python → py`解析；优先使用 Node 跨平台脚本 |
| 构建 | `make`、`cmake`、`ninja`、`mvn`、`gradle`、`java`(21) | 不假设 Unix shell；Java 路径须现场解析 |
| 容器 | `docker` | `docker compose` 用子命令形式；先确认 Docker daemon 可用 |
| 数据库 | `sqlite3` | 无本地 psql / redis-cli；缺失时不要静默跳过检查 |


## 未安装（不要假设存在）

`fd`、`fzf`、`delta`、`bat`、`eza`、`tree`、`httpie`、`psql`、`redis-cli`、`docker-compose`（旧式独立二进制）。

需要时用等价方案：

- 找文件：`git ls-files` 或 `rg --files`
- 看目录树：`git ls-files | sed 's#/[^/]*$##' | sort -u`
- 结构化预览：`jq . file.json`

## 选型原则

1. 已有工具能做的事，不装新工具。
2. 需要新依赖时先说清体积与维护成本。
3. 一次性任务用脚本，长期复用才固化成技能或命令。
4. 跨平台命令优先用 Node 脚本，避免 shell 方言差异。

## Windows 注意

- 路径用正斜杠或双反斜杠；`~` 在 Node 里不会自动展开。
- `findstr` 与 `grep` 语义不同，优先用 `rg`。
- 端口查询：`netstat -ano | findstr :<port>`。
- 结束进程只按 PID：`taskkill /PID <pid> /F`。
