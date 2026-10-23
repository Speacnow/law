# -*- coding: utf-8 -*-
"""抓取法律法规目录原始数据。

数据来源: 竹马(zhumavip) 法律法规汇编页面的公开接口
  GET https://online-web-api-cdn.zhumavip.com/api/laws/listV2
      ?businessType=104&legalQuestionType=1&mineType=

返回一棵完整目录树(学科 / 法律 / 编 / 分编 / 章), 节点字段:
  id, type, title, parentId, position, topId, children[]
  type: 0=学科 1=法律(带编章) 2=编 3=分编 4=章(叶子)

用法: python tools/fetch_source.py
输出: data/source-listV2.json
"""
import json
import os
import urllib.request

API = (
    "https://online-web-api-cdn.zhumavip.com/api/laws/listV2"
    "?businessType=104&legalQuestionType=1&mineType="
)
OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "source-listV2.json",
)


def main():
    req = urllib.request.Request(
        API,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.zhumavip.com/",
            "Accept": "application/json, text/plain, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()

    payload = json.loads(raw.decode("utf-8"))
    if payload.get("code") != 200:
        raise SystemExit("接口返回异常: %s" % payload.get("msg"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(raw)

    subjects = payload["data"]
    print("已保存 %s (%d bytes)" % (OUT, len(raw)))
    print("学科数: %d" % len(subjects))
    for s in subjects:
        print("  %s: %d 部" % (s["title"], len(s.get("children") or [])))


if __name__ == "__main__":
    main()
