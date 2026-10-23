# -*- coding: utf-8 -*-
"""核心同步模块：目录 + 正文，三个入口共用这一份逻辑。

入口
  1) 命令行 / 计划任务 / GitHub Actions：  python tools/sync.py --once [--force]
  2) HTTP（server.py）：                    POST /api/update
  3) 云函数 / Worker：                      转调上面的 HTTP，或触发入口 1

数据来源
  目录  GET  /api/laws/listV2
  正文  POST /api/laws/info   {"id": <学科id>}   ← 一次返回该学科全部章节正文
  版本  GET  /api/office/laws/lawVersion

产物
  data/catalog.json / catalog.js     目录
  data/laws/<lawId>.json             单部法律的正文（章 -> 条文）
  data/content-manifest.json         正文清单（哈希 / 章节数 / 字数）
  data/sync-state.json               上次同步的版本号
  data/changelog/YYYY-MM-DD.json     变更记录
  data/last-update.json              上次同步结果（给页面看）
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_catalog import (  # noqa: E402
    API,
    DATA_DIR,
    SRC,
    atomic_write_bytes,
    atomic_write_text,
    build_catalog,
    diff_catalogs,
    load_catalog,
    write_catalog,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_API = "https://online-web-api-cdn.zhumavip.com/api/laws/info"
VERSION_API = "https://online-web-api-cdn.zhumavip.com/api/office/laws/lawVersion"

LAWS_DIR = os.path.join(DATA_DIR, "laws")
MANIFEST = os.path.join(DATA_DIR, "content-manifest.json")
STATE = os.path.join(DATA_DIR, "sync-state.json")
CHANGELOG_DIR = os.path.join(DATA_DIR, "changelog")
LAST_UPDATE = os.path.join(DATA_DIR, "last-update.json")
LOCK = os.path.join(DATA_DIR, ".sync.lock")
LOCK_TTL = 900          # 秒：超过这个时间的锁视为上次崩溃留下的

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://www.zhumavip.com/",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
}


# ---------------------------------------------------------------- 基础工具

def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def today():
    return datetime.now().strftime("%Y-%m-%d")


def atomic_write(path, text):
    atomic_write_text(path, text)


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def http_json(url, payload=None, timeout=90):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS,
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------- 抓取

def fetch_version():
    """源站目录版本号, 形如 '20261010143607'。"""
    try:
        return http_json(VERSION_API, timeout=15).get("data")
    except Exception:
        return None


def fetch_catalog():
    """返回 (原始字节, 解析后的 JSON)。"""
    req = urllib.request.Request(API, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    payload = json.loads(raw.decode("utf-8"))
    if payload.get("code") != 200:
        raise RuntimeError("目录接口异常: %s" % payload.get("msg"))
    return raw, payload


def fetch_subject_content(subject_id):
    """一次拿到某学科下全部章节正文。"""
    payload = http_json(CONTENT_API, {"id": subject_id})
    if payload.get("code") != 200:
        raise RuntimeError("正文接口异常(subject=%s): %s" % (subject_id, payload.get("msg")))
    return payload.get("data") or []


def collect_leaf_ids(node):
    """递归取出一部法律下的章节 id（保持顺序）。"""
    leaves = []
    for child in node.get("children") or []:
        if child.get("children"):
            leaves.extend(collect_leaf_ids(child))
        else:
            leaves.append(child["id"])
    return leaves


def normalize_text(text):
    return (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


# ---------------------------------------------------------------- 正文落盘

def law_doc_hash(chapters):
    h = hashlib.sha1()
    for ch in chapters:
        h.update(str(ch["id"]).encode())
        h.update(ch.get("content", "").encode("utf-8"))
    return h.hexdigest()


def sync_content(catalog, tree_payload, progress=None):
    """抓取全部学科正文, 按法律拆分成 data/laws/<id>.json。"""
    os.makedirs(LAWS_DIR, exist_ok=True)

    # 法律 id -> 目录树节点（用于取章节顺序）
    law_nodes = {}
    for subject in tree_payload.get("data") or []:
        for law in subject.get("children") or []:
            law_nodes[law["id"]] = law

    # 逐学科抓正文（8 次请求；并发 3 个足够温和）
    contents = {}
    subjects = list(catalog["subjects"])
    done = 0
    errors = []

    def grab(subject):
        try:
            return subject["id"], fetch_subject_content(subject["id"])
        except Exception as exc:                # 单个学科失败不拖垮整体
            return subject["id"], exc

    with ThreadPoolExecutor(max_workers=3) as pool:
        for subject_id, nodes in pool.map(grab, subjects):
            done += 1
            if isinstance(nodes, Exception):
                errors.append("%s: %s" % (subject_id, nodes))
            else:
                for node in nodes:
                    contents[node["id"]] = node
            if progress:
                progress("content", done, len(subjects))

    if errors:
        raise RuntimeError("正文抓取失败: " + "; ".join(errors))

    # 拆分 + 写盘
    manifest = {}
    written = 0
    total_chars = 0
    for subject in catalog["subjects"]:
        for law in subject["laws"]:
            law_node = law_nodes.get(law["id"])
            if law_node is None:
                continue
            leaf_ids = collect_leaf_ids(law_node) or [law_node["id"]]

            chapters = []
            for leaf_id in leaf_ids:
                node = contents.get(leaf_id)
                if not node:
                    continue
                text = normalize_text(node.get("content"))
                if not text:
                    continue
                chapters.append({
                    "id": leaf_id,
                    "title": node.get("title") or "",
                    "content": text,
                })

            if not chapters:
                continue

            doc_hash = law_doc_hash(chapters)
            chars = sum(len(c["content"]) for c in chapters)
            total_chars += chars

            path = os.path.join(LAWS_DIR, "%d.json" % law["id"])
            previous = read_json(path) or {}
            if previous.get("hash") != doc_hash:
                doc = {
                    "id": law["id"],
                    "title": law["title"],
                    "subjectId": subject["id"],
                    "subjectTitle": subject["title"],
                    "chapters": chapters,
                    "hash": doc_hash,
                    "chars": chars,
                    "fetchedAt": now_iso(),
                }
                atomic_write(path, json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
                written += 1

            manifest[str(law["id"])] = {
                "hash": doc_hash,
                "chapters": len(chapters),
                "chars": chars,
            }

    atomic_write(MANIFEST, json.dumps({
        "generatedAt": now_iso(),
        "lawCount": len(manifest),
        "totalChars": total_chars,
        "laws": manifest,
    }, ensure_ascii=False, indent=0))

    return {
        "lawCount": len(manifest),
        "chapters": sum(m["chapters"] for m in manifest.values()),
        "chars": total_chars,
        "written": written,
    }


# ---------------------------------------------------------------- 跨进程锁

def acquire_lock(ttl=LOCK_TTL):
    """防止两个进程（两个 server 实例 / 定时任务叠加）同时同步。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, json.dumps({"pid": os.getpid(), "at": time.time()}).encode())
        os.close(fd)
        return True
    except FileExistsError:
        try:
            age = time.time() - os.path.getmtime(LOCK)
        except OSError:
            age = 0
        if age > ttl:                       # 崩溃残留, 抢过来
            try:
                os.remove(LOCK)
            except OSError:
                return False
            return acquire_lock(ttl)
        return False


