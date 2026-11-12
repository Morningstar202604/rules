# 开发链：按需选择技能与工具

以任务风险和验收标准选择，不是每次都加载全套；技能是宿主能力，实际以当前会话提供的清单为准。本文根据本次可见仓库资料和本机检查整理；此前调研的原始对话当前不可访问，不能声称已完整复用。

| 阶段 | 按需技能（本次宿主可用） | 工具与产出 |
|---|---|---|
|需求与勘察 | `intent-recognition`、`repo-cartography` | `rg`、Git 状态和现有文档；明确目标、约束、影响面和验收。 |
|设计与切片 | `senior-architect`、`task-slicing`；接口变更用 `api-design-reviewer` | 沿用项目技术栈，按风险确定契约、迁移和回滚。 |
| 实现与调试 | `aqg-code-construction`（高风险）、`systematic-debugging`；按语言选 `typescript` / `python` / `rust` | 编辑既有代码，复现问题并覆盖失败路径；不为流程引入依赖。 |
| 测试与安全 | `testing`、`frontend-testing-debugging`、`security-scan`；必要时 `deep-security-scan` | 优先项目已有测试；浏览器关键路径按需用 Playwright；密钥与静态扫描按需评估 Gitleaks、Semgrep，人工复核结果，避免输出敏感值。 |
| 审查与交付 | `code-review`、`verification-before-completion`；部署时 `ci-cd-pipeline-builder` | 检查差异、运行适合改动的验证，记录证据、未覆盖项和回滚；提交、推送须按授权。 |

## Windows 与许可核实

核实日期：2026-11-12。下表是所引用资料当时的描述，具体版本及组件应在采用前复核；许可证不是法律意见。

| 工具 | 官方 Windows 信息 |许可与边界 |
|---|---|---|
| Playwright | [系统要求](https://playwright.dev/docs/intro)列 Windows11+、Windows Server2019+ 或 WSL；本机 Windows10 不满足所列原生 Windows版本要求。 | [官方 npm 包](https://www.npmjs.com/package/playwright)标识 Apache-2.0；浏览器及其他组件的许可另行核实。 |
| Gitleaks | [官方 release API](https://api.github.com/repos/gitleaks/gitleaks/releases/latest)列出8.30.1 的 Windows x64、x32、arm64 压缩包，证明提供对应构建，不等同于本机运行验证或完整支持政策。 | [项目许可证](https://raw.githubusercontent.com/gitleaks/gitleaks/master/LICENSE)为 MIT；[官网](https://gitleaks.io/)说明 GitHub Action 的组织仓库需要免费 key，不能把 Action 条款等同 CLI许可。 |
| Semgrep | [官方快速入门](https://docs.semgrep.dev/getting-started/quickstart)将 Windows 支持标为 beta，列出原生安装和 Docker方案；[项目 README](https://raw.githubusercontent.com/semgrep/semgrep/develop/README.md)也提及 WSL。版本、架构和功能兼容性需实际确认。 | [开源仓库](https://raw.githubusercontent.com/semgrep/semgrep/develop/README.md)标识 LGPL-2.1，部分规则为专有；[许可证原文](https://raw.githubusercontent.com/semgrep/semgrep/develop/LICENSE)为 LGPL2.1。商业服务、规则和其他组件须分别核实，不能一概视为同一许可。 |

## 本机证据与局限

- 在当前 Git Bash 中用 `command -v` 检查：Git、Node、npm、npx、Python、Playwright、ripgrep、WSL 命令在 PATH；版本分别验证 Git2.56.1、Node24.22.2、npm11.19.1、Python3.15.2、Playwright1.65.0、ripgrep14.1.1。
- `gitleaks`、`semgrep`、`docker`、`go`、`cargo`、`gh` 未在当前 PATH 找到，不代表全机未安装。WSL只检查到入口，未验证发行版；Playwright只验证 CLI版本，未验证浏览器安装或运行。未读取秘密、安装工具或执行扫描。
- 技能名称来自当前宿主提供的技能清单；仓库的完整技能目录另见 [SKILLS.md](SKILLS.md)，不代表全部均在当前宿主可调用。工具与许可信息会变化，实际采用时复核官方资料与目标版本。
