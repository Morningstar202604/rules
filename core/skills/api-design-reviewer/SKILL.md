---
name: api-design-reviewer
description: REST/GraphQL 接口契约设计评审专用。当 software-api-designer 产出 API spec、或 software-reviewer 在门禁阶段审查接口正确性/一致性/安全时调用。覆盖资源建模、命名、HTTP 语义、状态码、错误模型、分页过滤、版本演进、GraphQL Schema 设计与 N+1/鉴权风险，输出可勾选评审清单与驳回项。也用于审查新增或变更 API 端点的 PR、存量 API 的 v2 迁移审计、为团队建立 API 规范

license: Apache-2.0
compatibility: Requires network access. No API keys required.
metadata:
  version: "1.0"
  author: awesome-skillkit
  category: api
  pattern: code-reviewer
  tier: powerful
  verified-date: "2026-09-09"
---

# API Design Reviewer / API 设计评审（REST / GraphQL）

用三件工具审查 REST API 设计——对 OpenAPI spec 做规范 lint、检测版本间破坏性变更、给整体设计质量打分——然后附上工具输出汇报发现。本 skill 同时供 **software-api-designer** 自审与 **software-reviewer** 门禁评审共用：目标是在写代码前把接口契约钉死——资源边界清晰、HTTP/GraphQL 语义正确、错误模型统一、鉴权与版本策略明确，避免实现阶段反复返工。

## 这是什么

一份可直接照单勾选的接口评审规程 + 三个自动化工具。它不替代架构师的模块划分，只对「对外暴露的契约」做正确性、一致性、安全性把关。REST 与 GraphQL 两套检查项分列，按需取用：工具负责机械可判定项（命名、方法用法、状态码合规、破坏性变更、质量评分），人工清单负责工具查不出的契约语义、鉴权边界与业务正确性。

## 何时使用

- software-api-designer 写完 OpenAPI / Schema 草稿，准备交接实现前。
- software-reviewer 在门禁阶段看到 PR 改动了路由、Schema、错误码或鉴权逻辑。
- 审查一个新增或修改 API 端点的 PR、审计现有 API 是否可平滑迁到 v2、为团队建立 API 规范。
- 跨团队对齐接口、或评审一份第三方 API 对接方案。
- 不用于：实现 API 端点或生成客户端 SDK。

## 方法论：评审核心步骤

1. **先定资源再定动作**：列出本次涉及的实体（资源）、它们之间的关系（1:1 / 1:N / N:M），确认每个资源有明确命名与生命周期。
2. **REST 检查**：用名词复数建模集合，用嵌套表达从属；动作通过 HTTP 方法表达而非塞进 URL。
3. **GraphQL 检查**：核对 Query/Mutation 边界、类型 nullable、输入用 `input` 类型、分页用 connection/edges 或游标。
4. **错误模型统一**：所有失败返回同一结构（code / message / trace_id / details），不靠 200 包业务错误。
5. **鉴权与版本**：逐端点标注谁能调、需要什么 scope；破坏性变更走版本号或 deprecation 头。
6. **输出评审结论**：按 critical / major / minor 分级，每条给「问题—依据—建议改法」；工具裁决（approved / not approved）见下方工作流步骤 4。

## 输入清单

| 输入 | 必需 | 说明 |
|---|---|---|
| OpenAPI/Swagger spec（JSON） | 是 | 当前版规范文件路径，如 `openapi.json`；无 spec 时可用 `--sample` 内置样例 |
| 旧版 spec | 仅破坏性变更检测时 | 与新版对比的旧规范文件路径 |
| 最低通过等级 | 否 | `api_scorecard.py --min-grade A\|B\|C\|D\|F`，默认无门槛 |
| 输出格式 | 否 | `--format text\|json`，CI 场景用 json |

输入缺失时一次性问齐："请提供：① 待审查的 OpenAPI/Swagger JSON 文件路径；② 若要做破坏性变更检测，旧版 spec 路径；③ 最低通过等级（不填默认 B）。"

## 前置自检

逐条执行，任一失败 → 按修复处置后 STOP：

