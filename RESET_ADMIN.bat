@echo off
setlocal
cd /d "%~dp0"
title CampusBite - Reset Local Admin
cls
echo ==========================================
echo       CAMPUSBITE - RESET ADMIN LOGIN
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  pause
  exit /b 1
)
if exist ".env" del /q ".env"
echo Enter the SAME admin credentials you want to use locally.
echo This only changes the local .env file; it does not touch Supabase.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=Read-Host 'Admin username [admin]'; if([string]::IsNullOrWhiteSpace($u)){$u='admin'}; $s=Read-Host 'Admin password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {$p=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}; if($p.Length -lt 6){Write-Host 'Password must be at least 6 characters.' -ForegroundColor Red; exit 2}; @('ADMIN_USERNAME='+$u,'ADMIN_PASSWORD='+$p,'ADMIN_BOOTSTRAP_VERSION=4') | Set-Content -Encoding UTF8 '.env'; Write-Host 'Local admin configuration saved.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo Admin reset was not completed.
  pause
  exit /b 1
)
echo.
echo Local admin credentials have been reset.
echo Now run START_CAMPUSBITE.bat
pause
