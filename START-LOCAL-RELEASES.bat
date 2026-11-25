@echo off
rem Double-click to run the launcher on THIS PC the way a church PC works: apps are DOWNLOADED from
rem GitHub Releases. Use this to test the update flow (prompts, Update buttons, "needs newer launcher").
rem To see your own code changes, use START-LOCAL.bat instead.
title RCT local test (GitHub releases)
cd /d "%~dp0launcher"
where node >nul 2>nul || ( echo Node.js not found. Install the LTS version from nodejs.org. & pause & exit /b 1 )
if not exist node_modules\rcedit (
  echo First run: installing the launcher's tools. This takes a minute...
  call npm install --no-audit --no-fund || ( echo. & echo Install failed. Scroll up for the first error. & pause & exit /b 1 )
)
set RCT_DATA=%~dp0.local-data-releases
set RCT_DEV_APPS=
echo.
echo Starting the launcher. Apps come from your GitHub releases. Close this window to stop it.
echo.
call npm start
pause
