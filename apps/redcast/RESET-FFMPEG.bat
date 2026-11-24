@echo off
cd /d "%~dp0"
echo Removing the saved ffmpeg so the right one is downloaded again for this PC...
if exist "bin\ffmpeg.exe" del /q "bin\ffmpeg.exe"
if exist "bin\ffmpeg-build.txt" del /q "bin\ffmpeg-build.txt"
call "%~dp0START.bat"
