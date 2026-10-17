@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Administrator rights are required. Requesting elevation...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Port 5080 -OpenFirewall
if errorlevel 1 (
  echo Installation failed. See the message above.
  pause
  exit /b 1
)
start "" "http://localhost:5080"
echo Installation completed.
pause
endlocal
