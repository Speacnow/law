# -*- coding: utf-8 -*-
"""目录数据构建：把接口返回的目录树整理成站点用的「学科 → 法律法规」结构。

既可作为脚本运行（python tools/build_catalog.py），
也可被 server.py 导入，供网页上的「同步更新」按钮调用。

输入: data/source-listV2.json   (GET /api/laws/listV2 原始响应)
输出: data/catalog.json         (结构化目录)
      data/catalog.js           (同一份数据, 挂到 window.LAW_CATALOG)
"""
import json
import os
import stat
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
SRC = os.path.join(DATA_DIR, "source-listV2.json")
OUT_JSON = os.path.join(DATA_DIR, "catalog.json")
OUT_JS = os.path.join(DATA_DIR, "catalog.js")

API = "https://online-web-api-cdn.zhumavip.com/api/laws/listV2?businessType=104&legalQuestionType=1&mineType="
SOURCE_PAGE = "https://www.zhumavip.com/w/fvhuibian?businessType=104&legalQuestionType=1&mineType="

# 接口中的节点类型
T_SUBJECT = 0   # 学科, 如「民法」
T_LAW = 1       # 法律, 带编/章结构
T_PIAN = 2      # 编
T_FENBIAN = 3   # 分编
T_ZHANG = 4     # 章 (叶子节点, 正文挂在它上面)
# 深度为 1 且 type == 4 的节点, 是「不分章节的单篇法律」


def count_leaves(node):
    """统计一部法律下的章节叶子数, 用于前端显示篇幅。"""
    total = 0
    for child in node.get("children") or []:
        if child.get("children"):
            total += count_leaves(child)
        else:
            total += 1
    return total


def build_catalog(payload):
    """把 /api/laws/listV2 的响应整理成站点目录结构。"""
    if not isinstance(payload, dict) or payload.get("code") != 200:
        raise ValueError("接口返回异常: %s" % (payload or {}).get("msg", "unknown"))
    subjects_raw = payload.get("data") or []

    def build_sections(node):
        """把 编 / 分编 / 章 的层级抽出来, 供页面做「目录树」。"""
        out = []
        for child in node.get("children") or []:
            out.append({
                "id": child["id"],
                "title": child["title"],
                "type": child["type"],
                "children": build_sections(child),
            })
        return out

    subjects = []
    for s_idx, node in enumerate(subjects_raw):
        laws = []
        for l_idx, child in enumerate(node.get("children") or []):
            laws.append({
                "id": child["id"],
                "title": child["title"],
                "type": child["type"],
                # type=1 有编/章层级; type=4 是整篇法律, 没有下级
                "structured": child["type"] == T_LAW,
                "leafCount": count_leaves(child) if child.get("children") else 0,
                "sections": build_sections(child),
                "order": l_idx,
            })
        subjects.append({
            "id": node["id"],
            "title": node["title"],
            "order": s_idx,
            "laws": laws,
        })

    return {
        "meta": {
            "source": SOURCE_PAGE,
            "api": API,
            "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "subjectCount": len(subjects),
            "lawCount": sum(len(s["laws"]) for s in subjects),
        },
        "subjects": subjects,
    }


def _replace_with_retry(src, dst, attempts=5):
    """Windows 上目标文件可能被其它进程/杀软短暂占用, 重试几次再兜底直写。

    os.replace 是原子操作; 失败通常不是逻辑问题, 而是共享冲突 (WinError 5/32)。
    """
    delay = 0.05
    for _ in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if os.path.exists(dst):
                try:                              # 只读属性也会导致替换失败
                    os.chmod(dst, stat.S_IWRITE | stat.S_IREAD)
                except OSError:
                    pass
            time.sleep(delay)
            delay *= 2

    # 兜底: 直接覆盖（牺牲原子性, 但比整次同步失败好）
    with open(src, "rb") as fsrc:
        payload = fsrc.read()
    with open(dst, "wb") as fdst:
        fdst.write(payload)
    try:
        os.remove(src)
    except OSError:
        pass


def atomic_write_text(path, text):
    """写临时文件再替换, 临时名带 pid 防止两个进程互相踩。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    _replace_with_retry(tmp, path)


def atomic_write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "wb") as f:
        f.write(data)
    _replace_with_retry(tmp, path)


def write_catalog(catalog):
    """写出 catalog.json 与 catalog.js（先写临时文件再替换, 避免读到半截）。"""
    os.makedirs(DATA_DIR, exist_ok=True)

    atomic_write_text(OUT_JSON, json.dumps(catalog, ensure_ascii=False, indent=2))

    js = "/* 自动生成, 请勿手改; 重新生成: python tools/build_catalog.py */\n"
    js += "window.LAW_CATALOG = "
    js += json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    js += ";\n"
    atomic_write_text(OUT_JS, js)


def load_catalog(path=OUT_JSON):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def diff_catalogs(old, new):
    """比对新旧目录, 返回变化清单（按 id 对齐）。"""
    result = {
        "subjectsAdded": [],
        "subjectsRemoved": [],
        "lawsAdded": [],
        "lawsRemoved": [],
        "lawsRenamed": [],
        "lawsMoved": [],
        "unchanged": False,
    }
    if not old:
        result["unchanged"] = False
        return result

    old_subjects = {s["id"]: s for s in old.get("subjects") or []}
    new_subjects = {s["id"]: s for s in new.get("subjects") or []}

    for sid, s in new_subjects.items():
        if sid not in old_subjects:
            result["subjectsAdded"].append(s["title"])
    for sid, s in old_subjects.items():
        if sid not in new_subjects:
            result["subjectsRemoved"].append(s["title"])

    old_laws = {}
    for s in old.get("subjects") or []:
        for l in s.get("laws") or []:
            old_laws[l["id"]] = (l, s["title"])
    new_laws = {}
    for s in new.get("subjects") or []:
        for l in s.get("laws") or []:
            new_laws[l["id"]] = (l, s["title"])

    for lid, (law, subject_title) in new_laws.items():
        if lid not in old_laws:
            result["lawsAdded"].append({"title": law["title"], "subject": subject_title})
            continue
        prev_law, prev_subject = old_laws[lid]
        if prev_law["title"] != law["title"]:
            result["lawsRenamed"].append({
                "from": prev_law["title"],
                "to": law["title"],
                "subject": subject_title,
            })
        if prev_subject != subject_title:
            result["lawsMoved"].append({
                "title": law["title"],
                "from": prev_subject,
                "to": subject_title,
            })
    for lid, (law, subject_title) in old_laws.items():
        if lid not in new_laws:
            result["lawsRemoved"].append({"title": law["title"], "subject": subject_title})

    result["unchanged"] = not any((
        result["subjectsAdded"], result["subjectsRemoved"],
        result["lawsAdded"], result["lawsRemoved"],
        result["lawsRenamed"], result["lawsMoved"],
    ))
    return result


def main():
    with open(SRC, encoding="utf-8") as f:
        payload = json.load(f)

    catalog = build_catalog(payload)
    write_catalog(catalog)

    print("subjects=%d laws=%d" % (catalog["meta"]["subjectCount"], catalog["meta"]["lawCount"]))
    for s in catalog["subjects"]:
        print("  %s: %d" % (s["title"], len(s["laws"])))


if __name__ == "__main__":
    main()
