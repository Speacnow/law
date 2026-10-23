# -*- coding: utf-8 -*-
"""心跳文件：避免 GitHub 长时间无提交而暂停定时任务。

GitHub 的 schedule 工作流在仓库连续 60 天没有任何提交时会被自动禁用。
法条数据可能一两个月都没变化，于是这里每月写一次时间戳并提交，
让仓库保持「活跃」。

用法:
    python tools/heartbeat.py            # 距上次超过 25 天才更新
    python tools/heartbeat.py --force    # 强制更新
    python tools/heartbeat.py --days 10  # 改阈值
"""
import argparse
import json
import os
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "heartbeat.json")
DEFAULT_DAYS = 25


def read_last():
    try:
        with open(PATH, encoding="utf-8") as f:
            value = json.load(f)["at"]
        return datetime.fromisoformat(value)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(description="写入心跳时间戳")
    parser.add_argument("--force", action="store_true", help="忽略间隔，强制写入")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="间隔天数（默认 25）")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    last = read_last()

    if not args.force and last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last < timedelta(days=args.days):
            print("心跳还新鲜（%s），跳过" % last.isoformat(timespec="seconds"))
            return

    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    payload = {
        "at": now.isoformat(timespec="seconds"),
        "note": "心跳文件：仅用于避免 GitHub 定时任务因 60 天无提交被暂停",
    }
    tmp = PATH + ".%d.tmp" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, PATH)
    print("心跳已更新：%s" % payload["at"])


if __name__ == "__main__":
    main()
