@echo off
title AuraWave Export Tests
echo ====================================================================
echo    AURAWARE - Export Pipeline Test Suite
echo ====================================================================
echo.

set "VENV_PY=.env\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo [ERROR] Virtual environment not found at .env\
    echo         Run run.bat first to create and populate it.
    pause
    exit /b 1
)

echo Running export pipeline tests...
echo.
"%VENV_PY%" test_export.py
echo.
echo ====================================================================
if %errorlevel% equ 0 (
    echo  ALL TESTS PASSED
) else (
    echo  SOME TESTS FAILED  ^(see above^)
)
echo ====================================================================
pause
