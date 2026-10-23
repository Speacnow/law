#!/usr/bin/env bash
# macOS / Linux 启动脚本
set -e
cd "$(dirname "$0")"

(sleep 2 && (command -v open >/dev/null && open http://127.0.0.1:8123 || \
             command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8123)) >/dev/null 2>&1 &

exec python3 server.py
