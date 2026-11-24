@echo off
rem Double-click to run the launcher on THIS PC for testing.
rem  - Installs what it needs the first time (node_modules, git ignores it).
rem  - Test files go in .local-data (git ignores it) so your real install is never touched.
rem  - Delete the .local-data folder any time to start fresh.
title RCT local test
cd /d "%~dp0launcher"
where node >nul 2>nul || ( echo Node.js not found. Install the LTS version from nodejs.org. & pause & exit /b 1 )
if not exist node_modules (
  echo First run: installing the launcher's tools. This takes a minute...
  call npm install --no-audit --no-fund || ( echo. & echo Install failed. Scroll up for the first error. & pause & exit /b 1 )
)
set RCT_DATA=%~dp0.local-data
echo.
echo Starting the launcher. In Settings, set the repo to  YOURNAME/RCT  so it can find your releases.
echo Close this window to stop it.
echo.
call npm start
pause
