---
name: slo-architect
description: "Define, review and operate SLOs/SLIs and error budgets: burn-rate alerts, multi-window policies, and service level objectives for a service or platform."

license: Apache-2.0
compatibility: Requires network access. No API keys required.
metadata:
  version: "1.0"
  author: awesome-skillkit
  category: incident
  pattern: architecture
  tier: powerful
  verified-date: "2026-09-09"
---

# SLO Architect

定义有意义的 SLO。现实中的多数 "SLO" 是没人信的拍脑袋数字——每个端点都写 99.9%，没有 SLI 定义，没有错误预算，预算烧穿也没人知道该做什么。本技能执行 Google SRE Workbook 的纪律：选对 SLI，定一个用户真正在乎的目标值，算出错误预算，接好多窗口 burn-rate 告警，并写明预算耗尽时的处置策略。

## 何时使用

- 为服务或功能定义新 SLO
- 审查现有 SLO 的常见错误
- 选对 SLI（基于事件 vs 基于时间窗 vs 基于请求）
- 计算错误预算与 burn-rate 告警阈值
- 把 SLO 与现有控制手段挂钩——feature flag 中止、chaos 爆炸半径、operator 能力等级

## 何时不使用

- 泛用可观测性策略（metrics + logs + traces）→ 用 `observability-designer`
- 有法律效力的客户 SLA → 那是合同起草，不是工程
- 性能压测（容量问题，不是可靠性问题）→ 用 `performance-profiler`
- 进行中的事故响应 → 用 `incident-response`

## 输入清单

跑任何工具前一次性收集。缺输入时用这句话向用户问一次："要生成 SLO，请一次性提供：服务名、SLI 类型、目标值、窗口天数、负责人、错误预算策略文档路径（如已有 SLO 文档目录也给 review 用）。"

| 输入 | 必需 | 说明 |
|---|---|---|
| 服务名 | 是 | 如 `checkout-svc` → `--service` |
| SLI 类型 | 是 | `request-success-rate` / `request-latency` / `availability-time` / `data-freshness` / `correctness` 之一 → `--sli-type` |
| 目标值 | 是 | 如 `99.9`（百分比）→ `--target`；从 30 天历史 SLI 数据中取，不要拍脑袋 |
| 窗口天数 | 否 | 默认 28（= 4 个自然周）→ `--window-days` |
| 负责人 | 生效 SLO 必需 | 担责的团队或个人 → `--owner`；缺省渲染 `<must define>` 占位符 |
| 错误预算策略文档 | 生效 SLO 必需 | 书面策略的路径 → `--policy-doc`；缺省渲染 `<must define>` 占位符 |
| SLO 文档目录 | 仅 review 用 | 现有 SLO 定义（markdown/JSON）所在目录 → `--slo-doc` |

## 前置自检

在仓库根目录运行（或本技能目录内运行下文相对路径形式）。第一个失败处停下修复——不要即兴发挥。

```bash
python3 --version        # 预期：Python ≥ 3.8。3 个工具全部仅依赖标准库。
ls scripts/slo_designer.py scripts/error_budget_calculator.py scripts/slo_review.py
                         # 预期：3 个文件全部列出。
```

- Python 缺失或版本过旧 → 安装 Python ≥ 3.8，然后停止（不要用未验证的另一个解释器版本跑工具）。
- 脚本文件缺失 → 目录不对；`cd` 到本技能目录，然后停止并重查。
- 审查现有 SLO？再跑 `ls <slo-doc-dir>` —— 预期：至少一份 `.md`/`.json` SLO 文档。为空 → 把 `--slo-doc` 指向真实目录，或先用 `--sample` 看工具输出形状。

## 快速开始

```bash
# 1. 设计一个 SLO（单行；--owner 与 --policy-doc 为必填约束，缺失退出码 1）
python scripts/slo_designer.py --service checkout-svc --sli-type request-success-rate --target 99.9 --window-days 30 --owner payments-team --policy-doc docs/slo-policy.md

# 2. 计算错误预算 + 多窗口 burn-rate 告警
python scripts/error_budget_calculator.py --target 99.9 --window-days 30

# 3. 审查现有 SLO 定义的常见错误
python scripts/slo_review.py --slo-doc assets/slos/   # 随包达标样例（target/window/numerator/denominator/error budget policy 五要素齐全）；你的真实项目换成 docs/slos/
```

## 三个 Python 工具

全部仅依赖标准库。

### `slo_designer.py`

生成带必填字段的结构化 SLO 定义。缺 `--service`/`--sli-type`/`--target` → argparse 报错，退出码 2。缺 `--owner`/`--policy-doc` → 输出带 `<must define>` 占位符和一行 `WARNING: missing required fields`；占位符填完之前该 SLO 不算生效。

