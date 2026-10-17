@echo off
taskkill /IM ProcessNavigator.Api.exe /T >nul 2>&1
if errorlevel 1 (
  echo Process Navigator portable server is not running.
) else (
  echo Process Navigator portable server stopped.
)
pause