```bash
# 1. Python 3 可用
python3 --version
# 预期：Python 3.8+。

# 2. 三个工具脚本存在
ls scripts/api_linter.py scripts/breaking_change_detector.py scripts/api_scorecard.py
# 预期：三个文件名（在技能目录内执行）。失败→cd 到技能目录后重试；仍缺→STOP 回报。

# 3. spec 文件可读且为合法 JSON
python3 -c "import json,sys; json.load(open('<spec>'))" && echo OK
# 预期：OK。失败→按仓库实际结构推断 spec 路径与格式；无法推断时采用最常见约定继续，并在交付中标注假设。
```

## 工作流

命令在技能目录（`skills/api-design-reviewer/`）内执行。无现成 spec 时可用随包样例 `examples/spec.json`（与 `--sample` 内置样例同源）。

### 步骤 0：内置样例体验（可选）

```bash
python3 scripts/api_linter.py --sample   # 无 spec 时先用内置样例熟悉输出结构
```

### 步骤 1：Lint 规范

```bash
python3 scripts/api_linter.py examples/spec.json --format json --output lint.json   # 你的真实 spec 换成 openapi.json
```

- **动作**：检查资源命名（资源 kebab-case、字段 camelCase）、HTTP 方法用法、URL 结构、状态码合规、错误响应结构一致性、文档覆盖度。
- **预期**：生成 `lint.json`；无致命项时退出码 0。
- **若失败**：JSON 内含 violation 明细 → 逐条整理为发现清单（含文件/路径定位），进入步骤 3 一并报告。

### 步骤 2：破坏性变更检测

```bash
python3 scripts/breaking_change_detector.py openapi-v1.json openapi-v2.json --format json --exit-on-breaking --output breaking.json
```

- **动作**：对比两版 spec，检出端点删除、响应结构变化、字段删除/改名、类型变更、新增必填字段、状态码变更，并给出影响严重度。
- **预期**：退出码 0（无破坏性变更）；或破坏项已全部被版本号提升（version bump）覆盖。
- **若失败**：`--exit-on-breaking` 使其检出破坏项时以非零退出 → 把每项破坏性变更列入报告，标记"需 version bump 或回退"。

### 步骤 3：设计评分

```bash
python3 scripts/api_scorecard.py examples/spec.json --format json --output scorecard.json   # 加 --min-grade B 即为门禁模式（等级低于门槛时退出码非 0，报告仍完整输出）
```

- **动作**：五维评分——Consistency 30%、Documentation 20%、Security 20%、Usability 15%、Performance 15%，输出 0-100 分与 A-F 等级、改进建议。
- **预期**：等级 ≥ `--min-grade`（上例 B），退出码 0。
- **若失败**：等级低于门槛 → 输出报告但裁决为 "not approved"，附 scorecard 中的改进项。

### 步骤 4：汇总裁决

- **动作**：向用户报告 lint 发现 + 破坏性变更 + 等级。禁止仅凭文字评审签收——必须附三个工具的输出。
- **预期**：lint 无 violation（或已全部接受）、`--exit-on-breaking` 通过（或破坏项已 version bump）、等级 ≥ 约定门槛，三项齐备裁决 "approved"。
- **若失败**：用户修复 spec 后，从步骤 1 重跑全流程。

## REST 评审清单

- [ ] URL 为名词复数（`/orders`），动词在方法（GET/POST/PUT/PATCH/DELETE），未出现 `/getOrder` `/createUser`。
- [ ] 状态码语义正确：201 创建、204 删除成功、400 参数错、401 未认证、403 无权限、404 不存在、409 冲突、422 语义校验失败、429 限流、500 服务端错。
- [ ] 列表接口有分页（`page/cursor` + `size/limit`）、总数估算、排序参数，且默认排序稳定可复现。
- [ ] 过滤/字段裁剪/扩展通过查询参数，未把动态条件堆进路径段。
- [ ] 创建返回 201 且 `Location` 头指向新资源；幂等写操作（PUT）可安全重试。
- [ ] 时间统一 ISO-8601 UTC，金额用最小单位整数或明确精度，枚举固定取值集。
- [ ] 敏感字段（密码、手机号、内部 ID）不出现在响应里；错误信息不泄露堆栈/SQL。

## GraphQL 评审清单

