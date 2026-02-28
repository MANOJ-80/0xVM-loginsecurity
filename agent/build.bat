@echo off
REM ─────────────────────────────────────────────────────────────
REM  Build SecurityMonitorAgent.exe using PyInstaller
REM
REM  Run this from the agent\ directory WITH the venv activated:
REM      cd agent
REM      venv\Scripts\activate
REM      pip install pyinstaller
REM      build.bat
REM
REM  Output: dist\SecurityMonitorAgent.exe  (single file, ~15-25 MB)
REM
REM  Deploy to each VM:
REM      Copy SecurityMonitorAgent.exe + config.yaml to C:\SecurityAgent\
REM      Then register as a Windows Service (see README.md)
REM ─────────────────────────────────────────────────────────────

pyinstaller ^
    --onefile ^
    --name SecurityMonitorAgent ^
    --console ^
    --hidden-import win32evtlog ^
    --hidden-import win32event ^
    --hidden-import win32con ^
    --hidden-import win32api ^
    --hidden-import win32security ^
    --hidden-import pywintypes ^
    --hidden-import yaml ^
    --hidden-import requests ^
    --hidden-import urllib3 ^
    main.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ── Build successful ──────────────────────────────────────
    echo    Output: dist\SecurityMonitorAgent.exe
    echo.
    echo    Deploy to each VM:
    echo      1. mkdir C:\SecurityAgent
    echo      2. Copy SecurityMonitorAgent.exe + config.yaml there
    echo      3. Register as service (see README.md)
    echo ──────────────────────────────────────────────────────────
) else (
    echo.
    echo ── Build FAILED ──────────────────────────────────────────
    echo    Check the output above for errors.
    echo ──────────────────────────────────────────────────────────
)
