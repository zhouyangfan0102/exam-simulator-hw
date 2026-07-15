@echo off
setlocal EnableExtensions
cd /d "%~dp0"

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 goto run_python

py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 goto run_py

python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 goto run_python3

for /f "delims=" %%P in ('dir /b /s "%LocalAppData%\Programs\Python\Python*\python.exe" 2^>nul') do (
  "%%P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=%%P"
    goto run_path
  )
)

for /f "delims=" %%P in ('dir /b /s "%LocalAppData%\Python\pythoncore-*\python.exe" 2^>nul') do (
  "%%P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=%%P"
    goto run_path
  )
)

for /f "delims=" %%P in ('dir /b /s "%ProgramFiles%\Python*\python.exe" 2^>nul') do (
  "%%P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=%%P"
    goto run_path
  )
)

echo.
echo No compatible Python runtime was found.
echo Python 3.10 or newer is required. Anaconda and winget are not required.
echo Close and reopen this folder after installing Python, or restart Windows.
echo You can also open Command Prompt here and run: python server.py
echo Download: https://www.python.org/downloads/windows/
echo.
pause
exit /b 1

:run_python
python "%~dp0server.py"
goto after_run

:run_py
py -3 "%~dp0server.py"
goto after_run

:run_python3
python3 "%~dp0server.py"
goto after_run

:run_path
"%PYTHON_EXE%" "%~dp0server.py"

:after_run
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" (
  echo.
  echo The exam simulator stopped with error code %SERVER_EXIT%.
  echo Run python server.py in Command Prompt to view the full error.
  pause
)
exit /b %SERVER_EXIT%
