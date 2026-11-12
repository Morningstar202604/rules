# 上传规范（GitCode / Gitee / GitHub）

本文件是上传的唯一操作口径。目标：全程用 token 直接认证，不弹浏览器/系统凭据窗口；GitHub API 可精确重建本地提交并快进更新分支。

## 一、五条铁律

1. **不走 GCM / 浏览器 / 2FA 弹窗**。出现认证窗口就中止，检查是否漏了 `-c credential.helper=` 或 `GIT_ASKPASS`。
2. **token 不进 URL、argv、日志、仓库、聊天产物**。统一从本机凭据库 `~/.agent-secrets/accounts.json` 读取，由 askpass 或 API 请求头携带。
3. **先提交，再上传**。工作区必须干净；上传的是 `HEAD`，不是未提交的临时文件。
4. **默认 git push；网络错误时走 GitHub API 快进**。API 只在远端 HEAD 是本地祖先时执行：精确重建本地提交对象、校验 SHA，再以 `force:false` 更新 ref 并回读核对。认证、分叉或未知错误立即停止。
5. **上传后必须核对**：远端 ref、标签、描述/topics、CI 结论，缺一不可。

## 二、方式选择

| 情况 | 使用方式 |
|---|---|
| 正常上传 | `bash scripts/upload_all.sh /path/to/repo` |
| GitHub git 443 被重置/超时 | 自动或手动执行 `scripts/gh-api-push.js`：精确重建提交并快进 ref，回读确认远端 HEAD 等于本地 HEAD |
| Gitee/GitCode git 失败 | 先重试/换网络；小增量可用对应平台 contents/commits API，大批量仍应走 git |
| 远端有本地没有的提交 | **停**。先 fetch/merge 并确认快进，禁止 force 或 API 覆盖 |
| 出现认证弹窗 | **停**。不要输入密码，改用 `GIT_ASKPASS` + token |
| 需要改描述/topics | 用平台 API（见第五节），不要为了元数据重传代码 |

## 三、认证规范

所有远端 git 操作：

```bash
git -c credential.helper= \
  -c core.askPass=scripts/git-askpass.sh \
  push https://<host>/<owner>/rules.git HEAD:refs/heads/main
```

`scripts/git-askpass.sh` 从 `AGENT_SECRETS_DIR`（默认 `~/.agent-secrets`）按 `AGENT_GIT_PLATFORM` / `AGENT_GIT_ACCOUNT` 读取 token，只交给 Git 的密码通道。

- GitHub：token 作为 password；用户名可用账号名或 `x-access-token`。PAT 至少需要目标仓库 Contents 读写；触发/查看 Actions 需要 Actions 读权限。
- Gitee / GitCode：token 作为 password；用户名用账号名。API 头分别是 `Authorization: token <token>`（Gitee）和 `Authorization: Bearer <token>`（GitCode）。
- 禁止 `git config --global credential.helper store`，禁止把 token 拼进 remote URL。
- 本机已有 `credential.helper=manager`（GCM）时，必须用 `-c credential.helper=` 覆盖；否则会弹窗。

## 四、GitHub API 快进推送

适用：`github.com:443` 的 git 协议不可用，但 `api.github.com` 可访问。API 不依赖 Git 传输，可直接完成快进推送。

```bash
# 只检查会改哪些文件，不写远端
node scripts/gh-api-push.js <owner> --repo rules --branch main --dry-run

# 精确重建本地提交并快进 main
node scripts/gh-api-push.js <owner> --repo rules --branch main
```

脚本行为：

- 固定本地 `HEAD` 为目标 SHA；读取远端 HEAD，要求它是本地 HEAD 的祖先，否则拒绝。
- 按本地 Git 对象重建缺失的 blob/tree/commit，逐个校验 API 返回 SHA 与本地对象一致；签名提交、子模块或其他无法精确重建的对象直接失败。
- 用 `PATCH /git/refs/heads/main`、`force:false` 更新 ref；若远端在读取后被并发推进，服务端会拒绝非快进更新，脚本失败且不覆盖。
- 更新后回读 ref，只有远端 SHA **精确等于本地 HEAD** 才报告成功。
- 只允许操作脚本所在仓库，不执行其他仓库里的 askpass 或 API 脚本。

token 由脚本从本机凭据库读取，不接受命令行传入。

## 五、平台差异

| 平台 | Git 地址 | API base | 仓库描述 | Topics/标签 | CI |
|---|---|---|---|---|---|
| GitCode | `https://gitcode.com/<owner>/rules.git` | `https://api.gitcode.com/api/v5` | `PATCH /repos/{owner}/{repo}` | API 无 topics 接口；用 git tag | 仓库无 CI 配置则跳过 |
| Gitee | `https://gitee.com/<owner>/rules.git` | `https://gitee.com/api/v5` | `PATCH /repos/{owner}/{repo}`，必须带 `name` | API 无 topics 接口；用 git tag | 仓库无 CI 配置则跳过 |
| GitHub | `https://github.com/<owner>/rules.git` | `https://api.github.com` | `PATCH /repos/{owner}/{repo}` | `PUT /repos/{owner}/{repo}/topics` | Actions；必须轮询到全绿 |

Gitee/GitCode 的 contents/commits API 只适合小增量；没有批量原子提交端点时，大量文件会产生大量 commit，优先修好 git 通道。

## 六、失败处理

| 现象 | 处理 |
|---|---|
| `Authentication failed` / 401 | 检查 token 是否过期、账号名是否对应、scope 是否够；不要重试到锁号 |
| 403 rate limit | 等待重置或换 token；不要并发轰炸 |
| `non-fast-forward` / `fetch first` | 停止；先 fetch/merge；禁止 `--force` 除非用户明确要求并确认 |
| `Connection was reset` / timeout | 重试或换网络；GitHub 用 API 精确重建并快进，最终核对远端 ref 等于本地 HEAD |
| 认证弹窗 | 立即中止；检查 `credential.helper`、`GIT_ASKPASS`、`GIT_TERMINAL_PROMPT=0` |
| CI 红 | 读失败 job 日志，修根因后重新提交；不要用跳过测试的方式变绿 |

## 七、上传后核对

```bash
git ls-remote --heads https://<host>/<owner>/rules.git
git ls-remote --tags  https://<host>/<owner>/rules.git
```

GitHub 还需核对：

- `GET /repos/{owner}/{repo}`：description、topics、default_branch
- `GET /repos/{owner}/{repo}/actions/runs?branch=main&per_page=1`：`conclusion=success`

## 八、凭据暴露

token 一旦出现在聊天、日志、URL、提交或截图里，视为已泄露：立即到平台吊销并重新生成；不要在后续上传继续复用。上传脚本只从本机凭据库读 token，不把 token 写入仓库或安装包。
