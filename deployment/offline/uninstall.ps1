[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\ProcessNavigator",
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$taskName = "ProcessNavigator"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-NetFirewallRule -DisplayName "Process Navigator" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($RemoveData) {
    if ((Resolve-Path $InstallRoot).Path -notlike "C:\ProgramData\ProcessNavigator*") {
        throw "Data removal is allowed only under the ProcessNavigator ProgramData directory."
    }
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    Write-Host "Application and data removed."
} else {
    $app = Join-Path $InstallRoot "app"
    if (Test-Path $app) {
        Get-ChildItem -LiteralPath $app -Force | Where-Object Name -ne "Data" | Remove-Item -Recurse -Force
    }
    Write-Host "Application removed. Data preserved at: $(Join-Path $app 'Data')"
}