- [ ] Query 只读、无副作用；写操作走 Mutation；订阅走 Subscription。
- [ ] 避免 N+1：列表字段有数据加载器（dataloader）或批量解析，N+1 已压成 O(1)~O(logN)。
- [ ] 每个字段/类型标注鉴权指令（`@auth`/`@hasRole`），敏感节点在解析层二次校验。
- [ ] 分页用游标或 connection，禁止无上限的 `allUsers` 这类全量字段；设最大复杂度/深度上限。
- [ ] 输入用 `input` 类型，错误放进 `errors` 或领域错误联合类型，不吞成 null。
- [ ] Schema 有变更演进策略（废弃字段标 `@deprecated`，不直接删）。

## 错误与安全模板

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "订单不存在或无权访问",
    "trace_id": "req-7f3a...",
    "details": { "order_id": "88421" }
  }
}
```

- 鉴权失败一律 401/403，不透露「用户存在但密码错」这类枚举信息。
- 批量/导入接口必须设条数上限与幂等键，防止重放与放大。

## 参数速查表

| 参数 | 取值 | 说明 |
|---|---|---|
| `--format` | text / json | 输出格式；CI 用 json |
| `--output` | 文件路径 | 写入文件（三脚本均无 `-o` 短选项，必须用全称） |
| `--exit-on-breaking` | 布尔 | breaking_change_detector 检出破坏项时非零退出，作 CI 门禁 |
| `--min-grade` | A / B / C / D / F | api_scorecard 低于该等级非零退出，作 CI 门禁 |
| `--sample` | 布尔 | api_linter 用内置样例 spec，无需输入文件 |
| `--raw-endpoints` | 布尔 | api_linter 接受原始端点清单 JSON 而非完整 spec |

## 失败处置表

| 现象/错误码 | 原因 | 处置 |
|---|---|---|
| `unrecognized arguments: -o` | 用了不存在的短选项 | 改用 `--output` |
| `json.decoder.JSONDecodeError` | spec 非 JSON（可能是 YAML） | 请用户提供 JSON 格式 spec 或先转换，STOP |
| 退出码非 0 且无输出文件 | 检出门禁失败项（`--exit-on-breaking`/`--min-grade`） | 读 stdout/JSON 报告，属正常门禁行为，按发现项处置 |
| `FileNotFoundError` | 不在技能目录执行 | `cd` 到技能目录，或改用脚本绝对路径 |
| breaking 项无法修复 | 上游接口约束 | 报告给用户决策：version bump 或接受并书面记录 |

## 交付标准

- 成功定义：三工具全部运行完毕，报告含 lint 发现清单、破坏性变更清单、等级分数；裁决词只能是 "approved" 或 "not approved"（附依据）。
- 产物命名：`lint.json`、`breaking.json`、`scorecard.json`（或用户指定名）。
- 保存位置：默认当前目录，或用户指定的输出目录。
- 完整性验证：三个文件均可被 `json.load` 解析且非空；报告引用了各文件的 `overall_score`/等级原文。

## 参考

- `references/rest_design_rules.md` — REST 命名、方法、状态码、分页、错误格式的完整规则集；解读 lint violation 或回答"应该怎么改"时读。
- `references/api_antipatterns.md` — 常见反模式及修复方案；lint 大量命中或用户要求"找出反模式"时读。

## CI 集成

```yaml
- name: "api-linting"
  run: python scripts/api_linter.py openapi.json --output lint.json

- name: "breaking-change-detection"
  run: python scripts/breaking_change_detector.py openapi-v1.json openapi-v2.json --exit-on-breaking

- name: "api-scorecard"
  run: python scripts/api_scorecard.py openapi.json --min-grade B
```

## 易错点

- **把 CRUD 当 RPC**：在 URL 里塞动词（`/api/doLogin`），导致无法缓存、无法复用 HTTP 语义。
- **200 包错误**：HTTP 200 但 body 里 `success:false`，网关/监控无法按状态码告警。
- **分页漏总数/漏稳定排序**：翻页时数据漂移、重复或丢失。
- **GraphQL 不设深度/复杂度上限**：一个恶意深嵌套查询打垮服务。
- **破坏性改动直接上线**：未走版本/废弃周期，老客户端全挂。
- **评审只看风格不看契约**：本 skill 只评正确性/一致性/安全，命名风格偏好不作为驳回理由。
- **只交文字评审**：没有三件工具的输出（lint/breaking/scorecard）不得签收，见工作流步骤 4。
