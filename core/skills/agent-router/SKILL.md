---
name: agent-router
description: "任务自动分派到对应子代理战队：离线关键词路由表 + TF-IDF 兜底，输出 team-lead 与领域。触发：新任务开始、需要派活、不确定用哪个角色、团队协作。"
description_zh: "接到任务先判它属于哪个领域、该派给哪支战队，毫秒级出结果，不用人点名。"
license: MIT
metadata:
  version: "1.0"
  category: meta
  pattern: single-task
  tier: standard
---

# 角色路由（任务 → 战队）

回答一个问题：**这个任务该派给哪支子代理战队？** 输出 team-lead 名字，由 lead 在队内再分派叶子角色。

路由到 lead 而不是叶子角色，是因为 220 个叶子角色之间重叠严重（`backend-engineer` / `api-designer` / `database-engineer` 边界模糊），直接路由噪声大且不稳定；18 个 lead 边界清晰，且每个 lead 本就负责队内拆分。

## 用法

```bash
python3 scripts/agent_router.py "<任务原文>" --agents-dir <agents 目录> --top 3
python3 scripts/agent_router.py "<任务>" --json
```

Windows 用 `python`。输出：

```
verdict: USE AGENTS  (via table)
    11.00  software-team-lead           命中: 重构/接口  [软件开发 / 通用工程]
```

`via` 表示命中来源：

| via | 含义 | 可靠性 |
|---|---|---|
| `table` | 命中人工维护的领域关键词表 | 最高，优先使用 |
| `lead` | 描述相似度命中某个 team-lead | 中 |
| `leaf` | 只有叶子角色命中（无 lead 匹配） | 低，建议人工确认 |
| `fallback` | 全部未命中，落到默认战队 | 最低 |

## 三个判定层次

1. **领域表**（`references/routes.json`）：19 个领域的 lead + 关键词 + **priority 动作动词** + 排除词。改这里比改 220 条描述可靠得多。
2. **描述相似度**：TF-IDF + CJK bigram，强制优先 team-lead。
3. **兜底**：`fallback.lead`，默认 `software-team-lead`。

**priority 词很关键**：它识别「动作意图」而不是「名词对象」。例如「翻译这份合同」——「合同」指向法务，但「翻译」才是用户要的动作，所以 priority 给 8 分权重，正确判给翻译队。

## 维护路由表

`references/routes.json` 每条：

```json
{
  "lead": "translation-team-lead",
  "domain": "翻译 / 本地化",
  "keywords": ["翻译", "中译英", "本地化"],
  "priority": ["翻译", "中译英", "本地化"],
  "exclude": ["同传设备采购"]
}
```

- `keywords`：领域名词，用于召回。
- `priority`：动作动词，出现即强烈指向该队。
- `exclude`：反例短语，命中就跳过该条（防止「财务报表」被判成数据分析）。

新增战队时同步加一条；删战队时删对应条。

## 判定边界

- 只有 `table` 或 `lead` 命中时，才建议直接派发。
- `leaf` / `fallback` 命中时，先看候选描述再决定，或按领域自行改判。
- 任务跨多个领域（「既要设计海报又要写文案」）→ 主领域派 lead，其余作为协作方，或交 `project-director`。

## 与后续步骤衔接

`intent-recognition`（判目标与定位）→ **`agent-router`（判领域与战队）** → `skill-router`（判技能）→ lead 派活 → 验收。