def release_lock():
    try:
        os.remove(LOCK)
    except OSError:
        pass


# ---------------------------------------------------------------- 主流程

def empty_diff():
    return {
        "subjectsAdded": [], "subjectsRemoved": [],
        "lawsAdded": [], "lawsRemoved": [],
        "lawsRenamed": [], "lawsMoved": [], "unchanged": True,
    }


def run_sync(force=False, with_content=True, progress=None, dry_run=False):
    """带跨进程锁的同步入口：两个实例同时跑时，后者直接返回 busy。"""
    if not acquire_lock():
        return {
            "ok": False,
            "busy": True,
            "changed": False,
            "reason": "另一个进程正在同步，请稍后重试",
        }
    try:
        return _run_sync(force=force, with_content=with_content,
                         progress=progress, dry_run=dry_run)
    finally:
        release_lock()


def _run_sync(force=False, with_content=True, progress=None, dry_run=False):
    """执行一次同步。force=True 时即使版本号相同也重新抓取。

    progress(phase, done, total) 会在 'catalog' / 'content' 阶段被调用。
    """
    started = time.time()
    version = fetch_version()
    state = read_json(STATE, {}) or {}
    old_catalog = load_catalog()
    manifest = read_json(MANIFEST, {}) or {}

    has_content = os.path.isdir(LAWS_DIR) and bool(manifest.get("laws"))
    up_to_date = (
        not force
        and version
        and state.get("upstreamVersion") == version
        and old_catalog
        and (has_content or not with_content)
    )
    if up_to_date:
        return {
            "ok": True,
            "changed": False,
            "reason": "版本未变化",
            "version": version,
            "meta": old_catalog["meta"],
            "diff": empty_diff(),
            "content": {"lawCount": len(manifest.get("laws") or {}),
                        "chapters": sum(m["chapters"] for m in (manifest.get("laws") or {}).values()),
                        "chars": sum(m["chars"] for m in (manifest.get("laws") or {}).values()),
                        "written": 0},
            "durationMs": int((time.time() - started) * 1000),
        }

    if progress:
        progress("catalog", 0, 1)

    raw, payload = fetch_catalog()
    catalog = build_catalog(payload)
    if version:
        catalog["meta"]["upstreamVersion"] = version

    diff = diff_catalogs(old_catalog, catalog)

    # 版本变了但目录没变 => 疑似条文修订，正文需要全量重抓（这里本来也是全量，只是记录一下）
    content_changed = bool(diff and not diff["unchanged"])

    # 先抓正文到内存, 失败则整批放弃（不写盘）
    content_stats = {"lawCount": 0, "chapters": 0, "chars": 0, "written": 0}
    if with_content:
        # 先落新目录到内存对象, 正文写盘需要它; 但写盘要等全部成功, 所以这里写内容文件
        content_stats = sync_content(catalog, payload, progress)

    if progress:
        progress("catalog", 1, 1)

    if not dry_run:
        # 原始树
        atomic_write_bytes(SRC, raw)

        write_catalog(catalog)

        info = {
            "at": now_iso(),
            "ok": True,
            "durationMs": int((time.time() - started) * 1000),
            "upstreamVersion": version,
            "subjectCount": catalog["meta"]["subjectCount"],
            "lawCount": catalog["meta"]["lawCount"],
            "content": content_stats,
            "diff": diff,
        }
        atomic_write(LAST_UPDATE, json.dumps(info, ensure_ascii=False, indent=2))
        atomic_write(STATE, json.dumps({
            "upstreamVersion": version,
            "at": info["at"],
        }, ensure_ascii=False, indent=2))

        if not diff["unchanged"] or content_stats.get("written"):
            os.makedirs(CHANGELOG_DIR, exist_ok=True)
            atomic_write(
                os.path.join(CHANGELOG_DIR, today() + ".json"),
                json.dumps({"at": info["at"], "version": version, "diff": diff,
                            "content": content_stats}, ensure_ascii=False, indent=2),
            )
    else:
        info = {"at": now_iso(), "dryRun": True, "version": version}

    return {
        "ok": True,
        "changed": (not diff["unchanged"]) or bool(content_stats.get("written")),
        "version": version,
        "meta": catalog["meta"],
        "diff": diff,
        "content": content_stats,
        "info": info,
        "durationMs": int((time.time() - started) * 1000),
    }


