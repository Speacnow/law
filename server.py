#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地站点服务 + 同步接口（仅用标准库）。

    python server.py                 # 启动, 默认 http://127.0.0.1:8123
    python server.py --port 9000
    python server.py --update-only   # 只同步数据后退出（适合计划任务 / CI）

接口
    GET  /api/status   本地版本 / 源站版本 / 是否有更新 / 正文统计 / 上次同步
    POST /api/update   执行同步（?force=1 忽略版本号强制重抓）
    GET  /api/last-update
"""
import argparse
import json
import os
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from sync import (  # noqa: E402
    LAST_UPDATE,
    MANIFEST,
    fetch_version,
    read_json,
    run_sync,
)
from build_catalog import load_catalog  # noqa: E402

_update_lock = threading.Lock()
_version_cache = {"value": None, "at": 0.0}


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def cached_version():
    if time.time() - _version_cache["at"] < 60:
        return _version_cache["value"]
    value = fetch_version()
    _version_cache.update({"value": value, "at": time.time()})
    return value


class LawServer(ThreadingHTTPServer):
    # Windows 上 SO_REUSEADDR 允许两个进程绑同一端口（Linux 语义不同），
    # 会导致悄悄启动多份服务、并发同步互相踩。
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        # Windows 专属：独占端口，别人再绑同一个端口会直接失败
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except OSError:
                pass
        super().server_bind()


def port_in_use(host, port):
    """启动前探一下：已经有服务在监听就不让起第二个。"""
    target = "127.0.0.1" if host in ("0.0.0.0", "::", "") else host
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.4)
    try:
        return probe.connect_ex((target, port)) == 0
    except OSError:
        return False
    finally:
        probe.close()


class Handler(SimpleHTTPRequestHandler):
    server_version = "LawCatalog/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- 工具 ----------

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write("[api] %s %s\n" % (self.command, self.path.split("?")[0]))

    # ---------- 路由 ----------

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            return self.handle_status()
        if path == "/api/last-update":
            return self.send_json({"ok": True, "data": read_json(LAST_UPDATE)})
        if path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "未知接口"}, 404)
        return super().do_GET()

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path == "/api/update":
            return self.handle_update("force=1" in query)
        return self.send_json({"ok": False, "error": "未知接口"}, 404)

    # ---------- 接口实现 ----------

    def handle_status(self):
        catalog = load_catalog() or {}
        meta = catalog.get("meta") or {}
        manifest = read_json(MANIFEST, {}) or {}
        upstream = cached_version()
        local_version = meta.get("upstreamVersion")
        laws = manifest.get("laws") or {}

        return self.send_json({
            "ok": True,
            "local": {
                "upstreamVersion": local_version,
                "generatedAt": meta.get("generatedAt"),
                "subjectCount": meta.get("subjectCount"),
                "lawCount": meta.get("lawCount"),
            },
            "content": {
                "lawCount": len(laws),
                "chapters": sum(x["chapters"] for x in laws.values()),
                "chars": manifest.get("totalChars", 0),
            },
            "upstream": {"version": upstream},
            "stale": bool(upstream) and local_version != upstream,
            "lastUpdate": read_json(LAST_UPDATE),
        })

    def handle_update(self, force=False):
        if not _update_lock.acquire(blocking=False):
            return self.send_json({"ok": False, "error": "正在同步中, 请稍候"}, 409)
        try:
            result = run_sync(force=force, with_content=True)
        except Exception as exc:  # 网络 / 解析 / 写盘
            info = {"at": now_iso(), "ok": False, "error": str(exc)}
            try:
                with open(LAST_UPDATE + ".tmp", "w", encoding="utf-8") as f:
                    json.dump(info, f, ensure_ascii=False, indent=2)
                os.replace(LAST_UPDATE + ".tmp", LAST_UPDATE)
            except Exception:
                pass
            return self.send_json({"ok": False, "error": str(exc)}, 502)
        finally:
            _update_lock.release()

        if result.get("busy"):
            return self.send_json({"ok": False, "error": result.get("reason")}, 409)

        _version_cache["at"] = 0.0
        return self.send_json({
            "ok": True,
            "changed": result.get("changed", True),
            "reason": result.get("reason"),
            "meta": result.get("meta"),
            "diff": result.get("diff"),
            "content": result.get("content"),
            "info": result.get("info"),
            "durationMs": result.get("durationMs"),
        })


def primary_address():
    """默认出口网卡的地址（通常是 WLAN），也就是手机该用的那个。"""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        ip = probe.getsockname()[0]
        probe.close()
        return ip
    except Exception:
        return None


def local_addresses():
    """本机所有非回环 IPv4，用来提示手机该访问哪个地址。"""
    addrs = []

    def push(ip):
        if ip and not ip.startswith("127.") and ip not in addrs:
            addrs.append(ip)

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            push(info[4][0])
    except Exception:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        push(probe.getsockname()[0])
        probe.close()
    except Exception:
        pass
    return addrs


def start_scheduler(interval_hours=24):
    """后台线程：启动时补跑一次，之后每隔几小时检查一次版本（没变则瞬间返回）。"""

    def loop():
        while True:
            acquired = _update_lock.acquire(blocking=False)
            if acquired:
                try:
                    result = run_sync(force=False, with_content=True)
                    if result.get("busy"):
                        print("[自动同步] 另一个进程正在同步，本次跳过")
                    elif result.get("changed"):
                        c = result.get("content") or {}
                        print("[自动同步] 完成：%d 部 / %d 章（版本 %s）" % (
                            c.get("lawCount", 0), c.get("chapters", 0), result.get("version")))
                    else:
                        print("[自动同步] 版本未变化（%s），跳过" % result.get("version"))
                except Exception as exc:
                    print("[自动同步] 失败：%s" % exc)
                finally:
                    _update_lock.release()
            time.sleep(interval_hours * 3600)

    thread = threading.Thread(target=loop, name="law-auto-sync", daemon=True)
    thread.start()
    return thread


def main():
    try:                      # 让日志在重定向/后台运行时也能实时看到
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="法律法规汇编 · 本地服务")
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--update-only", action="store_true", help="只同步数据后退出")
    parser.add_argument("--force", action="store_true", help="配合 --update-only 强制重抓")
    parser.add_argument("--no-auto-sync", action="store_true", help="关闭后台自动同步")
    parser.add_argument("--sync-interval", type=int, default=24, help="后台检查间隔（小时，默认 24）")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args()

    if args.update_only:
        print("同步中…")
        result = run_sync(force=args.force, with_content=True)
        if result.get("busy"):
            print("另一个进程正在同步（%s），请稍后再试。" % result.get("reason"))
            return
        c = result.get("content") or {}
        if not result.get("changed"):
            print("已是最新（版本 %s），未做改动。" % result.get("version"))
            return
        print("完成：%d 学科 / %d 部 / %d 章 / %s 字" % (
            result["meta"]["subjectCount"], result["meta"]["lawCount"],
            c.get("chapters", 0), format(c.get("chars", 0), ",")))
        return

    if port_in_use(args.bind, args.port):
        print("端口 %d 已经有服务在运行。" % args.port)
        print("多半是你之前开的窗口还开着，先关掉它；或换个端口: python server.py --port 8124")
        print("查占用: netstat -ano | findstr :%d" % args.port)
        sys.exit(1)

    try:
        server = LawServer((args.bind, args.port), Handler)
    except OSError as exc:
        print("无法监听 %s:%d —— %s" % (args.bind, args.port, exc))
        print("端口可能已被另一个 server.py 占用（同一时间只需跑一个）。")
        print("查占用: netstat -ano | findstr :%d" % args.port)
        sys.exit(1)

    print("法律法规汇编已启动")
    if args.bind in ("0.0.0.0", "::", ""):
        print("本机访问: http://127.0.0.1:%d" % args.port)
        main_ip = primary_address()
        for ip in local_addresses():
            mark = "  ← 手机用这个" if ip == main_ip else ""
            print("局域网访问: http://%s:%d%s" % (ip, args.port, mark))
        print("手机需与本机同一 WiFi；首次连接若超时，多为防火墙未放行 %d（见 DEPLOY.md）" % args.port)
    else:
        print("访问地址: http://%s:%d（仅本机）" % (args.bind, args.port))
    print("同步接口: POST /api/update（?force=1 强制） · 版本检查: GET /api/status")
    if not args.no_auto_sync:
        print("后台自动同步: 启动时 + 每 %d 小时检查一次版本" % args.sync_interval)
        start_scheduler(args.sync_interval)

    if args.open:
        host = "127.0.0.1" if args.bind in ("0.0.0.0", "::", "") else args.bind
        url = "http://%s:%d" % (host, args.port)
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        print("1 秒后自动打开浏览器: %s" % url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
