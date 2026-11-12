---
name: process-and-artifact-ledger
description: "维护运行中进程、未完成任务、改动文件与交付物的台账；本轮起的服务在交付前关闭，构建缓存与依赖目录可跨轮复用。触发：起服务、多轮开发、进程管理、收尾清理。"
license: MIT
metadata:
  version: "1.0"
---

# 进程与产物台账

核心原则：**启动即登记，交付前关闭。** 台账记录的是「本轮起过什么」，不是「长期托管清单」；缓存与依赖目录可以留着复用，进程不能留。

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

`status`读取并显示台账；记录可能缺失或过时，须结合实际进程状态核对，不能视为唯一事实源。

## 生命周期

| 阶段 | 要求 |
|---|---|
| `active` | 起进程立即登记（pid/端口/命令/目录）；文件改动自动记录；**交付前关闭** |
| `closing` | 用户宣布收尾或全部切片完成；逐项停进程、清临时文件、跑全量验证 |
| `done` | 台账归零，可以开新项目 |

例外只有两类：用户明确要求长期运行的（常驻服务、机器人），以及本身就是交付物且要求保留的。这两类登记后说明理由。

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

进程无法正常停止时，在交付中说明 PID、端口及残留路径；允许写入且有价值时记入「待办与阻塞」，并给出恢复命令；不得静默留下一堆后台服务。

## 禁止

- `taskkill /f /im node.exe`、`killall -9` 之类按名字批量杀。
- 关闭不是本轮启动的进程。
- 删除他人目录。
- 未经确认而停止不属于本轮的服务。

## 泄漏判定

端口探测不能证明特定 PID 的存活或归属；无端口或较旧的条目也不能证明进程已经退出，应按实际 PID 和进程状态核对。`stop-guard` 会丢弃超过10 分钟的无端口条目以及端口未开放的条目，因此不能依赖台账完整性。
