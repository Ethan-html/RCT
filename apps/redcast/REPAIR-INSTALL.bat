@echo off
cd /d "%~dp0"
echo This deletes the downloaded runtime and encoder and installs fresh copies. It needs internet.
if exist "runtime" rmdir /s /q "runtime"
if exist "bin\ffmpeg.exe" del /q "bin\ffmpeg.exe"
if exist "bin\ffmpeg-build.txt" del /q "bin\ffmpeg-build.txt"
call "%~dp0START.bat"
