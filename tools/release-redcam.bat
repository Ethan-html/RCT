@echo off
setlocal
title Build the Redcam release zip
cd /d "%~dp0..\apps\redcam"

where py >nul 2>nul
if errorlevel 1 ( echo [ERROR] Python 3 not found. Install it from python.org and tick "Add to PATH". & goto :fail )
where node >nul 2>nul
if errorlevel 1 ( echo [ERROR] Node.js not found. Install the LTS version from nodejs.org. & goto :fail )

echo [1/2] Bundling the Python backend into ptz-backend.exe ...
py -m pip install --upgrade pip >nul
py -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :fail
if exist backend-dist rmdir /s /q backend-dist
if exist build rmdir /s /q build
py -m PyInstaller --noconfirm --clean --onedir --name ptz-backend --distpath backend-dist --workpath build --icon icon.ico --version-file version-info.txt --add-data "index.html;." --add-data "icon.ico;." --hidden-import keyboard._winkeyboard app.py
if errorlevel 1 goto :fail

echo.
echo [2/2] Making the release zip ...
node "%~dp0package-app.js" redcam
if errorlevel 1 goto :fail
pause
exit /b 0

:fail
echo.
echo *** FAILED - scroll up to see the first error. ***
pause
exit /b 1
