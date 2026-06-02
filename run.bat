@echo off
title AuraWave Premium Launcher
echo ====================================================================
echo    AURAWARE - PREMIUM AUDIO-TO-VIDEO CREATOR
echo ====================================================================
echo.
echo [1/3] Checking Python dependencies...
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Dependency check failed. Make sure Python is in your PATH.
    echo Attempting to launch the server anyway...
)
echo.
echo [2/3] Launching local browser interface...
start http://localhost:5000
echo.
echo [3/3] Starting AuraWave Flask Server...
echo ====================================================================
echo  Server is active on http://localhost:5000
echo  Keep this terminal window open while using the application.
echo  To shut down the server, close this window or press Ctrl+C here.
echo ====================================================================
echo.
python app.py
pause
