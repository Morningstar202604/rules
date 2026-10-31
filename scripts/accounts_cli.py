#!/usr/bin/env python3
"""凭据库 CLI：list|check|sync|store-git|env|path。

数据源 ~/.agent-secrets/accounts.json（见 docs/SECRETS.md）。
纪律：不打印 token 值；日志只记录"已配置/未配置/探活结果"。
"""
import argparse
import getpass
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def normalize_path(value):
    if os.name == "nt" and re.match(r"^/[A-Za-z]/", value):
        return value[1].upper() + ":\\" + value[3:].replace("/", "\\")
    return value


VAULT = Path(normalize_path(os.environ.get("AGENT_SECRETS_DIR", str(Path.home() / ".agent-secrets"))))
ACCOUNTS = VAULT / "accounts.json"

API_BASES = {
    "gitcode": "https://gitcode.com/api/v5",
    "gitee": "https://gitee.com/api/v5",
    "github": "https://api.github.com",
}
API_HOSTS = {
    "gitcode": "gitcode.com",
    "gitee": "gitee.com",
    "github": "api.github.com",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, new_url):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


OPENER = urllib.request.build_opener(NoRedirect)


def ensure_private_file(write=False):
    if not ACCOUNTS.exists():
        sys.exit(f"凭据库不存在：{ACCOUNTS}（参考 docs/SECRETS.md 初始化）")
    try:
        os.chmod(ACCOUNTS, 0o600)
    except OSError as exc:
        sys.exit(f"凭据库权限无法收紧：{type(exc).__name__}")
    if os.name == "nt":
        try:
            user = getpass.getuser()
            grant = "M" if write else "R"
            result = subprocess.run(
                ["icacls", str(ACCOUNTS), "/reset"],
                check=False, capture_output=True, text=True,
            )
            if result.returncode == 0:
                result = subprocess.run(
                    ["icacls", str(ACCOUNTS), "/inheritance:r", "/grant:r", f"{user}:{grant}",
                     "/grant", "*S-1-5-18:F", "/grant", "*S-1-5-32-544:F"],
                    check=False, capture_output=True, text=True,
                )
        except OSError:
            sys.exit("Windows ACL 工具不可用，拒绝读取凭据库")
        if result.returncode != 0:
            sys.exit("Windows ACL 无法收紧，拒绝读取凭据库")


def load():
    ensure_private_file()
    return json.loads(ACCOUNTS.read_text(encoding="utf-8"))


def save(data):
    ensure_private_file(write=True)
    fd, tmp = tempfile.mkstemp(prefix=".accounts.", suffix=".tmp", dir=str(ACCOUNTS.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, ACCOUNTS)
        try:
            os.chmod(ACCOUNTS, 0o600)
        except OSError as exc:
            sys.exit(f"凭据库权限无法收紧：{type(exc).__name__}")
        ensure_private_file(write=False)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def iter_accounts(data):
    for platform, pc in data.get("platforms", {}).items():
        for user, acc in pc.get("accounts", {}).items():
            yield platform, pc, user, acc


def probe(platform, pc, acc):
    if platform not in API_BASES:
        return 0, "config-error"
    base = (pc.get("api_base") or API_BASES[platform]).rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" or parsed.hostname != API_HOSTS[platform]:
        return 0, "config-error"
    token = acc["token"]
    auth = pc.get("auth") or {}
    scheme = auth.get("scheme") or ("bearer" if platform == "github" else "query")
    headers = {"User-Agent": "agent-vault"}
    endpoint = base + "/user"
    if scheme == "bearer":
        headers["Authorization"] = "Bearer " + token
        if platform == "github":
            headers["Accept"] = "application/vnd.github+json"
    elif scheme == "query":
        param = auth.get("param") or "access_token"
        endpoint += ("&" if "?" in endpoint else "?") + urllib.parse.urlencode({param: token})
    else:
        return 0, "config-error"
    req = urllib.request.Request(endpoint, headers=headers)
    try:
        with OPENER.open(req, timeout=15) as res:
            body = json.loads(res.read().decode("utf-8"))
            return res.status, body.get("login") or body.get("username") or ""
    except urllib.error.HTTPError as exc:
        return exc.code, "http-error"
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, "network-error"


def cmd_list(data):
    print(f"{'platform':<10} {'account':<20} {'env':<32} status/checked")
    for platform, _, user, acc in iter_accounts(data):
        checked = (acc.get("checked") or "")[:19]
        print(f"{platform:<10} {user:<20} {acc.get('env',''):<32} {acc.get('status','?')} {checked}")


def cmd_check(data):
    for platform, pc, user, acc in iter_accounts(data):
        code, info = probe(platform, pc, acc)
        acc["status"] = "ok" if code == 200 else f"http-{code}"
        acc["checked"] = datetime.now(timezone.utc).isoformat()
        print(f"{platform}/{user}: {acc['status']}" + (f" ({info})" if info else ""))
    save(data)


def cmd_sync(_data):
    print("已停用明文环境变量同步；请使用 scripts/upload_all.sh 的 askpass 通道。", file=sys.stderr)
    raise SystemExit(1)


def cmd_store_git(_data):
    print("已停用持久化 Git 凭据写入；上传请使用 scripts/upload_all.sh 的 askpass 通道。", file=sys.stderr)
    raise SystemExit(1)


def cmd_env(_data):
    print("已停用明文环境变量输出；不会把 token 写入标准输出。", file=sys.stderr)
    raise SystemExit(1)


def cmd_path(_data):
    print(str(VAULT))


def main():
    parser = argparse.ArgumentParser(description="本机凭据库 CLI（不打印 token）")
    parser.add_argument("command", choices=["list", "check", "sync", "store-git", "env", "path"])
    args = parser.parse_args()
    data = load()
    {"list": cmd_list, "check": cmd_check, "sync": cmd_sync,
     "store-git": cmd_store_git, "env": cmd_env, "path": cmd_path}[args.command](data)


if __name__ == "__main__":
    main()
