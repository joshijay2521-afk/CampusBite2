@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CampusBite - Safe GitHub Upload

echo.
echo =====================================================
echo       CAMPUSBITE - SAFE GITHUB UPLOAD
 echo =====================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed. Install Git, then run this file again.
  pause
  exit /b 1
)

set "REMOTE=https://github.com/joshijay2521-afk/CampusBite2.git"

echo [1/6] Checking Git repository...
if not exist ".git" (
  git init
  if errorlevel 1 goto FAIL
)
git branch -M main
if errorlevel 1 goto FAIL

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REMOTE%"
) else (
  git remote set-url origin "%REMOTE%"
)
if errorlevel 1 goto FAIL

echo [2/6] Checking GitHub main branch...
git fetch origin main
if errorlevel 1 goto AUTHFAIL

rem Keep the final local project files, but align Git history with the existing
rem GitHub main branch so a normal push is possible without force-pushing.
echo [3/6] Aligning local Git history with GitHub...
git reset --mixed origin/main
if errorlevel 1 goto FAIL

echo [4/6] Protecting secrets and staging final project...
git add -A
if errorlevel 1 goto FAIL

git diff --cached --name-only | findstr /i /r "^\.env$ ^\.env\." >nul
if not errorlevel 1 (
  echo ERROR: A .env secret file is staged. Upload stopped for safety.
  git reset
  goto FAIL
)

echo [5/6] Creating final commit...
git -c user.name="Jay Joshi" -c user.email="joshijay2521-afk@users.noreply.github.com" commit -m "CampusBite final performance and admin fixes"
if errorlevel 1 (
  git diff --cached --quiet
  if not errorlevel 1 (
    echo No file changes were detected. GitHub may already have this version.
  ) else (
    goto FAIL
  )
)

echo [6/6] Uploading to GitHub...
git push -u origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo =====================================================
echo SUCCESS - CAMPUSBITE UPLOADED TO GITHUB
 echo Repository: https://github.com/joshijay2521-afk/CampusBite2
 echo =====================================================
echo.
pause
exit /b 0

:AUTHFAIL
echo.
echo =====================================================
echo GITHUB LOGIN/AUTHORIZATION IS REQUIRED.
echo Your local project files have NOT been deleted.
echo Sign in to GitHub if Windows asks, then run this file again.
echo =====================================================
pause
exit /b 1

:PUSHFAIL
echo.
echo =====================================================
echo GITHUB PUSH FAILED.
echo DO NOT DELETE THIS FOLDER.
echo Your local project files and commit are safe.
echo =====================================================
pause
exit /b 1

:FAIL
echo.
echo =====================================================
echo UPLOAD STOPPED TO PROTECT YOUR PROJECT.
echo DO NOT DELETE THIS FOLDER.
echo =====================================================
pause
exit /b 1
