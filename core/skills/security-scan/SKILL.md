---
name: security-scan
description: 单遍快速仓库安全审计（已合并到 security-audit 的 quick 模式）。当全栈/软件开发团队在门禁阶段需要一轮快速安全检查、接手陌生仓库安全摸底、发版前冒烟式检查时调用。本目录为兼容存根：优先用 `security-audit` 的 quick 模式；该技能不可用时按本文件的内联速查执行。
license: MIT
compatibility: universal
---

# 单遍仓库安全审计（security-scan）— 兼容存根

> **已合并**：本技能内容并入 `security-audit`，对应它的 **quick 模式**（单遍快扫）。
> 新版入口：`security-audit` · 完整原文：`../security-audit/references/legacy-security-scan.md`（仅当 `security-audit` 已安装时该路径存在；否则按下方「内联速查」执行）。
> 本目录保留用于旧引用兼容，触发词与语义不变；需要深度链路追踪、数据流污点分析时，用 `security-audit` 的 **deep 模式**。

## 原来的定位（保留说明）

本 skill 适配**全栈、软件开发**团队的快速门禁。它是「快扫」：一遍过依赖、配置、源码里的常见高危模式，输出分级清单。需要深度链路追踪、数据流污点分析时，改用 deep 模式。

## 何时使用

- PR 合入前的快速安全门禁。
- 接手陌生仓库的第一遍安全摸底。
- 发版前的冒烟式安全检查。

## 怎么执行

1. 优先加载 `security-audit`，按「quick 模式：单遍扫描」六步执行；严重度用它的「统一严重度」表，交付格式用它的「交付物」章节。
2. quick 扫出疑点（注入、越权、密钥泄露）或范围涉及支付/鉴权/多租户/密钥时，按它的升档条件切 deep 模式。
3. `security-audit` 不可用时（例如 `--profile dev` 只装白名单技能），按下面的「内联速查」原样执行，并在交付里说明「走的是存根内联流程」。

## 内联速查（security-audit 不可用时的等价流程）

六步：**依赖体检**（直接依赖的 CVE / 弃用 / 过期版本，区分可利用性）→ **密钥扫描**（硬编码 Key/密码/token/私钥/Webhook，含 git 历史）→ **注入与危险函数**（SQL 拼接、命令拼接、模板注入、反序列化、动态 `eval`）→ **鉴权与会话**（漏鉴权、IDOR、JWT 校验缺失、CORS 过宽）→ **配置与传输**（debug 暴露、堆栈外泄、HTTPS 强制、安全响应头）→ **分级输出**（每条给 `文件:行号` + 风险 + 修复方向）。

检查要点：依赖无未修 critical/high CVE 或有豁免理由；无硬编码密钥；查询参数化/ORM；无 `exec`/`system` 拼用户输入且路径白名单；敏感路由有鉴权且对象级权限在服务端校验；生产关 debug、错误不回堆栈；上传校验类型/大小且不可执行；会话/令牌有 expiry + httponly + secure。

分级沿用原四档并按实际可利用性定级：**Critical** 远程直接拿数据/RCE（未授权注入、硬编码生产密钥）；**High** 鉴权缺失、越权、高危依赖漏洞；**Medium** 信息泄露、CORS 过宽、缺安全头；**Low** 日志脱敏不全、补丁滞后。被有效校验挡住的降级或列为已排除；依赖 CVE 必核对版本是否在受影响范围。

完整原文（全部检查清单、易错点与逐条说明）见 `../security-audit/references/legacy-security-scan.md`。
