@echo off
setlocal EnableExtensions
title GIS Toolbox Desktop (Dev)
cd /d "%~dp0"

rem Must match vite.config.js (desktop mode) and src-tauri/tauri.conf.json devUrl
set "DEV_PORT=9417"

echo Starting GIS Toolbox desktop...
echo Dev UI port: %DEV_PORT%  ^(http://localhost:%DEV_PORT%^)
echo Keep this window open while you use the app.
echo Closing it will quit the desktop app.
echo.

call "%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=amd64
if errorlevel 1 (
  echo.
  echo Could not load Visual Studio C++ build tools.
  echo Open Visual Studio Installer and make sure "Desktop development with C++" is installed.
  goto :fail
)

where link >nul 2>&1
if errorlevel 1 (
  echo.
  echo link.exe still not found. C++ build tools may be incomplete.
  goto :fail
)

echo Freeing port %DEV_PORT% if something is already listening...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %DEV_PORT%;" ^
  "$pids = @();" ^
  "try { $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) } catch {}" ^
  "if (-not $pids -or $pids.Count -eq 0) {" ^
  "  $pids = @(netstat -ano | Select-String -Pattern (':{0}\s+.*LISTENING\s+(\d+)\s*$' -f $port) | ForEach-Object { if ($_.Line -match '(\d+)\s*$') { [int]$Matches[1] } } | Select-Object -Unique)" ^
  "}" ^
  "if (-not $pids -or $pids.Count -eq 0) { Write-Host ('Port {0} is free.' -f $port); exit 0 }" ^
  "foreach ($procId in $pids) {" ^
  "  if ($procId -le 0) { continue }" ^
  "  try {" ^
  "    $p = Get-Process -Id $procId -ErrorAction Stop;" ^
  "    Write-Host ('Stopping {0} (PID {1}) on port {2}...' -f $p.ProcessName, $procId, $port);" ^
  "    Stop-Process -Id $procId -Force -ErrorAction Stop;" ^
  "  } catch {" ^
  "    Write-Host ('Could not stop PID {0}: {1}' -f $procId, $_.Exception.Message);" ^
  "  }" ^
  "}" ^
  "Start-Sleep -Milliseconds 400;" ^
  "$still = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue);" ^
  "if ($still.Count -gt 0) { Write-Host ('WARNING: port {0} still in use after cleanup.' -f $port); exit 1 }" ^
  "Write-Host ('Port {0} is free.' -f $port); exit 0"
if errorlevel 1 (
  echo.
  echo Could not free port %DEV_PORT%. Close the other app using that port, then try again.
  goto :fail
)
echo.

echo Launching Tauri + Vite desktop dev server...
npm.cmd run dev:desktop
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Desktop dev exited with error code %EXIT_CODE%.
  echo If you still see a port error, something else grabbed %DEV_PORT% again.
  goto :fail
)

echo Desktop app stopped.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
