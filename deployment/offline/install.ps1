[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\ProcessNavigator",
    [ValidateRange(1, 65535)][int]$Port = 5080,
    [switch]$OpenFirewall,
    [switch]$SkipBackup,
    [ValidatePattern('^app\.previous-[0-9a-f]{32}$')][string]$RestoreSnapshot
)

$ErrorActionPreference = 'Stop'
$taskName = 'ProcessNavigator'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$targetApp = Join-Path $InstallRoot 'app'
$exe = Join-Path $targetApp 'ProcessNavigator.Api.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator.'
}
if ($SkipBackup) { throw 'Updates require a rollback snapshot; -SkipBackup is no longer supported.' }

if ($RestoreSnapshot) {
    $sourceApp = Join-Path $InstallRoot $RestoreSnapshot
} else {
    & (Join-Path $PSScriptRoot 'verify-package.ps1')
    $sourceApp = Join-Path $PSScriptRoot 'app'
}
foreach ($required in 'ProcessNavigator.Api.exe', 'Data') {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceApp $required))) {
        throw "Source is incomplete: $required"
    }
}

. (Join-Path $PSScriptRoot 'app-transition.ps1')
$oldTask = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($oldTask -and ($oldTask.Actions.Count -ne 1 -or $oldTask.Actions[0].Execute -ne $exe)) {
    throw 'The existing scheduled task belongs to another installation.'
}
$wasRunning = $oldTask -and $oldTask.State -eq 'Running'
$taskChanged = $false
$stop = {
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') {
        Stop-ScheduledTask -InputObject $task
        for ($i = 0; $i -lt 40; $i++) {
            if ((Get-ScheduledTask -TaskName $taskName -TaskPath '\').State -ne 'Running') { return }
            Start-Sleep -Milliseconds 250
        }
        throw 'The scheduled task did not stop.'
    }
}
$start = {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use."
    }
    $address = if ($OpenFirewall) { '0.0.0.0' } else { '127.0.0.1' }
    $action = New-ScheduledTaskAction -Execute $exe -Argument "--urls http://${address}:$Port" -WorkingDirectory $targetApp
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    $runAsSystem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Settings $settings -Principal $runAsSystem -Force | Out-Null
    Set-Variable -Name taskChanged -Value $true -Scope Script
    Start-ScheduledTask -TaskName $taskName -TaskPath '\'
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            if ($response.status -eq 'healthy' -and $response.service -eq 'ProcessNavigator.Api' -and
                (Get-ScheduledTask -TaskName $taskName -TaskPath '\').State -eq 'Running') { return }
        } catch { }
    }
    throw 'The new server failed its health check.'
}
$resume = {
    if ($script:taskChanged) {
        if ($oldTask) { Register-ScheduledTask -InputObject $oldTask -TaskName $taskName -TaskPath '\' -Force | Out-Null }
        else { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false }
    }
    if ($wasRunning) { Start-ScheduledTask -TaskName $taskName -TaskPath '\' }
}
Invoke-AppTransition -Root $InstallRoot -Source $sourceApp -KeepCurrentData (-not $RestoreSnapshot) -Stop $stop -Start $start -Resume $resume

if ($OpenFirewall -and -not (Get-NetFirewallRule -DisplayName "Process Navigator $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Process Navigator $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
}
@{
    installedAt = (Get-Date).ToString('o')
    port = $Port
    url = "http://localhost:$Port"
    package = Split-Path -Leaf $sourceApp
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Encoding UTF8
Write-Host "Process Navigator available: http://localhost:$Port"
Write-Host "Data directory: $(Join-Path $targetApp 'Data')"
