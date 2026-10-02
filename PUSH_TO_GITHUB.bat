@echo off
setlocal
cd /d "%~dp0"
title CampusBite GitHub Upload - V3

echo.
echo =====================================================
echo        CAMPUSBITE - GITHUB UPLOAD V3
echo =====================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed.
  pause
  exit /b 1
)

echo [1/5] Preparing Git...
if not exist ".git" git init
if errorlevel 1 goto FAIL

git branch -M main
git remote set-url origin https://github.com/joshijay2521-afk/CampusBite.git >nul 2>&1
if errorlevel 1 git remote add origin https://github.com/joshijay2521-afk/CampusBite.git

echo [2/5] Adding all CampusBite files...
git add .
if errorlevel 1 goto FAIL

echo [3/5] Creating commit...
git -c user.name="Jay Joshi" -c user.email="joshijay2521-afk@users.noreply.github.com" commit -m "CampusBite final hosting ready"
if errorlevel 1 (
  git diff --cached --quiet
  if errorlevel 1 goto FAIL
  echo Nothing new to commit.
)

echo [4/5] Uploading to GitHub...
git push -u origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo =====================================================
echo SUCCESS! CAMPUSBITE IS NOW ON GITHUB.
echo https://github.com/joshijay2521-afk/CampusBite
echo =====================================================
echo.
pause
exit /b 0

:PUSHFAIL
echo.
echo =====================================================
echo UPLOAD STOPPED AT GITHUB LOGIN/PERMISSION.
echo Your local files and commit are safe.
echo Complete GitHub sign-in if requested, then run
echo this same file once more.
echo =====================================================
pause
exit /b 1

:FAIL
echo.
echo =====================================================
echo SOMETHING STOPPED THE GIT UPLOAD.
echo Do not delete the CampusBite folder.
echo =====================================================
pause
exit /b 1
