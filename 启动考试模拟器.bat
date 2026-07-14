@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON_CMD="
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  echo 未检测到 Python 3.10 或以上版本。
  echo 请先安装 Python，并勾选 Add python.exe to PATH。
  echo 下载地址：https://www.python.org/downloads/
  pause
  exit /b 1
)

%PYTHON_CMD% server.py
pause
