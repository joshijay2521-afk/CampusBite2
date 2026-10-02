@echo off
title CampusBite - Start
cd /d "%~dp0"
cls
echo ==========================================
echo           CAMPUSBITE - START
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
node -v
echo.
echo Starting CampusBite...
echo Keep this window OPEN while the website is running.
echo.
npm start
pause
