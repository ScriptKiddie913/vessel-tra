@echo off
title SoTaNik_AI Surveillance — Launcher
cd /d "%~dp0"

echo.
echo  =========================================
echo   SoTaNik_AI Surveillance
echo   Starting server on http://localhost:8080
echo  =========================================
echo.

:: Check Python is available
python3 --version >nul 2>&1
if errorlevel 1 (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python not found. Please install Python 3.9+
        pause
        exit /b 1
    )
    set PYTHON=python
) else (
    set PYTHON=python3
)

:: Install dependencies if needed
if not exist "__deps_installed__" (
    echo Installing dependencies...
    %PYTHON% -m pip install -r requirements.txt --quiet
    echo. > __deps_installed__
    echo Dependencies installed.
)

:: Open browser after a short delay (runs in background)
echo Opening browser...
ping 127.0.0.1 -n 3 >nul
start "" "http://localhost:8080"

:: Show AIS key tip
echo.
echo  ---[ LIVE SHIP TRACKING ]-------------------------------------------
echo   Sources: Digitraffic Finland (Baltic/global, 15k+ moving ships, no key)
echo            Kystverket TCP (Norwegian EEZ, needs: pip install pyais)
echo            aisstream.io   (Global failover — key built-in)
echo.
if defined AISSTREAM_API_KEY (
    echo   AISSTREAM_API_KEY: custom key SET
) else (
    echo   AISSTREAM_API_KEY: using built-in key ^(aisstream.io failover^)
)
echo  -------------------------------------------------------------------
echo.

:: ── AIS ship tracking (global coverage via aisstream.io free tier)
if "%AISSTREAM_API_KEY%"=="" set AISSTREAM_API_KEY=8b9d8625829bd9614947be967c141babc5931e79

:: Start uvicorn server (blocking — keeps window open with logs)
echo Starting SoTaNik_AI Surveillance server...
echo Press Ctrl+C to stop.
echo.
%PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 8080

echo.
echo Server stopped.
pause
