@echo off
cd /d "%~dp0"
title Coding Tutor

echo Starting the coding tutor...
echo.

docker info >nul 2>&1
if errorlevel 1 (
    echo Starting Docker Desktop, this can take a minute the first time...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    :waitdocker
    timeout /t 3 >nul
    docker info >nul 2>&1
    if errorlevel 1 goto waitdocker
)

docker compose -f piston\docker-compose.yaml up -d >nul 2>&1

start "Coding Tutor (server)" /min cmd /c "npm --prefix server start"
start "Coding Tutor (frontend)" /min cmd /c "npm --prefix frontend run dev"

echo Waiting for it to come up...
:waitapp
timeout /t 2 >nul
curl -s -o nul -w "%%{http_code}" http://localhost:5173 | findstr "200" >nul
if errorlevel 1 goto waitapp

start "" "http://localhost:5173"
echo.
echo Coding Tutor is open in your browser.
echo Closing this window will NOT stop it — use "Stop Coding Tutor.bat" for that.
pause
