---
name: process-and-artifact-ledger
description: "维护运行中进程、未完成任务、改动文件与交付物的台账；项目内不强制每轮清理，项目收尾才统一完结。触发：起服务、多轮开发、进程管理、收尾清理。"
license: MIT
metadata:
  version: "1.0"
---

# 进程与产物台账

核心原则：**记录要实时，清理要统一。** 每轮都关进程会浪费重启成本、丢掉现场；完全不管则必然泄漏。折中方案是台账 + 项目级收尾。

## 台账工具

安装目录下的 `hooks/ledger.js`：

```bash
node <规则目录>/hooks/ledger.js status
node <规则目录>/hooks/ledger.js add-proc --cmd "pnpm dev" --pid 12345 --port 5173
node <规则目录>/hooks/ledger.js rm-proc --pid 12345
node <规则目录>/hooks/ledger.js add-file --path src/app.tsx
node <规则目录>/hooks/ledger.js artifact --note "构建产物 dist/"
node <规则目录>/hooks/ledger.js phase active|closing|done
```

`status` 会把台账渲染进记忆文件的「资源台账」区块。

## 生命周期

| 阶段 | 要求 |
|---|---|
| `active` | 起进程立即登记（pid/端口/命令/目录）；文件改动自动记录；**不要求**关闭进程 |
| `closing` | 用户宣布收尾或全部切片完成；逐项停进程、清临时文件、跑全量验证 |
| `done` | 台账归零，可以开新项目 |

## 启动前

1. 查端口占用：`netstat -ano | findstr :<port>`（Windows）/ `lsof -i :<port>`。
2. 被占用就换端口，不要杀掉占用者。
3. 启动后立即 `add-proc`，PID 必须来自真实输出。

## 收尾时

1. 按台账逆序停止**本轮启动的**进程。
2. 再查一次端口确认释放。
3. 清理临时文件与调试脚本。
4. `phase done`，台账渲染为空。

## 容器与临时栈

`docker run` / `docker compose up` 起的容器同样用 `add-proc` 登记；收尾时 `docker stop` + `docker rm`（compose 用 `down`）。临时数据库、虚拟环境、构建缓存一并清理。系统已装的软件与用户既有服务一律不动。

## 异常退出兜底

进程无法正常停止时，把 PID、端口、残留路径写进记忆文件「待办与阻塞」，并给出恢复命令；不得静默留下一堆后台服务。

## 禁止

- `taskkill /f /im node.exe`、`killall -9` 之类按名字批量杀。
- 关闭不是本轮启动的进程。
- 删除他人目录。
- 每轮结束就关服务（除非用户要求）。

## 泄漏判定

进程条目带 pid/port 的，可通过端口探测判断是否仍存活；无端口条目超过 10 分钟自动视为历史记录，不再阻断收尾。
