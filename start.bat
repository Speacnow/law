@echo off
chcp 65001 >nul
title 法律法规汇编 - 本地服务
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo 未找到 Python。请先安装 Python 3.11+ 并勾选 "Add python.exe to PATH"。
  echo 下载: https://www.python.org/downloads/
  pause
  exit /b 1
)

echo 正在启动，手机和电脑都能访问...
echo 浏览器会自动打开；关闭本窗口即停止服务。
echo.

python server.py --bind 0.0.0.0 --open
pause