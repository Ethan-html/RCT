@echo off
rem Double-click to run the launcher on THIS PC using your LOCAL apps (apps\redcast, apps\redcam).
rem  - Nothing is downloaded: edit a file, close the app, open it again, and you see the change.
rem  - Installs what it needs the first time (node_modules, git ignores it).
rem  - Test settings go in .local-data (git ignores it). Delete that folder to start fresh.
rem  To test the real update flow from GitHub instead, use START-LOCAL-RELEASES.bat
title RCT local test (local apps)
cd /d "%~dp0launcher"
where node >nul 2>nul || ( echo Node.js not found. Install the LTS version from nodejs.org. & pause & exit /b 1 )
if not exist node_modules\rcedit (
  echo First run: installing the launcher's tools. This takes a minute...
  call npm install --no-audit --no-fund || ( echo. & echo Install failed. Scroll up for the first error. & pause & exit /b 1 )
)
rem Redcam runs from its Python source in dev mode. Install its packages once if Python is there.
where py >nul 2>nul && ( py -3 -c "import flask, requests, keyboard" >nul 2>nul || ( echo Installing Redcam's Python packages... & py -3 -m pip install -r "%~dp0apps\redcam\requirements.txt" ) ) || echo [note] Python not found: Redcast will work, Redcam will not.
set RCT_DATA=%~dp0.local-data
set RCT_DEV_APPS=%~dp0apps
echo.
echo Starting the launcher with your local apps. Close this window to stop it.
echo.
call npm start
pause
