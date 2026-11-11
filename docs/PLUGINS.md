# 推荐插件清单

本仓库收录**规则 + 技能 + 子代理 + 命令 + 钩子**；插件由 ZCode 官方市场分发，按需安装。当前 `install.js` 的 `skillSkipNames` 返回空集合，对各工具均安装仓库自带技能，不因同名官方插件而自动跳过；缓存存在不代表插件已启用。用户级技能可能遮蔽官方版本，须按宿主实际优先级检查，确认插件已启用、可发现并可调用后再自行处理冲突；安装器目前不会自动检测或解决此冲突。

## 推荐（官方市场）

| 插件 | 用途 |可能重名的仓库技能 |
|---|---|---|
| `documents` | Word 文档读写与查看 | docx, docx-viewer |
| `pdf` | PDF处理与查看 | pdf, pdf-viewer |
| `presentations` | PPT生成与查看 | pptx, pptx-viewer |
| `spreadsheets` | Excel处理与查看 | xlsx, xlsx-viewer |
| `skill-creator` | 创建/迭代技能 | skill-creator |
| `visualize` | 会话内可视化与交互页 | visualize |
| `browser-use` | 浏览器自动化与网页测试 | — |
| `computer-use` | 原生桌面应用操作 | — |
| `zcode-guide` | ZCode 配置/钩子/MCP/插件诊断 | — |
| `node-repl-host` |受控 JS运行时 | — |

## 按需

| 插件 | 用途 |
|---|---|
| `android-emulator` | Android 构建/模拟器/UI 自动化 |
| `ios-simulator` | iOS 模拟器构建与自动化 |
| `plugin-creator` | 开发自有插件与本地市场 |
| `image-search` | 图片检索 |
| `restore-legacy-sessions` |旧版会话迁移 |

## 新机安装顺序

```bash
git clone https://gitcode.com/badhope/rules.git && cd rules
node install.js --all #规则 + 技能 + 子代理 + 钩子
# 在 ZCode 内按需安装上方插件，并重启会话
```

安装后验证：官方插件必须在宿主的已启用/可发现列表中，并完成一次实际调用；仅有缓存、市场条目或同名目录不算验证。发现同名遮蔽时，按任务需要选择官方或 bundled版本，不要求为了消除重名而强制改动。
