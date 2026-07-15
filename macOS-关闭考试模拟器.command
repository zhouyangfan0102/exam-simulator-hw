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
  printf '\n关闭失败：没有找到 Python 3.10 或更高版本。\n'
  printf '请回到启动考试模拟器的“终端”窗口，按 Control+C 停止服务。\n'
  printf '按回车键关闭窗口...'
  read -r _
  exit 1
fi

"$PYTHON_EXE" - "$SCRIPT_DIR" <<'PY'
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve()
RUNTIME_FILE = ROOT / "data" / ".server-runtime.json"


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def wait_for_exit(pid: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not process_alive(pid):
            return True
        time.sleep(0.2)
    return not process_alive(pid)


def matches_project(pid: int) -> bool:
    try:
        command = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return False

    server_path = str(ROOT / "server.py")
    if server_path in command:
        return True
    if not re.search(r"(^|\s)server\.py(\s|$)", command):
        return False

    lsof = shutil.which("lsof") or "/usr/sbin/lsof"
    if not Path(lsof).exists():
        return False
    try:
        output = subprocess.check_output(
            [lsof, "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return False

    for line in output.splitlines():
        if line.startswith("n"):
            try:
                return Path(line[1:]).resolve() == ROOT
            except OSError:
                return False
    return False


if not RUNTIME_FILE.exists():
    print("考试模拟器当前没有运行。")
    raise SystemExit(0)

try:
    runtime = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
    pid = int(runtime["pid"])
    port = int(runtime["port"])
    token = str(runtime["token"])
    if pid <= 0 or not (1 <= port <= 65535) or not token:
        raise ValueError
except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
    print("关闭失败：运行记录文件内容无效。")
    print("请回到启动考试模拟器的“终端”窗口，按 Control+C 停止服务。")
    raise SystemExit(1)

if not process_alive(pid):
    RUNTIME_FILE.unlink(missing_ok=True)
    print("考试模拟器已经停止，已清理过期运行记录。")
    raise SystemExit(0)

request_error = None
try:
    payload = json.dumps({"token": token}).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/shutdown",
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=3) as response:
        response.read()
except (OSError, TimeoutError, urllib.error.URLError) as exc:
    request_error = exc

if wait_for_exit(pid, 6):
    RUNTIME_FILE.unlink(missing_ok=True)
    print("考试模拟器已关闭。")
    raise SystemExit(0)

if not matches_project(pid):
    print("关闭失败：运行记录与当前进程不匹配，为避免误关其他程序，已停止操作。")
    if request_error is not None:
        print(f"关闭请求错误：{request_error}")
    print("请回到启动考试模拟器的“终端”窗口，按 Control+C 停止服务。")
    raise SystemExit(1)

print("正常关闭请求未完成，正在结束本项目记录的服务进程...")
try:
    os.kill(pid, signal.SIGTERM)
except (ProcessLookupError, PermissionError, OSError) as exc:
    if not process_alive(pid):
        RUNTIME_FILE.unlink(missing_ok=True)
        print("考试模拟器已关闭。")
        raise SystemExit(0)
    print(f"关闭失败：{exc}")
    raise SystemExit(1)

if not wait_for_exit(pid, 5):
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except (PermissionError, OSError) as exc:
        print(f"关闭失败：{exc}")
        raise SystemExit(1)

if wait_for_exit(pid, 2):
    RUNTIME_FILE.unlink(missing_ok=True)
    print("考试模拟器已关闭。")
    raise SystemExit(0)

print("关闭失败：服务进程仍在运行。")
raise SystemExit(1)
PY

CLOSE_EXIT=$?
if [ "$CLOSE_EXIT" -ne 0 ]; then
  printf '\n按回车键关闭窗口...'
  read -r _
fi

exit "$CLOSE_EXIT"
