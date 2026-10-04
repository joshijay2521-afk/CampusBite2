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
  echo First run: create your local admin login.
  echo This creates a local .env file only. It is gitignored and is NOT uploaded to GitHub.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=Read-Host 'Admin username [admin]'; if([string]::IsNullOrWhiteSpace($u)){$u='admin'}; $s=Read-Host 'Admin password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {$p=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}; if($p.Length -lt 6){Write-Host 'Password must be at least 6 characters.' -ForegroundColor Red; exit 2}; @('ADMIN_USERNAME='+$u,'ADMIN_PASSWORD='+$p,'ADMIN_BOOTSTRAP_VERSION=3') | Set-Content -Encoding UTF8 '.env'; Write-Host 'Local admin configuration saved.' -ForegroundColor Green"
  if errorlevel 1 (
    echo.
    echo Admin setup was not completed.
    pause
    exit /b 1
  )
)

echo.
echo Starting CampusBite on port 3001...
echo Keep this window OPEN while the website is running.
echo.
npm start
pause