# ---------------------------------------------------------------- CLI

def main():
    parser = argparse.ArgumentParser(description="法律法规汇编 · 核心同步")
    parser.add_argument("--once", action="store_true", help="执行一次同步")
    parser.add_argument("--check", action="store_true", help="只检查版本是否落后")
    parser.add_argument("--force", action="store_true", help="忽略版本号，强制重抓")
    parser.add_argument("--no-content", action="store_true", help="只同步目录，不抓正文")
    parser.add_argument("--dry-run", action="store_true", help="抓取但不写盘")
    parser.add_argument("--json", action="store_true", help="输出 JSON 结果")
    args = parser.parse_args()

    if args.check:
        version = fetch_version()
        state = read_json(STATE, {}) or {}
        stale = bool(version) and state.get("upstreamVersion") != version
        result = {
            "ok": True,
            "upstreamVersion": version,
            "localVersion": state.get("upstreamVersion"),
            "stale": stale,
        }
        print(json.dumps(result, ensure_ascii=False) if args.json
              else "源站版本 %s / 本地 %s → %s" % (
                  version, state.get("upstreamVersion"), "有更新" if stale else "已是最新"))
        return

    if not args.once:
        parser.print_help()
        return

    def progress(phase, done, total):
        if args.json:
            return
        label = {"catalog": "目录", "content": "正文"}.get(phase, phase)
        sys.stdout.write("\r%s %d/%d" % (label, done, total))
        sys.stdout.flush()

    result = run_sync(force=args.force, with_content=not args.no_content,
                      progress=progress, dry_run=args.dry_run)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print()
    if result.get("busy"):
        print("另一个进程正在同步，本次跳过（%s）。" % result.get("reason"))
        return
    if not result["changed"]:
        print("已是最新（版本 %s），未做改动。" % result["version"])
        return
    d = result["diff"]
    c = result["content"]
    print("同步完成：%d 学科 / %d 部 / %d 章 / %s 字，写入 %d 部（%.1fs）" % (
        result["meta"]["subjectCount"], result["meta"]["lawCount"],
        c.get("chapters", 0), format(c.get("chars", 0), ","),
        c.get("written", 0), result["durationMs"] / 1000))
    if not d["unchanged"]:
        print("目录变化：新增 %d / 下架 %d / 改名 %d / 换学科 %d" % (
            len(d["lawsAdded"]), len(d["lawsRemoved"]),
            len(d["lawsRenamed"]), len(d["lawsMoved"])))


if __name__ == "__main__":
    main()
