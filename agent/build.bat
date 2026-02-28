@echo off
REM -------------------------------------------------------------
REM  Build agent binaries using PyInstaller
REM
REM  Run this from the agent\ directory WITH the venv activated:
REM      cd agent
REM      venv\Scripts\activate
REM      pip install pyinstaller
REM      build.bat
REM
REM  Output:
REM    - dist\SecurityMonitorAgent.exe   (console/dev run)
REM    - dist\SecurityMonitorService.exe (Windows Service for sc create)
REM
REM  Deploy to each VM:
REM      Copy both exes + config.yaml to C:\SecurityAgent\
REM      Register SecurityMonitorService.exe with sc create
REM -------------------------------------------------------------

setlocal

echo [1/2] Building SecurityMonitorAgent.exe (console)...
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

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo -- Build FAILED at step 1: SecurityMonitorAgent.exe --
    echo    Check the PyInstaller output above.
    echo ----------------------------------------------------------
    exit /b 1
)

echo [2/2] Building SecurityMonitorService.exe (SCM wrapper)...
pyinstaller ^
    --onefile ^
    --name SecurityMonitorService ^
    --console ^
    --hidden-import win32evtlog ^
    --hidden-import win32event ^
    --hidden-import win32con ^
    --hidden-import win32api ^
    --hidden-import win32security ^
    --hidden-import pywintypes ^
    --hidden-import pythoncom ^
    --hidden-import win32timezone ^
    --hidden-import win32service ^
    --hidden-import win32serviceutil ^
    --hidden-import servicemanager ^
    --hidden-import yaml ^
    --hidden-import requests ^
    --hidden-import urllib3 ^
    windows_service.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo -- Build FAILED at step 2: SecurityMonitorService.exe --
    echo    Check the PyInstaller output above.
    echo ----------------------------------------------------------
    exit /b 1
)

echo.
echo -- Build successful --
echo    Output:
echo      dist\SecurityMonitorAgent.exe
echo      dist\SecurityMonitorService.exe
echo.
echo    Deploy to each VM:
echo      1. mkdir C:\SecurityAgent
echo      2. Copy both exes + config.yaml there
echo      3. Register SecurityMonitorService.exe with sc create
echo -------------------------------------------------------------

endlocal
