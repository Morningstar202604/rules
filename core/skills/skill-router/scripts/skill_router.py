#!/usr/bin/env python3
"""skill_router.py — decide WHICH skills (if any) a task needs, in milliseconds.

Indexes every installed SKILL.md's frontmatter (name / description /
description_zh), builds a deterministic TF-IDF-ish term index (English words
+ CJK bigrams), scores the task against it, and prints a ranked verdict:

  USE SKILLS     -> ranked candidates with matched terms
  NO SKILL NEEDED-> top score below threshold; work normally

Deterministic, offline, stdlib only. No embeddings, no network — the same
task always yields the same ranking, so agents can rely on it.

Usage:
  python3 skill_router.py "<task text>" --skills-dir <dir> [--top 5] [--json]
  python3 skill_router.py "<task text>"                 # auto-detect skills dir
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,}")
CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")

AUTO_DETECT_CANDIDATES = [
    Path(__file__).resolve().parents[2],          # repo layout: skills/meta/skill-router
    Path.home() / ".zcode" / "skills",
    Path.home() / ".workbuddy" / "skills",
    Path.home() / ".claude" / "skills",
    Path.home() / ".config" / "opencode" / "skill",
]



# Query-side alias expansion: zh (and shorthand) -> English terms used in
# descriptions. Deterministic, curated, and cheap — this is what lifts
# cross-lingual recall without any embeddings.
ALIAS = {
    "分镜": ["storyboard"], "字幕": ["subtitle"], "架构图": ["architecture"],
    "架构": ["architecture"], "爬取": ["scrape", "web", "scraping"], "抓取": ["scrape", "scraping"],
    "慢查询": ["slow", "query"], "密钥": ["secret", "secrets"], "供应链": ["supply", "chain"],
    "内存取证": ["memory", "forensics"], "内存": ["memory"], "取证": ["forensics"],
    "部署": ["deploy", "deployment"], "发布": ["publish", "publishing"],
    "性能": ["performance"], "瓶颈": ["profiling", "performance"],
    "面试": ["interview"], "工单": ["ticket"], "待办": ["tasks"],
    "网表": ["schema"], "表结构": ["schema", "tables"], "数据库设计": ["schema"],
    "单位经济": ["unit", "economics"], " Humanizer": ["humanize"],
    "人味": ["humanize", "humanizer"], "ai味": ["humanize", "humanizer"],
    "定时": ["cron", "schedule"], "计划任务": ["cron", "schedule"],
    "备份": ["backup"], "翻译": ["translate", "translation"],
    "摘要": ["summary"], "封面": ["cover"], "海报": ["poster"],
    "幻灯片": ["slides"], "渲染": ["render"], "抓包": ["packet"],
    "勒索": ["ransomware"], "钓鱼": ["phishing"], "漏洞": ["vulnerability", "security"],
    "纵深": ["lateral"], "横向移动": ["lateral", "movement"],
    "微调": ["fine-tune", "training", "lora"], "训练": ["training", "train"],
    "数据集": ["dataset"], "embedding": ["embeddings"],
    "公众号": ["wechat", "official"], "排版": ["html", "formatting"],
    "整理": ["organize", "organizer"], "文件夹": ["folder", "files"],
    "下载": ["download"], "清理": ["cleanup", "cleaner"],
    "图表": ["plot", "figure"], "论文": ["paper", "paper"],
}

def expand_aliases(task_terms: set) -> set:
    joined = " ".join(task_terms)
    extra = set()
    for k, vals in ALIAS.items():
        if k in joined:
            extra.update(vals)
    return task_terms | extra  # original terms + alias expansion


def terms_of(text: str) -> list[str]:
    """English words (len>=2) + CJK bigrams (strong) + CJK unigrams (weak)."""
    out = [w.lower() for w in WORD_RE.findall(text)]
    for run in CJK_RUN_RE.findall(text):
        if len(run) == 1:
            out.append(run)
        else:
            out.extend(run[i : i + 2] for i in range(len(run) - 1))
            out.extend(f"~{ch}" for ch in run)  # weak unigram marker
    return out


def fold_description(lines: list[str], key: str) -> str:
    """Minimal frontmatter reader: value of a top-level key (block or inline)."""
    try:
        i = next(k for k, ln in enumerate(lines) if ln.startswith(f"{key}:"))
    except StopIteration:
        return ""
    j = i + 1
    buf = []
    while j < len(lines) and lines[j].startswith("  "):
        buf.append(lines[j].strip())
        j += 1
    if buf:
        return " ".join(buf)
    inline = lines[i].split(":", 1)[1].strip()
    return inline.strip("\"'")


CACHE_VERSION = 1
CACHE_TTL_SECONDS = 7 * 24 * 3600


def cache_path() -> Path | None:
    """Persistent index cache. Disable with ZCODE_SKILL_ROUTER_NO_CACHE=1."""
    if os.environ.get("ZCODE_SKILL_ROUTER_NO_CACHE"):
        return None
    override = os.environ.get("ZCODE_SKILL_ROUTER_CACHE")
    if override:
        return Path(override)
    return Path.home() / ".zcode" / "state" / "skill-router-index.json"


def should_index(md: Path) -> bool:
    parts = md.parts
    if any(x in parts for x in ("_common", "templates", "examples", "skills-backup-20260929")):
        return False
    return not md.parent.name.startswith("sample-")


def skill_record(md: Path) -> dict | None:
    """Derive the searchable record for one SKILL.md, or None if unusable."""
    try:
        lines = md.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return None
    desc = fold_description(lines, "description")
    if not desc:
        return None
    desc_zh = fold_description(lines, "description_zh")
    name = md.parent.name
    name_terms = sorted(set(name.split("-")))
    first_sentence = re.split(r"(?<=[.!?。！？])\s+", desc, maxsplit=1)[0]
    first_terms = sorted(set(terms_of(first_sentence)))
    desc_terms = set(terms_of(desc)) | set(terms_of(desc_zh))
    return {
        "name": name,
        "name_terms": name_terms,
        "terms": sorted((set(name_terms) | desc_terms) - {name}),
        "first_terms": first_terms,
        "len": len(desc_terms) or 1,
    }


def _load_cache(path: Path | None) -> dict:
    if not path:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if data.get("version") != CACHE_VERSION:
        return {}
    dirs = data.get("dirs")
    if not isinstance(dirs, dict):
        return {}
    return {k: v for k, v in dirs.items() if Path(k).is_dir()}


def _save_cache(path: Path | None, dirs: dict) -> None:
    if not path:
        return
    now = time.time()
    keep = {}
    for k, v in dirs.items():
        try:
            if not Path(k).is_dir():
                continue
            if now - Path(k).stat().st_mtime > CACHE_TTL_SECONDS:
                continue
        except OSError:
            continue
        keep[k] = v
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"version": CACHE_VERSION, "dirs": keep}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def build_index(skills_dir: Path, use_cache: bool = True) -> dict:
    skills_dir = Path(skills_dir).resolve()
    cache_file = cache_path() if use_cache else None
    all_dirs = _load_cache(cache_file)
    key = str(skills_dir)
    cached_files = (all_dirs.get(key) or {}).get("files") or {}

    files: dict[str, dict] = {}
    changed = False
    for md in sorted(skills_dir.rglob("SKILL.md")):
        if not should_index(md):
            continue
        try:
            st = md.stat()
        except OSError:
            continue
        rel = str(md.relative_to(skills_dir))
        hit = cached_files.get(rel)
        if hit and hit.get("mtime_ns") == st.st_mtime_ns and hit.get("size") == st.st_size:
            record = hit.get("record")
            if record:
                files[rel] = hit
                continue
        record = skill_record(md)
        if not record:
            changed = True
            continue
        files[rel] = {"mtime_ns": st.st_mtime_ns, "size": st.st_size, "record": record}
        changed = True

    if set(files) != set(cached_files):
        changed = True
    if changed:
        all_dirs[key] = {"files": files}
        _save_cache(cache_file, all_dirs)
    elif key not in all_dirs and cache_file:
        all_dirs[key] = {"files": files}
        _save_cache(cache_file, all_dirs)

    index: dict[str, dict] = {}
    df: dict[str, int] = {}
    for rel in sorted(files):
        record = files[rel]["record"]
        name = record["name"]
        index[name] = {
            "dir": str(skills_dir / Path(rel).parent),
            "name_terms": set(record["name_terms"]),
            "terms": set(record["terms"]),
            "first_terms": set(record["first_terms"]),
            "len": record["len"],
        }
        for t in index[name]["terms"]:
            df[t] = df.get(t, 0) + 1
    n_docs = max(len(index), 1)
    # smoothed IDF (sklearn-style): stable from a 1-skill dir to a 400+ skill library
    weights = {t: math.log((1 + n_docs) / (1 + c)) + 1.0 for t, c in df.items()}
    for name in index:
        index[name]["weighted"] = {
            # weak CJK unigrams get 0.25x so 审 still connects to 审查/评审
            t: (weights.get(t, 0.1) * (0.15 if t.startswith("~") else 1.0))
            for t in index[name]["terms"]
        }
    return {"skills": index, "weights": weights, "n": n_docs}


MIN_USE =5.0 # score >= this AND >=1 strong term hit -> USE SKILLS
MIN_WEAK =4.0 # score >= this -> WEAK MATCH (scan the candidate's SKILL.md yourself)


def route(task: str, index: dict, top: int = 5, min_use: float | None = None,
          min_weak: float | None = None) -> dict:
    task_terms = expand_aliases(set(terms_of(task)))
    if not task_terms:
        return {"verdict": "NO SKILL NEEDED", "reason": "empty/unrecognized task", "results": []}
    scored = []
    for name, rec in index["skills"].items():
        hits = task_terms & rec["weighted"].keys()
        if not hits:
            continue
        score = sum(rec["weighted"][t] for t in hits)
        # first sentence of the description is the "what" clause — trust it more
        first_hits = sum(1 for t in hits if t in rec.get("first_terms", set()))
        score *= 1.0 + 0.08 * min(first_hits, 5)
        # pivoted length normalization: demote hub skills with huge descriptions
        score /= (rec.get("len", 1) ** 0.2)
        name_hits = len(hits & rec["name_terms"])
        score += name_hits * 1.5
        strong_hits = sum(1 for t in hits if not t.startswith("~"))
        scored.append(
            {
                "skill": name,
                "score": round(score, 2),
                "matched": sorted(t.lstrip("~") for t in hits)[:8],
                "dir": rec["dir"],
                "_strong": strong_hits,
            }
        )
    scored.sort(key=lambda x: -x["score"])
    results = scored[:top]
    top = results[0] if results else None
    use_at = MIN_USE if min_use is None else min_use
    weak_at = MIN_WEAK if min_weak is None else min_weak
    if top and top["score"] >= use_at and top["_strong"] >=1:
        verdict = "USE SKILLS"
    elif top and top["score"] >= weak_at:
        verdict = "WEAK MATCH — scan the candidate's SKILL.md before relying on it"
    else:
        verdict = "NO SKILL NEEDED"
    for r in results:
        r.pop("_strong", None)
    return {"verdict": verdict, "task_terms": len(task_terms), "results": results}



def hook_mode(skills_dir: Path) -> int:
    """UserPromptSubmit hook contract: stdin {"prompt": "..."} ->
    stdout {"additionalContext": "..."} (strict schema; nothing else)."""
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    prompt = str(data.get("prompt") or "")
    if not prompt.strip():
        return 0
    index = build_index(skills_dir)
    r = route(prompt, index, top=3)
    names = " > ".join(x["skill"] for x in r["results"][:3]) or "-"
    line = f"[skill-router] {r['verdict']} | 候选: {names}"
    if r["results"]:
        line += f" | 命中: {'/'.join(r['results'][0]['matched'][:5])}"
    print(json.dumps({"additionalContext": line}, ensure_ascii=False))
    return 0

def detect_skills_dir(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.is_dir():
            sys.exit(f"error: --skills-dir not a directory: {p}")
        return p
    for c in AUTO_DETECT_CANDIDATES:
        if c.is_dir() and any(c.rglob("SKILL.md")):
            return c
    sys.exit("error: no skills directory found — pass --skills-dir")


def main(argv: list[str]) -> int:
    # Windows 控制台默认 cp1252/cp936，打印中文会 UnicodeEncodeError。强制 UTF-8。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    ap = argparse.ArgumentParser(description="Decide which skills a task needs (deterministic, offline)")
    ap.add_argument("task", nargs="?", default="", help="the task text, quoted (empty in --hook mode)")
    ap.add_argument("--skills-dir", default="", help="skills directory (default: auto-detect)")
    ap.add_argument("--top", type=int, default=5, help="max candidates to show (default 5)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--min-use", type=float, default=None,
                    help="USE threshold override (defaults are tuned for 400+ skill libraries)")
    ap.add_argument("--min-weak", type=float, default=None, help="WEAK threshold override")
    ap.add_argument("--hook", action="store_true",
                    help="UserPromptSubmit hook mode: read {\"prompt\"} from stdin, emit {\"additionalContext\"}")
    args = ap.parse_args(argv[1:])

    if args.hook:
        return hook_mode(detect_skills_dir(args.skills_dir))

    sdir = detect_skills_dir(args.skills_dir)
    index = build_index(sdir)
    result = route(args.task, index, args.top, args.min_use, args.min_weak)

    if args.json:
        result["skills_dir"] = str(sdir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"task   : {args.task}")
    print(f"skills : {sdir}  ({index['n']} indexed)")
    print(f"verdict: {result['verdict']}")
    for r in result["results"]:
        print(f"  {r['score']:>6.2f}  {r['skill']:<38} 命中: {'/'.join(r['matched'][:5])}")
    if result["verdict"] == "NO SKILL NEEDED":
        print("  → 没有可信命中：正常干活，不套技能。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
