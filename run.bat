@echo off
title AuraWave Premium Launcher
echo ====================================================================
echo    AURAWARE - PREMIUM AUDIO-TO-VIDEO CREATOR
echo ====================================================================
echo.

REM Use an isolated virtual environment (.env) instead of the global PATH Python
set "VENV_DIR=.env"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

echo [1/4] Preparing isolated Python environment (%VENV_DIR%)...
if not exist "%VENV_PY%" (
    echo     No virtual environment found - creating one...
    python -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo [ERROR] Could not create the virtual environment.
        echo         Make sure Python 3 is installed and available on your PATH.
        pause
        exit /b 1
    )
)
echo.

echo [2/4] Installing dependencies into %VENV_DIR%...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>&1
"%VENV_PY%" -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Dependency install failed. Attempting to launch the server anyway...
)
echo.

echo [3/4] Launching local browser interface...
start http://localhost:5000
echo.

echo [4/4] Starting AuraWave Flask Server...
echo ====================================================================
echo  Server is active on http://localhost:5000
echo  Keep this terminal window open while using the application.
echo  To shut down the server, close this window or press Ctrl+C here.
echo ====================================================================
echo.
"%VENV_PY%" app.py
pause
