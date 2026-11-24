@echo off
cd /d "%~dp0.."
where node >nul 2>nul || ( echo Node.js not found. Install the LTS version from nodejs.org. & pause & exit /b 1 )
node tools\package-app.js redcast
pause
