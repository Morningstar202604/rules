# 凭据接入（可选）

仓库**不含**任何凭据。本文件说明如何在目标机器上自建一个本地凭据库，供 skill / 脚本读取。不配置不影响规则运行。

## 设计

- 唯一数据源：`~/.agent-secrets/accounts.json`（权限 0600，永不进 Git）。
- 不生成含 token 的派生文件，不写入 `accounts.env` 或 `git-credentials`。
- 上传时由 Git askpass 在子进程内按账号读取本机库，token 不进入 URL、argv 或日志。
- 纪律：不打印、不提交、不外传密钥值；日志只记录"已配置/未配置/探活结果"。

## 最小文件

`templates/secrets/accounts.example.json` 是结构模板：

```json
{
  "version": 1,
  "platforms": {
    "github": {
      "api_base": "https://api.github.com",
      "accounts": {
        "your-account": {
          "token": "<FILL_ME>",
          "status": "unchecked",
          "consumers": []
        }
      }
    }
  }
}
```

## 手动启用

```bash
mkdir -p ~/.agent-secrets && chmod 700 ~/.agent-secrets
cp <repo>/templates/secrets/accounts.example.json ~/.agent-secrets/accounts.json
chmod 600 ~/.agent-secrets/accounts.json
# 编辑填入真实 token，然后直接使用需要凭据的工具；不要 source/eval 任何 token 导出文件。
```

## CLI 与五平台上传

安装器会把 `scripts/accounts_cli.py` 部署到凭据库目录：

```bash
python ~/.agent-secrets/accounts_cli.py list     # 列出账号（不显示 token）
python ~/.agent-secrets/accounts_cli.py check    # 按平台契约探活（GitHub 使用 Bearer，GitCode/Gitee 使用 access_token query）并更新状态
python ~/.agent-secrets/accounts_cli.py path     # 输出凭据库目录
scripts/upload_all.sh                              # askpass 方式同步五个平台
```

`sync`、`store-git`、`env` 仍保留为兼容入口，但会拒绝执行；它们不再生成环境文件、写入 Git 凭据或输出 token。

五平台默认上传（gitcode/badhope、gitee/badhope、github/x33834、github/Morningstar202604、github/badhope，仓库统一命名 `rules`）：

```bash
scripts/upload_all.sh            # 串行推送 + 8s 平台间隔限速
UPLOAD_SLEEP=15 scripts/upload_all.sh   # 调大间隔
```

token 只由 `scripts/git-askpass.sh`（调用 `git-askpass.js`）在 Git 请求密码时从凭据库读入进程内存；推送 URL 只含账号名，不含 token，不写 `.git/config`，日志不输出 token。Windows Git Bash 上传由 `cygpath` 将 MSYS 路径转换为原生路径。

## 与规则联动

`AGENTS.md` 的「本机凭据库（可选）」章节按 `AGENT_SECRETS_DIR`（默认 `~/.agent-secrets`）寻址。若沿用旧版 `~/.zcode/secrets/accounts_cli.py`，把该章节路径改成实际位置即可。

## 已提交密钥的处置

1. 立即在提供方吊销并重新签发。
2. `git filter-repo --path <file> --invert-paths` 清理历史（改写后需 force push，仅限本人仓库）。
3. 通知所有协作者重新 clone。
4. 在本机库更新新 token，重新运行需要凭据的操作；不要运行已停用的 `sync`/`env`。
