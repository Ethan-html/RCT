@echo off
rem Double-click to publish a new version of Redcast, Redcam or the launcher.
cd /d "%~dp0"
where node >nul 2>nul || ( echo Node.js not found. Install the LTS version from nodejs.org. & pause & exit /b 1 )
where git >nul 2>nul || ( echo Git not found. Install it from git-scm.com. & pause & exit /b 1 )
node tools\release.js
echo.
pause
