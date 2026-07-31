@echo off
setlocal
title AuraWave Launcher
cd /d "%~dp0"

echo ====================================================================
echo    AURAWAVE - AUDIO-TO-VIDEO CREATOR
echo ====================================================================
echo.

REM Step 1: Install and select AuraWave's private FFmpeg build.
set "FFMPEG_INSTALLER=%~dp0scripts\install_ffmpeg.ps1"
set "FFMPEG_BIN=%~dp0.tools\ffmpeg\bin"

echo [1/5] Ensuring AuraWave has the current FFmpeg release...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%FFMPEG_INSTALLER%"
if errorlevel 1 (
    echo.
    echo [ERROR] AuraWave could not install or validate its private FFmpeg build.
    echo         Check the message above and your internet connection, then retry.
    echo         AuraWave will not use an unknown or outdated system FFmpeg.
    pause
    exit /b 1
)

set "PATH=%FFMPEG_BIN%;%PATH%"
"%FFMPEG_BIN%\ffmpeg.exe" -version 2>nul | findstr /b /c:"ffmpeg version"
if errorlevel 1 (
    echo [ERROR] The downloaded FFmpeg executable did not start correctly.
    pause
    exit /b 1
)
echo.

REM Step 2: Python virtual environment.
set "VENV_DIR=.env"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

echo [2/5] Preparing isolated Python environment (%VENV_DIR%)...
if not exist "%VENV_PY%" (
    echo     No virtual environment found - creating one...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Could not create the virtual environment.
        echo         Make sure Python 3 is installed and available on PATH.
        pause
        exit /b 1
    )
)
echo.

REM Step 3: Python dependencies.
echo [3/5] Installing Python dependencies into %VENV_DIR%...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>&1
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [WARNING] Dependency install failed. Attempting to launch anyway...
)
echo.

REM Step 4: Environment is ready.
echo [4/5] AuraWave environment ready.
echo.

REM Step 5: Launch.
echo [5/5] Starting AuraWave...
echo ====================================================================
echo  Server is active while the AuraWave desktop window is open.
echo  Keep this terminal open. Press Ctrl+C or close it to shut down.
echo ====================================================================
echo.
"%VENV_PY%" desktop.py
pause
endlocal
