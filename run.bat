@echo off
setlocal

title AuraWave Premium Launcher

rem Always run from the folder containing this script, even if launched from elsewhere.
pushd "%~dp0" >nul

set "VENV_DIR=%~dp0.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"

echo ====================================================================
echo    AURAWAVE - PREMIUM AUDIO-TO-VIDEO CREATOR
echo ====================================================================
echo.

echo [1/4] Preparing local Python virtual environment...
if exist "%VENV_PYTHON%" goto :venvReady

call :ResolvePython
if errorlevel 1 goto :error

echo Creating virtual environment at: %VENV_DIR%
%PYTHON_BOOTSTRAP% -m venv "%VENV_DIR%"
if errorlevel 1 goto :error

:venvReady
if not exist "%VENV_PYTHON%" (
    echo [ERROR] Virtual environment Python was not found at:
    echo         %VENV_PYTHON%
    goto :error
)
echo Found virtual environment: %VENV_DIR%

echo.
echo [2/4] Installing/updating Python dependencies...
"%VENV_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :error

"%VENV_PYTHON%" -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo [3/4] Launching local browser interface...
start "" http://localhost:5000

echo.
echo [4/4] Starting AuraWave Flask Server...
echo ====================================================================
echo  Server is active on http://localhost:5000
echo  Keep this terminal window open while using the application.
echo  To shut down the server, close this window or press Ctrl+C here.
echo ====================================================================
echo.
"%VENV_PYTHON%" app.py
if errorlevel 1 goto :error

popd >nul
pause
exit /b 0

:ResolvePython
set "PYTHON_BOOTSTRAP="

where py >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_BOOTSTRAP=py"
    echo Using Python launcher: py
    exit /b 0
)

where python >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_BOOTSTRAP=python"
    echo Using Python command: python
    exit /b 0
)

where python3 >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_BOOTSTRAP=python3"
    echo Using Python command: python3
    exit /b 0
)

echo [ERROR] Python was not found.
echo Install Python 3, or make sure the Windows Python launcher ^(py^) is available.
exit /b 1

:error
echo.
echo ====================================================================
echo  AuraWave startup failed. Review the error output above.
echo ====================================================================
popd >nul
pause
exit /b 1
