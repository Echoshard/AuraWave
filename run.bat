@echo off
title AuraWave Launcher
echo ====================================================================
echo    AURAWARE - AUDIO-TO-VIDEO CREATOR
echo ====================================================================
echo.

REM ── Step 1: FFmpeg ────────────────────────────────────────────────────────────
echo [1/5] Checking for FFmpeg...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo     FFmpeg not found. Attempting automatic install via winget...
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [WARNING] Automatic FFmpeg install failed.
        echo           Please install FFmpeg manually and add it to your PATH:
        echo           https://ffmpeg.org/download.html
        echo           Then re-run this launcher.
        echo.
    ) else (
        REM Refresh PATH from registry so ffmpeg is usable in this session
        for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
        for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%b"
        if defined USER_PATH (
            set "PATH=%SYS_PATH%;%USER_PATH%"
        ) else (
            set "PATH=%SYS_PATH%"
        )
        echo     FFmpeg installed successfully.
    )
) else (
    echo     FFmpeg found.
)
echo.

REM ── Step 2: Python virtual environment ───────────────────────────────────────
set "VENV_DIR=.env"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

echo [2/5] Preparing isolated Python environment (%VENV_DIR%)...
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

REM ── Step 3: Python dependencies ──────────────────────────────────────────────
echo [3/5] Installing Python dependencies into %VENV_DIR%...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>&1
"%VENV_PY%" -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Dependency install failed. Attempting to launch the server anyway...
)
echo.

REM ── Step 4 & 5: Launch ───────────────────────────────────────────────────────


echo [5/5] Starting AuraWave Flask Server...
echo ====================================================================
echo  Server is active on http://localhost:5000
echo  Keep this terminal window open while using the application.
echo  To shut down the server, close this window or press Ctrl+C here.
echo ====================================================================
echo.
"%VENV_PY%" desktop.py
pause
