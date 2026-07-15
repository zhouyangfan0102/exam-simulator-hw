#!/bin/sh

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ -z "$SCRIPT_DIR" ] || ! cd "$SCRIPT_DIR"; then
  printf '\n无法进入考试模拟器目录。\n'
  exit 1
fi

find_python() {
  for candidate in python3 python; do
    candidate_path=$(command -v "$candidate" 2>/dev/null) || continue
    if "$candidate_path" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
      printf '%s\n' "$candidate_path"
      return 0
    fi
  done
  return 1
}

PYTHON_EXE=$(find_python)
if [ -z "$PYTHON_EXE" ]; then
  printf '\n没有找到兼容的 Python。\n'
  printf '需要 Python 3.10 或更高版本，不需要安装 pip 依赖。\n'
  printf '安装地址：https://www.python.org/downloads/macos/\n'
  printf '安装完成后，请重新打开本文件。\n\n'
  printf '按回车键关闭窗口...'
  read -r _
  exit 1
fi

"$PYTHON_EXE" "$SCRIPT_DIR/server.py"
SERVER_EXIT=$?

if [ "$SERVER_EXIT" -eq 137 ] || [ "$SERVER_EXIT" -eq 143 ]; then
  SERVER_EXIT=0
elif [ "$SERVER_EXIT" -ne 0 ]; then
  printf '\n考试模拟器异常停止，错误代码：%s\n' "$SERVER_EXIT"
  printf '可以在“终端”中进入本目录后执行：python3 server.py\n'
  printf '按回车键关闭窗口...'
  read -r _
fi

exit "$SERVER_EXIT"
