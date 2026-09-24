@echo off
title Stop Coding Tutor
echo Stopping the coding tutor...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4310" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

echo Stopped. (Piston keeps running in the background so the next start is fast — that's normal.)
pause
