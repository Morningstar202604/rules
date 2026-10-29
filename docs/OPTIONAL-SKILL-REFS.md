# 可选技能引用清单

子代理正文里引用了一批**本仓库未收录**的技能名（来自上游技能包体系）。它们不是错误：每条引用都带「调用失败/未安装时退回通用经验，不阻塞」的兜底。

本文件只做登记，方便判断哪些值得补进 core/skills。补进来后，同名引用自动生效。

## 高频（≥10 个角色引用，优先考虑）

| 技能名 | 引用角色数 | 建议 |
|---|---|---|
| `accuracy-and-fact-check` | 28 | 已有同类能力（core-fact-checker 事实核查 / 质量门禁类技能），可直接复用 |
| `deep-research` | 20 | 按需补充 |
| `test-case-generator-v2` | 20 | 按需补充 |
| `lit-review` | 18 | 按需补充 |
| `paper-topic-selector` | 18 | 按需补充 |
| `journal-adapt` | 18 | 按需补充 |
| `content-quality-checklist` | 14 | 已有同类能力（core-fact-checker 事实核查 / 质量门禁类技能），可直接复用 |
| `model-formulator` | 11 | 按需补充 |
| `cross-validation-guide` | 11 | 按需补充 |
| `metric-tree-and-indicator-guide` | 11 | 按需补充 |
| `figure-maker` | 10 | 按需补充 |
| `model-solver` | 10 | 按需补充 |

## 全部清单

