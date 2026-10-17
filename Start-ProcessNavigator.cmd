@echo off
setlocal
title Process Navigator Community
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $folder=Join-Path $env:LOCALAPPDATA 'ProcessNavigatorCommunity\launcher'; New-Item -ItemType Directory -Path $folder -Force | Out-Null; $script=Join-Path $folder 'Start-ProcessNavigator.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/Wolfhander/process-navigator-community/main/Start-ProcessNavigator.ps1' -OutFile ($script+'.download'); Move-Item -LiteralPath ($script+'.download') -Destination $script -Force; & $script"
if errorlevel 1 pause