```bash
# 单行用法（下方续行排版仅为可读，复制时合并为一行）：
# python scripts/slo_designer.py \
#   --service checkout-svc \
#   --sli-type request-success-rate \
#   --target 99.9 \
#   --window-days 30 \
#   --owner team-checkout
```

**支持的 SLI 类型：**

- `request-success-rate` — `(total_requests - bad_requests) / total_requests`
- `request-latency` — `count(requests < threshold) / total_requests`
- `availability-time` — `(window - downtime) / window`
- `data-freshness` — `count(data_age < threshold) / total_data_points`
- `correctness` — `count(correct_outputs) / total_outputs`

默认输出 markdown，必填字段要么填好要么标 `<must define>`。JSON 输出（`--format json`）供 `slo_review.py` 消费。

### `error_budget_calculator.py`

给定目标可用性 + 窗口，计算：

- 窗口内允许的停机时长
- 按 Google SRE Workbook（第 5 章）的多窗口 burn-rate 阈值：
  - **Fast burn** — 1 小时内消耗月度预算的 2% 则 page
  - **Slow burn** — 6 小时内消耗 5% 则 page
  - **Ticket burn** — 3 天内消耗 10% 则开工单
- 推荐告警规则（PromQL 形状的输出）

```bash
python scripts/error_budget_calculator.py --target 99.9 --window-days 30
python scripts/error_budget_calculator.py --target 99.95 --window-days 7 --format json
```

### `slo_review.py`

审计 SLO 定义目录（markdown 或 JSON），查常见错误。退出码 0 = 干净，退出码 1 = 有发现项（可当合并前门禁用）。

```bash
python scripts/slo_review.py --slo-doc assets/slos/   # 随包样例 SLO 文档目录；你的真实项目换成 docs/slos/
```

**检查项：**

- `target_too_high`：目标 ≥ 99.99%（只有巨额工程投入才可能持续）
- `target_too_low`：目标 ≤ 99.0%（多半是 SLI 选错；用户会察觉）
- `window_too_short`：窗口 < 7 天（统计噪声占主导）
- `window_too_long`：窗口 > 90 天（反馈太慢）
- `no_sli_definition`：SLI 一节缺失或含糊（"everything OK"）
- `no_error_budget_policy`：预算烧穿时没有书面动作
- `cpu_as_sli`：拿 CPU/内存当用户体验代理（信号选错）

## 参数速查表

| 参数 | 取值 | 说明 |
|---|---|---|
| `--sli-type` | `request-success-rate` / `request-latency` / `availability-time` / `data-freshness` / `correctness` | 仅 designer |
| `--window-days` | 整数，默认 28 | designer + calculator；review 对 <7 或 >90 报发现项 |
| `--target` | 浮点百分比，如 `99.9` | designer + calculator |
| `--format` | `markdown`/`json`（designer），`text`/`json`（calculator、review） | designer 的 JSON 输出喂给 `slo_review.py` |
| `--owner`, `--policy-doc`, `--user-journey`, `--sli-numerator`, `--sli-denominator`, `--sli-labels`, `--review-cadence` | 自由文本 | designer；缺 owner/policy → `<must define>` |
| `--slo-doc` | 文件或目录路径 | 仅 review；`--sample` 审计内置示例 |

## SLI 选型速查

| 用户体验问题 | SLI 类型 | 度量方式 |
|---|---|---|
| "请求成功了吗？" | request-success-rate | `2xx / total` |
| "响应够快吗？" | request-latency | `count(p99 < threshold) / total` |
| "服务在线吗？" | availability-time | `(window - downtime) / window` |
| "数据是最新的吗？" | data-freshness | `count(data_age < threshold) / total` |
| "答案正确吗？" | correctness | `count(correct) / total` |

示例与反模式见 `references/sli_design.md`。

## 错误预算数学（基础）

以 30 天窗口的 99.9% SLO 为例（对应 `error_budget_calculator.py --target 99.9 --window-days 30`）：

- 允许不可用：`0.1% × 30 × 24 × 60 = 43.2 minutes`
- Fast burn：1 小时烧掉预算的 2% → burn-rate 倍数 `0.02 / (1/720) = 14.4`
- Slow burn：6 小时烧掉预算的 5% → 倍数 `0.05 / (6/720) = 6.0`
- Ticket burn：3 天烧掉预算的 10% → 倍数 `0.10 / (72/720) = 1.0`

`error_budget_calculator.py` 替你算好并输出可直接粘贴的告警规则。

## 与组合内其他技能的协同

本技能明确与以下三个技能协同：

