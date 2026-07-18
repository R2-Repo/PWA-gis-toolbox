@echo off
title GIS Toolbox Desktop (Dev)
cd /d "%~dp0"

echo Starting GIS Toolbox desktop...
echo Keep this window open while you use the app.
echo Closing it will quit the desktop app.
echo.

call "%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=amd64
if errorlevel 1 (
  echo.
  echo Could not load Visual Studio C++ build tools.
  echo Open Visual Studio Installer and make sure "Desktop development with C++" is installed.
  pause
  exit /b 1
)

where link >nul 2>&1
if errorlevel 1 (
  echo.
  echo link.exe still not found. C++ build tools may be incomplete.
  pause
  exit /b 1
)

npm.cmd run dev:desktop
echo.
echo Desktop app stopped.
pause