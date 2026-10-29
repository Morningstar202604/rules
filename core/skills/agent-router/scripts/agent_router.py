#!/usr/bin/env python3
"""agent_router.py — decide WHICH subagent team a task belongs to, in milliseconds.

Reuses the same deterministic TF-IDF-ish engine as skill-router (English words
+ CJK bigrams, curated aliases), but indexes `agents/*.md` instead and only
routes to team leads — the lead then dispatches within its team.

Why only leads: routing to 220 leaf roles directly is noisy and unstable
(backend-engineer vs api-designer overlap heavily). Routing to the 18 leads is
stable, and each lead already knows how to split work inside its team.

  python3 agent_router.py "<task text>" --agents-dir <dir> [--top 3] [--json]

Deterministic, offline, stdlib only.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,}")
CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")

AUTO_DETECT_CANDIDATES = [
    Path(__file__).resolve().parents[3] / "agents",      # repo layout: core/agents
    Path.home() / ".zcode" / "agents",
    Path.home() / ".claude" / "agents",
    Path.home() / ".config" / "opencode" / "agent",
]

# Query-side alias expansion: domain words users actually type -> routing terms.
ALIAS = {
    "开发": ["engineer", "development"], "编程": ["engineer", "code"],
    "写代码": ["engineer", "code"], "重构": ["refactor", "engineer"],
    "前端": ["frontend"], "后端": ["backend"], "接口": ["api"],
    "数据库": ["database", "sql"], "建站": ["web", "frontend"],
    "小程序": ["mobile", "frontend"], "网站": ["web"], "网页": ["web", "frontend"],
    "上线": ["deploy", "devops"], "部署": ["deploy", "devops"],
    "测试": ["qa", "test"], "自动化测试": ["qa", "test"],
    "安全": ["security"], "漏洞": ["security", "vulnerability"],
    "性能": ["performance"], "优化": ["performance"],
    "产品": ["product"], "需求": ["product", "prd"], "原型": ["ux", "prototype"],
    "用户研究": ["research", "user"], "竞品": ["competitor"],
    "数据": ["data", "analysis"], "分析": ["analysis"], "报表": ["report"],
    "指标": ["metric"], "取数": ["sql", "data"], "漏斗": ["funnel"],
    "营销": ["marketing"], "推广": ["marketing"], "投放": ["campaign"],
    "品牌": ["brand"], "增长": ["growth"], "自媒体": ["social"],
    "文案": ["copy", "content"], "写作": ["writing", "content"],
    "长文": ["article", "content"], "公众号": ["content"],
    "小红书": ["social", "content"], "脚本": ["script"],
    "视频": ["video"], "剪辑": ["edit", "video"], "分镜": ["storyboard"],
    "调色": ["color", "video"], "字幕": ["subtitle"],
    "设计": ["design"], "海报": ["poster", "design"], "logo": ["logo"],
    "配色": ["color"], "排版": ["typography"], "插画": ["illustration"],
    "PPT": ["presentation", "slides"], "演示": ["presentation"],
    "财务": ["finance"], "会计": ["accounting", "finance"], "税务": ["tax"],
    "预算": ["budget"], "报表勾稽": ["finance", "report"],
    "招聘": ["recruit", "hr"], "绩效": ["performance", "hr"], "薪酬": ["compensation"],
    "培训": ["training"], "面试": ["interview"], "入职": ["onboarding"],
    "合同": ["contract", "legal"], "法务": ["legal"], "合规": ["compliance"],
    "隐私": ["privacy"], "知识产权": ["ip"], "劳动": ["labor"],
    "翻译": ["translation"], "本地化": ["localization"], "术语": ["terminology"],
    "校对": ["proofread"], "字幕翻译": ["subtitle", "translation"],
    "课程": ["curriculum", "education"], "教学": ["education", "teaching"],
    "课件": ["courseware"], "出题": ["quiz"], "测评": ["assessment"],
    "学术": ["academic"], "论文": ["paper", "academic"], "文献": ["literature"],
    "投稿": ["journal", "paper"], "审稿": ["review", "paper"],
    "数学建模": ["math", "model"], "国赛": ["math", "cumcm"], "建模": ["model"],
    "游戏": ["game"], "玩法": ["gameplay"], "关卡": ["level"], "数值": ["balance"],
    "音频": ["audio"], "播客": ["podcast"], "配音": ["voice", "audio"],
    "电商": ["ecommerce"], "选品": ["product", "ecommerce"], "listing": ["ecommerce"],
    "物流": ["logistics"], "定价": ["pricing"], "客服": ["service"],
}

STOP = set("""
a an the and or of to for in on at by with from as is are was were be been being
this that these those it its i you he she we they do does did have has had will
would can could should may might must not no yes if then than so such very more
most other some any each all both few many much own same too only just also
""".split())


def terms_of(text: str) -> list[str]:
    out: list[str] = []
    for w in WORD_RE.findall(text or ""):
        lw = w.lower()
        if lw in STOP or len(lw) < 2:
            continue
        out.append(lw)
    for run in CJK_RUN_RE.findall(text or ""):
        if len(run) == 1:
            out.append(run)
        for i in range(len(run) - 1):
            out.append(run[i : i + 2])
    return out


def expand_aliases(task_terms: list[str]) -> list[str]:
    extra: list[str] = []
    joined = "".join(task_terms)
    for k, vs in ALIAS.items():
        if k.lower() in joined:
            extra.extend(vs)
    return task_terms + extra


def fold_description(lines: list[str], key: str) -> str:
    """Read `key:` including YAML block scalars (`>-`, `|`)."""
    for i, line in enumerate(lines):
        m = re.match(rf"^{re.escape(key)}:\s*(.*)$", line)
        if not m:
            continue
        val = m.group(1).strip()
        if re.fullmatch(r"[>|]-?", val):
            buf = []
            for nxt in lines[i + 1 :]:
                if nxt.startswith((" ", "\t")) or not nxt.strip():
                    buf.append(nxt.strip())
                else:
                    break
            return " ".join(buf).strip()
        return val.strip().strip("\"'")
    return ""


def agent_record(md: Path) -> dict | None:
    try:
        text = md.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return None
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", text)
    if not m:
        return None
    lines = m.group(1).splitlines()
    name = fold_description(lines, "name")
    desc = fold_description(lines, "description")
    if not name or not desc:
        return None
    return {"name": name, "path": str(md), "desc": desc,
            "terms": terms_of(name + " " + desc)}


def build_index(agents_dir: Path) -> dict:
    docs = []
    for md in sorted(agents_dir.glob("*.md")):
        rec = agent_record(md)
        if rec:
            docs.append(rec)
    if not docs:
        return {"docs": [], "idf": {}, "avg": 0.0}

    df: dict[str, int] = {}
    for d in docs:
        for t in set(d["terms"]):
            df[t] = df.get(t, 0) + 1
    n = len(docs)
    idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
    lengths = []
    for d in docs:
        tf: dict[str, int] = {}
        for t in d["terms"]:
            tf[t] = tf.get(t, 0) + 1
        d["vec"] = {t: (1 + math.log(c)) * idf.get(t, 1.0) for t, c in tf.items()}
        d["norm"] = math.sqrt(sum(v * v for v in d["vec"].values())) or 1.0
        lengths.append(len(d["terms"]))
    return {"docs": docs, "idf": idf, "avg": sum(lengths) / len(lengths)}


def route(task: str, index: dict, top: int = 3) -> list[dict]:
    if not index["docs"]:
        return []
    terms = expand_aliases(terms_of(task))
    tf: dict[str, int] = {}
    for t in terms:
        tf[t] = tf.get(t, 0) + 1
    idf = index["idf"]
    qvec = {t: (1 + math.log(c)) * idf.get(t, 1.0) for t, c in tf.items() if t in idf}
    qnorm = math.sqrt(sum(v * v for v in qvec.values())) or 1.0

    scored = []
    for d in index["docs"]:
        dot = sum(v * d["vec"].get(t, 0.0) for t, v in qvec.items())
        if dot <= 0:
            continue
        score = dot / (qnorm * d["norm"])
        matched = [t for t in qvec if t in d["vec"]][:6]
        scored.append({"name": d["name"], "score": round(score * 100, 2), "matched": matched})
    scored.sort(key=lambda x: -x["score"])
    return scored[:top]


def load_routes(explicit: str | None = None) -> dict | None:
    """Load curated domain→lead routing table (deterministic, beats similarity)."""
    cands = []
    if explicit:
        cands.append(Path(explicit))
    here = Path(__file__).resolve()
    cands += [here.parent.parent / "references" / "routes.json"]
    for p in cands:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
    return None


def route_by_table(task: str, table: dict) -> dict | None:
    """Keyword-table routing. Returns {name, score, matched} or None.

    `priority` keywords are the task's *action verb* (翻译/审核/设计…). They
    decide intent when a request mentions an artifact from another domain
    ("翻译这份合同" is translation, not legal review), so they get a large
    weight bonus.
    """
    t = (task or "").lower()
    best = None
    for r in table.get("routes", []):
        if any(x in t for x in r.get("exclude", [])):
            continue
        hits = [k for k in r.get("keywords", []) if k.lower() in t]
        if not hits:
            continue
        prio = [k for k in r.get("priority", []) if k.lower() in t]
        score = len(hits) + max(len(k) for k in hits) * 0.5 + len(prio) * 8
        if not best or score > best["score"]:
            best = {"name": r["lead"], "score": round(score, 2),
                    "matched": (prio + [h for h in hits if h not in prio])[:6],
                    "domain": r.get("domain", "")}
    return best


def detect_agents_dir(explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_dir() else None
    for c in AUTO_DETECT_CANDIDATES:
        if c.is_dir():
            return c
    return None


def main(argv: list[str]) -> int:
    # Windows 控制台默认 cp1252/cp936，打印中文会 UnicodeEncodeError。强制 UTF-8。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    ap = argparse.ArgumentParser(description="Route a task to the best-matching subagent team lead.")
    ap.add_argument("task")
    ap.add_argument("--agents-dir")
    ap.add_argument("--routes", help="path to routes.json (default: skill dir references/)")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-score", type=float, default=3.0)
    args = ap.parse_args(argv)

    agents_dir = detect_agents_dir(args.agents_dir)
    if not agents_dir:
        print("NO AGENT DIR", file=sys.stderr)
        return 2

    index = build_index(agents_dir)

    # 1) 先查人工维护的领域路由表：确定性最高，不依赖 220 条描述的用词巧合。
    table = load_routes(args.routes)
    table_hit = route_by_table(args.task, table) if table else None
    if table_hit:
        picked, mode = [table_hit], "table"
    else:
        # 2) 退回描述相似度：强制优先 team-lead，叶子角色由 lead 队内再分派。
        ranked = route(args.task, index, top=max(args.top * 4, 12))
        keep = [r for r in ranked if r["score"] >= args.min_score]
        leads = [r for r in keep if "team-lead" in r["name"]]
        if leads:
            leads.sort(key=lambda x: -x["score"])
            picked, mode = leads[: args.top], "lead"
        elif keep:
            picked, mode = keep[: args.top], "leaf"
        else:
            fb = (table or {}).get("fallback", {})
            picked = [{"name": fb.get("lead", "software-team-lead"), "score": 0.0,
                       "matched": ["fallback"], "domain": fb.get("reason", "")}]
            mode = "fallback"

    if args.json:
        print(json.dumps({"task": args.task, "agents_dir": str(agents_dir),
                          "mode": mode, "ranked": picked,
                          "verdict": "USE AGENTS" if picked else "NO AGENT"},
                         ensure_ascii=False, indent=2))
        return 0

    print(f"task   : {args.task}")
    print(f"agents : {agents_dir} ({len(index['docs'])} indexed)")
    print("verdict: " + ("USE AGENTS" if picked else "NO AGENT NEEDED") + (f"  (via {mode})" if picked else ""))
    for r in picked:
        dom = f"  [{r['domain']}]" if r.get("domain") else ""
        print(f"  {r['score']:6.2f}  {r['name']:<28} 命中: {'/'.join(r['matched'])}{dom}")
    return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
