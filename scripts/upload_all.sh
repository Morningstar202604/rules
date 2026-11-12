#!/usr/bin/env bash
# 五平台默认上传（gitcode/badhope、gitee/badhope、github/x33834、github/Morningstar202604、github/badhope）。
# 串行推送 + 平台间隔限速；token 由 Git askpass 从本机凭据库按需读取，不进 URL、argv 或日志。
# 用法：scripts/upload_all.sh [仓库目录]；环境变量 UPLOAD_SLEEP（秒，默认 8）、UPLOAD_BRANCH（默认 main）
# 仅在明确网络错误时尝试 GitHub API 精确重建并快进；UPLOAD_API_FALLBACK=0 可关闭。
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_DIR="${1:-$SCRIPT_ROOT}"
[ "$(cd "$REPO_DIR" && pwd -P)" = "$SCRIPT_ROOT" ] || { echo "拒绝上传外部仓库" >&2; exit 1; }
VAULT="${AGENT_SECRETS_DIR:-$HOME/.agent-secrets}"
if command -v cygpath >/dev/null 2>&1; then
  VAULT="$(cygpath -w "$VAULT")"
  REPO_DIR="$(cygpath -w "$REPO_DIR")"
fi
SLEEP="${UPLOAD_SLEEP:-8}"
BACKOFF="${UPLOAD_BACKOFF:-20}"
BRANCH="${UPLOAD_BRANCH:-main}"
GIT_BIN="${GIT_BIN:-git}"
ACCOUNTS="$VAULT/accounts.json"
ASKPASS="$REPO_DIR/scripts/git-askpass.sh"

[ -f "$ACCOUNTS" ] || { echo "凭据库不存在：$ACCOUNTS" >&2; exit 1; }
[ -f "$ASKPASS" ] || { echo "Git askpass 不存在：$ASKPASS" >&2; exit 1; }
"$GIT_BIN" -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "不是 git 仓库：$REPO_DIR" >&2; exit 1; }
[ -z "$("$GIT_BIN" -C "$REPO_DIR" status --porcelain --untracked-files=all)" ] || { echo "工作区未提交，先 commit 再上传" >&2; exit 1; }

# 输出：platform<TAB>owner<TAB>push_url（按 gitcode → gitee → github×3 排队）。
# 只输出账号与不含凭据的 URL；凭据由 Git 在子进程内通过 askpass 获取。
TARGETS=$(node -e '
const fs=require("fs");
const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const host={gitcode:"gitcode.com",gitee:"gitee.com",github:"github.com"};
const expected=new Set(["gitcode/badhope","gitee/badhope","github/X33834","github/Morningstar202604","github/badhope"]);
const seen=[];
for(const p of ["gitcode","gitee","github"]){const pc=v.platforms[p];if(!pc)continue;
  for(const[u]of Object.entries(pc.accounts||{})){
    if(!/^[A-Za-z0-9._-]+$/.test(u)) throw new Error("账号名包含非法字符");
    const key=p+"/"+u;
    if(!expected.has(key)) throw new Error("未知上传目标："+key);
    seen.push(key);
    console.log([p,u,"https://"+encodeURIComponent(u)+"@"+host[p]+"/"+encodeURIComponent(u)+"/rules.git"].join("\t"));
  }}
if(seen.length!==expected.size || [...expected].some((key)=>!seen.includes(key))) throw new Error("上传目标集合不完整");' "$ACCOUNTS")
TARGET_COUNT=$(printf '%s\n' "$TARGETS" | awk 'NF {n++} END {print n+0}')
[ "$TARGET_COUNT" -eq 5 ] || { echo "凭据库上传目标必须正好 5 个，实际 $TARGET_COUNT，已拒绝假绿" >&2; exit 1; }

FAILED=0
while IFS=$'\t' read -r platform owner url; do
  [ -n "$platform" ] || continue
  echo "== push $platform/$owner =="
  ok=0
  for attempt in 1 2 3; do
    if out=$(AGENT_SECRETS_DIR="$VAULT" AGENT_GIT_PLATFORM="$platform" AGENT_GIT_ACCOUNT="$owner" \
      GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
      "$GIT_BIN" -c credential.helper= -C "$REPO_DIR" push "$url" "HEAD:refs/heads/$BRANCH" 2>&1); then
      rc=0
    else
      rc=$?
    fi
    printf '%s\n' "$out" | sed -E 's#https://[^@]*@#https://***@#g'
    if [ "$rc" -eq 0 ]; then
      ok=1
      break
    fi
 if printf '%s\n' "$out" | grep -Eiq 'authentication failed|permission denied|access denied|403|401|non-fast-forward|fetch first|\[rejected\]|repository not found'; then
 echo "!!认证、权限或分叉错误，立即停止" >&2
 exit 1
 fi
 if ! printf '%s\n' "$out" | grep -Eiq 'connection (was )?(reset|refused|timed out)|could not resolve host|unable to access.*(timed out|failed to connect)|network is unreachable|operation timed out|recv failure|ssl connection timeout'; then
 echo "!! 非明确网络错误，立即停止" >&2
 exit 1
 fi
 if [ "$platform" = github ] && [ "${UPLOAD_API_FALLBACK:-1}" = "1" ]; then
 echo "!! 尝试 GitHub API 精确重建并快进：$owner" >&2
 if AGENT_SECRETS_DIR="$VAULT" UPLOAD_REPO_DIR="$REPO_DIR" node "$REPO_DIR/scripts/gh-api-push.js" "$owner" --repo rules --branch "$BRANCH"; then
 ok=1
 break
 fi
 echo "!! API 快进失败，立即停止" >&2
 exit 1
 fi
 [ "$attempt" -eq 3 ] || sleep $((attempt * BACKOFF))
  done
  [ "$ok" = 1 ] || { echo "!! push 失败：$platform/$owner" >&2; FAILED=$((FAILED+1)); }
  sleep "$SLEEP"
done <<< "$TARGETS"

if [ "$FAILED" -gt 0 ]; then
  echo "完成（$FAILED 个平台失败）" >&2
  exit 1
fi
echo "五平台上传完成（串行，间隔 ${SLEEP}s）"
