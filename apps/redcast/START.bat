@echo off
cd /d "%~dp0"
title Redcast
echo Checking this PC...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

"runtime\electron\electron.exe" .
if errorlevel 1 (
  echo.
  echo The app closed with an error. Take a photo or screenshot of this window and send it over.
  pause
)