| 技能 | 协同方式 |
|---|---|
| `feature-flags-architect` | 灰度中止条件引用 SLO burn-rate 阈值 |
| `chaos-engineering` | 爆炸半径计算器已把月度错误预算当输入——在这里定义它 |
| `kubernetes-operator`（未安装） | operator 能力 L4 要求 SLO + Prometheus 规则，需要时另行安装 |

`error_budget_calculator.py` 的输出与 chaos-engineering 技能的 `blast_radius_calculator.py` 在 stdin 期望的形状一致。

## 工作流

### 工作流 1：定义一个新 SLO

#### 步骤 1：收集输入并锁定用户旅程

- **动作：** 确定要保护的用户旅程（如 "checkout completion"）；一次性收集输入清单。
- **预期：** 一句书面旅程描述，加上服务名、SLI 类型、负责人、策略文档路径。
- **失败时：** 用户说不出旅程 → 不要编造；问哪个面向用户的流程出故障最伤收入。

#### 步骤 2：选择并定义 SLI

- **动作：** 按速查表选 SLI 类型；用具体 label 定义分子/分母（或传 `--sli-numerator`/`--sli-denominator`/`--sli-labels`）。
- **预期：** 一句 SLI，形如 `count(http_requests_total{status=~"2..|3.."}) / count(http_requests_total)`——绝不是 "everything OK"。
- **失败时：** 只想得到系统指标（CPU/RAM）→ 这就是 `cpu_as_sli` 错误；重读 `references/sli_design.md`，选一个请求级 SLI。

#### 步骤 3：从历史数据定目标

- **动作：** 度量最近 30 天的 SLI；`target = floor(p50 × 100) / 100`。
- **预期：** 系统已经实际达到过的目标——不是愿望值。
- **失败时：** 没有历史数据 → 先部署 SLI 度量，30 天后再来；不要猜。

#### 步骤 4：渲染 SLO 定义

- **动作：** `python scripts/slo_designer.py --service <svc> --sli-type <type> --target <t> --window-days 28 --owner <team> --policy-doc <path>`
- **预期：** markdown 输出无 `<must define>` 占位符，无 `WARNING: missing required fields` 行。
- **失败时：** 退出码 2 → 缺必填 flag，按报错补上；输出有 `<must define>` → 补 `--owner`/`--policy-doc` 重跑。

#### 步骤 5：生成 burn-rate 告警

- **动作：** `python scripts/error_budget_calculator.py --target <t> --window-days <w>`
- **预期：** 输出列出 `fast_burn`、`slow_burn`、`ticket_burn` 行，带 `burn rate` 值与 PromQL 形状规则。
- **失败时：** 允许停机显示 `0` → 100% 目标不是 SLO；换一个现实的目标值。

#### 步骤 6：写错误预算策略

- **动作：** 填 `assets/error_budget_policy.md`（预算 <50% / <10% / 耗尽时 → 谁做什么）。
- **预期：** 策略文档提交入库，并从 SLO 定义链接过去。
- **失败时：** 团队不肯承诺后果 → SLO 只是装饰；先升级再继续。

#### 步骤 7：上线前 review

- **动作：** `python scripts/slo_review.py --slo-doc <dir-or-file>`
- **预期：** 退出码 0，无 FAIL/WARN。
- **失败时：** 退出码 1 → 修每条 `[FAIL]` 行（降目标、定义 SLI、补策略链接），重跑直到退出码 0。

### 工作流 2：季度 SLO 复盘

#### 步骤 1：对所有活跃 SLO 跑 review 门禁

- **动作：** `python scripts/slo_review.py --slo-doc assets/slos/   # 随包样例 SLO 文档目录；你的真实项目换成 docs/slos/`
- **预期：** 退出码 0；任何 `[FAIL]`/`[WARN]` 行都是一个工作项。
- **失败时：** 先修发现项；不要在同一个变更里同时调目标和调检查。

#### 步骤 2：用上季度数据校准目标

- **动作：** 对每个 SLO 决策：从没烧过 → 收紧；反复烧 → 放宽目标或修系统；告警没用 → 调阈值。
- **预期：** 每个 SLO 在复盘结束时有 keep/tighten/loosen 决定记录在案。
- **失败时：** 没收集烧穿数据 → SLI 根本没被度量；回到工作流 1 步骤 2。

#### 步骤 3：审计策略执行并归档

- **动作：** 核查预算烧穿时错误预算策略是否真被执行；提交修订后的 SLO，带日期戳归档旧版。
- **预期：** 修订文档已提交；归档可按日期检索。
- **失败时：** 策略连续两次被无视 → 问题是组织性的，不是数字的；升级到归属团队的 lead。

### 工作流 3：SLO 驱动的回滚

