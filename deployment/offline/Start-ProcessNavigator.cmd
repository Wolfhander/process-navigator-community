@echo off
setlocal
cd /d "%~dp0"

if not exist "app\ProcessNavigator.Api.exe" (
  echo Process Navigator executable was not found.
  echo Extract the complete ZIP archive before starting.
  pause
  exit /b 1
)

start "Process Navigator Server" /D "%~dp0app" "%~dp0app\ProcessNavigator.Api.exe" --urls http://127.0.0.1:5080
timeout /t 3 /nobreak >nul
start "" "http://localhost:5080"

echo Process Navigator is starting at http://localhost:5080
echo Keep the server window open while you work.
endlocal
