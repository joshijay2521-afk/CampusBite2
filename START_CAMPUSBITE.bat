@echo off
setlocal
cd /d "%~dp0"
title CampusBite - Start
cls
echo ==========================================
echo          CAMPUSBITE - START
echo ==========================================
echo.
if not exist "server.js" (
  echo ERROR: server.js is missing.
  echo Extract the ZIP completely and run this file from the extracted folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js LTS, restart Windows, then run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo No local .env found. Using fixed local test login: admin / CampusBite@2026!
  echo This is local-only. Hosting credentials are configured in Render/Railway environment variables.
)
echo.
echo Starting CampusBite on port 3001...
echo Keep this window OPEN while the website is running.
echo.
npm start
pause
