@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$script=Join-Path $env:LOCALAPPDATA 'ProcessNavigatorCommunity\launcher\Start-ProcessNavigator.ps1'; if (-not (Test-Path -LiteralPath $script)) { throw 'Run Start-ProcessNavigator.cmd first.' }; & $script -Stop"
if errorlevel 1 pause
