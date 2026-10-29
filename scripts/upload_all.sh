#!/usr/bin/env bash
# 五平台默认上传（gitcode/badhope、gitee/badhope、github/x33834、github/Morningstar202604、github/badhope）。
# 串行推送 + 平台间隔限速；token 从本机凭据库读取，不写进 .git/config、不打印。
# 用法：scripts/upload_all.sh [仓库目录] ；环境变量 UPLOAD_SLEEP（秒，默认 8）、UPLOAD_BRANCH（默认 main）
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
VAULT="${AGENT_SECRETS_DIR:-$HOME/.agent-secrets}"
SLEEP="${UPLOAD_SLEEP:-8}"
BRANCH="${UPLOAD_BRANCH:-main}"
ACCOUNTS="$VAULT/accounts.json"

[ -f "$ACCOUNTS" ] || { echo "凭据库不存在：$ACCOUNTS" >&2; exit 1; }
git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "不是 git 仓库：$REPO_DIR" >&2; exit 1; }
git -C "$REPO_DIR" diff --quiet && git -C "$REPO_DIR" diff --cached --quiet || { echo "工作区未提交，先 commit 再上传" >&2; exit 1; }

# 输出：platform<TAB>owner<TAB>push_url（按 gitcode → gitee → github×3 排队）
TARGETS=$(node -e '
const fs=require("fs");
const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const host={gitcode:"gitcode.com",gitee:"gitee.com",github:"github.com"};
const order=["gitcode","gitee","github"];
for(const p of order){const pc=v.platforms[p];if(!pc)continue;
  for(const[u,a]of Object.entries(pc.accounts)){
    console.log([p,u,"https://"+encodeURIComponent(u)+":"+encodeURIComponent(a.token)+"@"+host[p]+"/"+u+"/rules.git"].join("\t"));
  }}' "$ACCOUNTS")

FAILED=0
while IFS=$'\t' read -r platform owner url; do
  [ -n "$platform" ] || continue
  echo "== push $platform/$owner =="
  ok=0
  for attempt in 1 2 3; do
    # 注意：不能写 `git push ... | sed`，管道退出码取的是 sed，会把失败当成功。
    out=$(git -C "$REPO_DIR" push "$url" "HEAD:refs/heads/$BRANCH" 2>&1)
    rc=$?
    printf '%s\n' "$out" | sed -E 's#https://[^@]*@#https://***@#g'
    if [ $rc -eq 0 ]; then
      ok=1
      break
    fi
    echo "!! 第 $attempt 次推送失败：$platform/$owner（exit=$rc），退避后重试" >&2
    sleep $((attempt * 20))
  done
  [ $ok = 1 ] || { echo "!! push 失败：$platform/$owner" >&2; FAILED=$((FAILED+1)); }
  sleep "$SLEEP"
done <<< "$TARGETS"

if [ "$FAILED" -gt 0 ]; then
  echo "完成（$FAILED 个平台失败）" >&2
  exit 1
fi
echo "五平台上传完成（串行，间隔 ${SLEEP}s）"