#### 步骤 1：发现异常烧穿

- **动作：** burn-rate 告警由工作流 1 步骤 5 生成的阈值触发。
- **预期：** 告警写明 SLO、窗口和当前 burn rate。
- **失败时：** 告警缺这些字段 → 阈值被手改过；用计算器重新生成。

#### 步骤 2：经 kill switch 回滚

- **动作：** 触发 feature-flag kill switch（见 `feature-flags-architect`）；确认新发布停止烧预算。
- **预期：** 一个告警窗口内 burn rate 回到基线。
- **失败时：** 回滚后仍在烧 → 回归不是这次发布造成的；转开事故。

#### 步骤 3：把复盘结论喂给下一版修订

- **动作：** 记录烧了什么、为什么、目标值定得对不对。
- **预期：** 复盘 action items 引用具体的 SLO 参数变更。
- **失败时：** 修订没有负责人 → SLO 会烂掉；收尾前指派。

## 失败处置表

| 症状 / 退出码 | 原因 | 修复 |
|---|---|---|
| `slo_designer.py` 退出码 2 | 缺必填 flag（`--service`/`--sli-type`/`--target`） | 按 argparse 报错补 flag 重跑 |
| `WARNING: missing required fields: owner, error_budget.policy_doc` | 未传 `--owner`/`--policy-doc` | 两项都补上；占位符清零前 SLO 不生效 |
| `slo_review.py` 退出码 1 带 `[FAIL] ...` | SLO 文档命中 7 种错误模式之一 | 逐条修复，重跑直到退出码 0 |
| `[FAIL] cpu_as_sli` | 选了 CPU/内存当 SLI | 换请求级 SLI（见速查表） |
| 计算器输出允许停机 `0.00 min` | 目标 ≈ 100% | 选一个系统历史上真正达到过的目标 |
| `python: command not found` | 无解释器 | 安装 Python ≥ 3.8；所有工具仅依赖标准库 |
| 计算器 burn rate 与本文档数学不符 | `--target`/`--window-days` 不同 | 符合预期——本文数字按 99.9%/30d 算；以工具对你输入的计算为准 |

## 参考

仅在对应情况出现时读——不要预载全部三个：

- `references/sli_design.md` —— 选 SLI 类型时，或 `slo_review.py` 报 `no_sli_definition`/`cpu_as_sli` 时；5 种 SLI 类型带示例与反模式。
- `references/error_budget.md` —— 计算预算、调 burn-rate 告警、写错误预算策略时。
- `references/composition.md` —— 把 SLO 接入 feature flag 中止、chaos 爆炸半径、operator 能力等级时。

（SLI 与 SLO 与 SLA 的基本概念全程以 Google SRE Workbook 为准。）

## 斜杠命令

`/slo-design` —— 交互式 SLO 设计向导，依次跑全部 3 个工具。（该斜杠命令未随包收录——本包不含 `commands/` 目录；请直接按本 SKILL.md 的工作流依次运行 3 个工具。）

## 资产模板

- `assets/slo_template.yaml` —— 可填写的 SLO YAML
- `assets/error_budget_policy.md` —— 可填写的策略模板

## 反模式

- **每个端点都 99.99%** —— 复制粘贴的 SLO，没人验证过系统能否持续达到
- **CPU 用量当 SLI** —— 系统指标不是用户体验
- **单窗口 burn-rate 告警** —— 5 分钟窗太吵，30 天窗太钝
- **没有错误预算策略** —— 没有动作的烧穿等于没意义
- **SLO 没有负责人** —— 无人担责，必然烂掉
- **SLO 一年只 review 一次** —— 系统特征变化比这快得多
- **SLA 写进 SLO 文档** —— 受众不同、利害不同；分开管理
- **SLO 目标 = SLA 目标** —— SLO 必须更紧（要在客户察觉之前先跑赢合同）

## 交付标准

满足以下条件才算跑完本技能：

- SLO 定义（`slo_designer.py` 的 markdown 输出，以渲染标题命名，如 `slo-<service>-<sli-type>.md`）存入团队 SLO 文档目录（如 `docs/slos/`），且**无 `<must define>` 占位符**。
- `error_budget_calculator.py` 的 burn-rate 告警规则已粘贴进告警系统并在测试中真实触发。
- 错误预算策略（按 `assets/error_budget_policy.md` 填写）已提交并从 SLO 文档链接。
- 范围内每个 SLO 跑 `slo_review.py --slo-doc <dir>` 退出码 0。
- 持续要求：命中的 SLO 其 burn-rate 告警每月 ≤2 次（要信号不要噪声）；违规平均发现时间 <30 分钟；季度复盘真的按季度发生。