| 技能名 | 引用角色 |
|---|---|
| `accuracy-and-fact-check` | academic-peer-reviewer, academic-team-lead, content-reviewer, content-team-lead 等 28 个 |
| `deep-research` | academic-data-visualizer, academic-domain-methodologist, academic-editor-liaison, academic-ethics-reviewer 等 20 个 |
| `test-case-generator-v2` | core-code-reviewer, core-test-engineer, fullstack-accessibility-expert, fullstack-api-designer 等 20 个 |
| `lit-review` | academic-data-visualizer, academic-domain-methodologist, academic-editor-liaison, academic-ethics-reviewer 等 18 个 |
| `paper-topic-selector` | academic-data-visualizer, academic-domain-methodologist, academic-editor-liaison, academic-ethics-reviewer 等 18 个 |
| `journal-adapt` | academic-data-visualizer, academic-domain-methodologist, academic-editor-liaison, academic-ethics-reviewer 等 18 个 |
| `content-quality-checklist` | content-article-writer, content-copywriter, content-editor, content-localization-writer 等 14 个 |
| `model-formulator` | academic-format-guardian, academic-logic-auditor, academic-peer-reviewer, academic-rebuttal-strategist 等 11 个 |
| `cross-validation-guide` | academic-logic-auditor, academic-statistical-methodologist, core-fact-checker, fullstack-performance-engineer 等 11 个 |
| `metric-tree-and-indicator-guide` | data-analysis-team-lead, data-analyst-funnel, data-bi-analyst, data-cleaning-engineer 等 11 个 |
| `figure-maker` | academic-data-visualizer, academic-format-guardian, academic-logic-auditor, academic-peer-reviewer 等 10 个 |
| `model-solver` | academic-format-guardian, academic-logic-auditor, academic-peer-reviewer, academic-rebuttal-strategist 等 10 个 |
| `pdf-pipeline` | academic-format-guardian, academic-logic-auditor, academic-peer-reviewer, academic-rebuttal-strategist 等 9 个 |
| `campaign-brief-template` | marketing-brand-pr, marketing-campaign-executor, marketing-campaign-planner, marketing-content 等 9 个 |
| `marketing-channel-matrix` | marketing-brand-pr, marketing-content, marketing-data-analyst, marketing-growth-hacker 等 9 个 |
| `math-modeling-guosai` | math-data-analyst, math-literature-researcher, math-modeler, math-qa-reviewer 等 9 个 |
| `math-modeling-selfcheck` | math-data-analyst, math-literature-researcher, math-modeler, math-qa-reviewer 等 9 个 |
| `translation-style-guide` | translation-cultural-adaptor, translation-en-to-zh, translation-proofreader, translation-qa-reviewer 等 9 个 |
| `terminology-base-guide` | translation-en-to-zh, translation-localization-manager, translation-proofreader, translation-qa-reviewer 等 9 个 |
| `podcast-quality-checklist` | audio-brand-manager, audio-editor, audio-music-producer, audio-qa-reviewer 等 8 个 |
| `funnel-and-retention-analysis` | data-analysis-team-lead, data-analyst-funnel, data-bi-analyst, data-experiment-designer 等 8 个 |
| `curriculum-design-guide` | education-assessment-designer, education-courseware-writer, education-curriculum-designer, education-data-analyst 等 8 个 |
| `financial-reporting-guide` | finance-accountant, finance-audit-support, finance-budget-planner, finance-cash-manager 等 8 个 |
| `contract-review-checklist` | legal-compliance-officer, legal-contract-reviewer, legal-dispute-handler, legal-document-drafter 等 8 个 |
| `brand-positioning-canvas` | marketing-brand-pr, marketing-campaign-planner, marketing-content, marketing-koc-manager 等 8 个 |
| `product-metrics-guide` | product-data-analyst, product-manager, product-operations, product-prd-writer 等 8 个 |
| `prd-writing-guide` | product-data-analyst, product-experience-reviewer, product-manager, product-prd-writer 等 8 个 |
| `video-quality-checklist` | video-audio-designer, video-caption-subtitle-expert, video-color-grader, video-motion-graphics-designer 等 8 个 |
| `listing-optimization-guide` | ecommerce-cs-lead, ecommerce-listing-optimizer, ecommerce-market-research, ecommerce-ops-team-lead 等 7 个 |
| `pricing-strategy-guide` | ecommerce-logistics-coordinator, ecommerce-market-research, ecommerce-ops-team-lead, ecommerce-pricing-strategist 等 7 个 |
| `quiz-and-exercise-generator` | education-assessment-designer, education-courseware-writer, education-lecturer, education-qa-reviewer 等 7 个 |
| `game-design-document-template` | game-art-director, game-gameplay-designer, game-level-designer, game-narrative-designer 等 7 个 |
| `privacy-compliance-guide` | legal-compliance-officer, legal-contract-reviewer, legal-document-drafter, legal-privacy-officer 等 7 个 |
| `regulatory-watch-guide` | legal-compliance-officer, legal-dispute-handler, legal-labor-law, legal-privacy-officer 等 7 个 |
| `user-research-guide` | product-competitor-analyst, product-experience-reviewer, product-operations, product-qa-reviewer 等 7 个 |
| `translation-qa-checklist` | translation-en-to-zh, translation-localization-manager, translation-proofreader, translation-qa-reviewer 等 7 个 |
| `image-generation-prompt-guide` | visual-ecommerce-designer, visual-illustrator, visual-infographic-designer, visual-logo-designer 等 7 个 |
| `audio-editing-guide` | audio-editor, audio-music-producer, audio-qa-reviewer, audio-sfx-designer 等 6 个 |
| `content-strategy-canvas` | content-article-writer, content-copywriter, content-planner, content-storyteller 等 6 个 |
| `report-and-dashboard-template` | data-analysis-team-lead, data-bi-analyst, data-governance, data-python-engineer 等 6 个 |
| `product-selection-guide` | ecommerce-data-analyst, ecommerce-market-research, ecommerce-ops-team-lead, ecommerce-pricing-strategist 等 6 个 |
| `tax-compliance-checklist` | finance-accountant, finance-audit-support, finance-payroll, finance-qa-reviewer 等 6 个 |
| `game-balance-guide` | game-balance-designer, game-economy-designer, game-gameplay-designer, game-level-designer 等 6 个 |
| `performance-review-framework` | hr-compensation-analyst, hr-employee-relations, hr-performance-manager, hr-qa-reviewer 等 6 个 |
| `interview-guide` | hr-interviewer, hr-jd-writer, hr-performance-manager, hr-qa-reviewer 等 6 个 |
| `marketing-plan-framework` | marketing-campaign-executor, marketing-campaign-planner, marketing-content, marketing-data-analyst 等 6 个 |
| `color-and-typography-guide` | visual-brand-identity-designer, visual-color-theory-expert, visual-logo-designer, visual-print-designer 等 6 个 |
| `multi-platform-adaptation-guide` | content-localization-writer, content-multiplatform-adaptor, content-short-video-scriptwriter, content-social-media-writer 等 5 个 |
| `data-cleaning-guide` | data-analysis-team-lead, data-cleaning-engineer, data-governance, data-python-engineer 等 5 个 |
| `ab-testing-guide` | data-analysis-team-lead, data-experiment-designer, data-qa-reviewer, data-sql-expert 等 5 个 |
| `store-operations-checklist` | ecommerce-data-analyst, ecommerce-logistics-coordinator, ecommerce-ops-team-lead, ecommerce-store-operator 等 5 个 |
| `course-outline-template` | education-courseware-writer, education-curriculum-designer, education-lecturer, education-qa-reviewer 等 5 个 |
| `learning-path-planner` | education-curriculum-designer, education-data-analyst, education-learning-path-planner, education-team-lead 等 5 个 |
| `budget-and-forecast-template` | finance-budget-planner, finance-cash-manager, finance-cost-controller, finance-qa-reviewer 等 5 个 |
| `cost-analysis-guide` | finance-budget-planner, finance-cost-controller, finance-qa-reviewer, finance-report-analyst 等 5 个 |
| `onboarding-checklist` | hr-employee-relations, hr-onboarding-designer, hr-qa-reviewer, hr-team-lead 等 5 个 |
| `jd-writing-guide` | hr-interviewer, hr-jd-writer, hr-qa-reviewer, hr-recruiter 等 5 个 |
| `ip-protection-guide` | legal-contract-reviewer, legal-document-drafter, legal-ip-specialist, legal-qa-reviewer 等 5 个 |
| `growth-experiment-guide` | marketing-campaign-executor, marketing-growth-hacker, marketing-qa-reviewer, marketing-seo-sem 等 5 个 |
| `podcast-script-template` | audio-brand-manager, audio-reviewer, audio-scriptwriter, audio-team-lead |
| `voice-and-mic-guide` | audio-host, audio-scriptwriter, audio-sound-director, audio-team-lead |
| `title-crafting-guide` | content-short-video-scriptwriter, content-social-media-writer, content-team-lead, content-title-expert |
| `game-qa-checklist` | game-prototype-developer, game-qa, game-reviewer, game-team-lead |
| `competitor-analysis-framework` | product-competitor-analyst, product-qa-reviewer, product-team-lead, product-user-researcher |
| `roadmap-and-prioritization` | product-manager, product-qa-reviewer, product-roadmap-planner, product-team-lead |
| `localization-checklist` | translation-cultural-adaptor, translation-localization-manager, translation-subtitle, translation-team-lead |
| `video-script-template` | video-interview-documentary-expert, video-scriptwriter-director, video-short-form-expert, video-team-lead |
| `poster-and-key-visual-templates` | visual-poster-designer, visual-presentation-designer, visual-social-media-designer, visual-team-lead |
| `stripe-best-practices` | core-security-auditor, fullstack-backend-engineer, fullstack-team-lead |
| `customer-service-sop` | ecommerce-cs-lead, ecommerce-ops-team-lead, ecommerce-review-manager |
| `game-economy-guide` | game-balance-designer, game-economy-designer, game-team-lead |
| `design-review-checklist` | visual-asset-manager, visual-design-reviewer, visual-team-lead |
| `copywriting-framework` | content-copywriter, content-team-lead |
| `seo-writing-guide` | content-seo-writer, content-team-lead |
| `helm-chart-builder` | fullstack-devops-engineer, fullstack-team-lead |
| `terraform-patterns` | fullstack-devops-engineer, fullstack-team-lead |
| `kubernetes-operator` | fullstack-devops-engineer, fullstack-team-lead |
| `storyboard-guide` | video-animation-motion-designer, video-storyboard-artist |
| `short-video-structure-guide` | video-scriptwriter-director, video-short-form-expert |
| `ecommerce-visual-checklist` | visual-ecommerce-designer, visual-team-lead |
| `caption-and-subtitle-guide` | video-caption-subtitle-expert |
| `video-editing-guide` | video-editor |
| `design-brief-writer` | visual-team-lead |

## 处理原则

1. **不要为了消除引用而造空壳技能**——空技能比没有更糟（会命中触发词却给不出方法）。
2. 高频且职能明确的优先用现有技能替代：测试类走 test-quality-review，事实核查走 core-fact-checker。
3. 领域模板类（prd-writing-guide、contract-review-checklist 等）已有对应角色正文承载方法论，可长期不补。
