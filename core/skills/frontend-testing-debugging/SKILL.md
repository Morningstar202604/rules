---
name: frontend-testing-debugging
description: 前端测试与调试规程（正文已并入 frontend-app-builder 的 references/testing-debugging.md）。当全栈团队需要为前端补 E2E/组件测试、或排查页面交互 Bug 时调用。覆盖组件测试、E2E 关键路径、可视回归的组织方式，以及用浏览器/DevTools 定位渲染、状态、网络、交互问题的调试流程，要求先复现再修、断言用户可见行为而非实现细节。
license: MIT
compatibility: universal
---

# 前端测试与调试 — 兼容存根

> **已合并**：完整正文在 `../frontend-app-builder/references/testing-debugging.md`，逐字保留（需 `frontend-app-builder` 同时安装）。
> 本目录保留用于旧引用兼容：触发词、description 与覆盖范围不变，执行时按下面的指路读正文。

## 怎么用

1. 做前端工程/组件实现时，`frontend-app-builder` 正文已指向该分册，跟着读即可。
2. 只做测试或排 Bug 时，直接读 `../frontend-app-builder/references/testing-debugging.md`：
   - 分层选测试（单测 / 组件测试 / E2E）与断言行为 → 见该文的「核心步骤」「测试清单」。
   - 排查交互、样式、数据渲染问题 → 见该文的「调试流程」。
   - 避开脆弱测试与误判 → 见该文的「易错点」。
3. 核心纪律不变：**先稳定复现再修**；断言用户能看到/能操作的行为，不断言内部 state 或实现细节；E2E 只覆盖关键路径，不追求每像素覆盖。
