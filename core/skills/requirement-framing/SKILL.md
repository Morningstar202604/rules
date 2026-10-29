---
name: requirement-framing
description: "需求模糊时的快速五问速查：真实目标、成功判据、范围边界、约束、未知与假设。需要完整意图识别（含项目定位、干系人、验收定义）时用 intent-recognition。触发：需求不清、先想清楚再动手。"
license: MIT
metadata:
  version: "1.1"
  superseded_by: intent-recognition
---

# 需求框定（速查版）

完整版见 `intent-recognition`——它覆盖意图、项目定位、约束、验收四层，并给出输出模板与反模式。

本技能只保留最小五问，供一句话快速自检：

1. **真实目标**：去掉手段，留下结果。
2. **成功判据**：怎么判断做完了？可观察、可执行、可复现。
3. **范围边界**：必须改什么、明确不改什么。
4. **约束**：技术栈、既有约定、性能/安全/兼容、不可逆操作。
5. **未知与假设**：缺什么信息？按最合理默认值补全并标注「假设」。

判断不了方向时按 AGENTS.md「五方案对比 → 自选最优 → 直接执行」，不阻塞。

后续衔接：`intent-recognition` → `skill-router` → `task-slicing` → 开工 → `delivery-quality-bar` 收口。
