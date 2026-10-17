[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\ProcessNavigator",
    [ValidateRange(1, 65535)][int]$Port = 5080,
    [switch]$OpenFirewall,
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$taskName = "ProcessNavigator"
$sourceApp = Join-Path $PSScriptRoot "app"
$targetApp = Join-Path $InstallRoot "app"
$dataPath = Join-Path $targetApp "Data"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator."
}
if (-not (Test-Path (Join-Path $sourceApp "ProcessNavigator.Api.exe"))) {
    throw "Invalid package: app\ProcessNavigator.Api.exe is missing."
}

$manifest = Join-Path $PSScriptRoot "manifest.sha256"
if (Test-Path $manifest) {
    foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split "  ", 2
        $filePath = Join-Path $PSScriptRoot ($parts[1].Replace("/", "\"))
        if (-not (Test-Path $filePath)) { throw "Package file is missing: $($parts[1])" }
        $actual = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $parts[0]) { throw "Checksum mismatch: $($parts[1])" }
    }
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

if ((Test-Path $dataPath) -and -not $SkipBackup) {
    $backup = Join-Path $InstallRoot ("Backups\Data-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $dataPath -Destination $backup -Recurse -Force
    Write-Host "Data backup: $backup"
}

New-Item -ItemType Directory -Path $targetApp -Force | Out-Null
Get-ChildItem -LiteralPath $sourceApp -Force | Where-Object Name -ne "Data" | ForEach-Object {
    $destination = Join-Path $targetApp $_.Name
    if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
if (-not (Test-Path $dataPath)) {
    Copy-Item -LiteralPath (Join-Path $sourceApp "Data") -Destination $targetApp -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $dataPath "Keys") -Force | Out-Null

$exe = Join-Path $targetApp "ProcessNavigator.Api.exe"
$action = New-ScheduledTaskAction -Execute $exe -Argument "--urls http://0.0.0.0:$Port" -WorkingDirectory $targetApp
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$runAsSystem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $runAsSystem -Force | Out-Null

if ($OpenFirewall) {
    if (-not (Get-NetFirewallRule -DisplayName "Process Navigator" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "Process Navigator" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    }
}

Start-ScheduledTask -TaskName $taskName
$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2
        if ($response.status -eq "healthy") { $healthy = $true; break }
    } catch { }
}
if (-not $healthy) { throw "The server was installed but failed its health check. Inspect Task Scheduler and Windows Event Viewer." }

@{
    installedAt = (Get-Date).ToString("o")
    port = $Port
    url = "http://localhost:$Port"
    package = Split-Path -Leaf $PSScriptRoot
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot "installation.json") -Encoding UTF8

Write-Host "Process Navigator installed: http://localhost:$Port"
Write-Host "Data directory: $dataPath"
