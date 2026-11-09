$ErrorActionPreference = 'Stop'
$verifier = Join-Path $PSScriptRoot '../deployment/offline/verify-package.ps1'
$artifacts = Join-Path $PSScriptRoot '../artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$root = (New-Item -ItemType Directory -Path (Join-Path $artifacts ('offline-fixture-' + [guid]::NewGuid()))).FullName
New-Item -ItemType Directory -Path (Join-Path $root 'app/wwwroot') -Force | Out-Null
$files = 'app/ProcessNavigator.Api.exe', 'app/wwwroot/index.html', 'verify-package.ps1', 'app-transition.ps1'
foreach ($file in $files) { Set-Content -LiteralPath (Join-Path $root $file) -Value "fixture: $file" }
$manifest = Join-Path $root 'manifest.sha256'
$entries = foreach ($file in $files) { (Get-FileHash -LiteralPath (Join-Path $root $file)).Hash + '  ' + $file }
function Reject([string]$Expected) {
    try { & $verifier -PackageRoot $root }
    catch { if ($_.Exception.Message -like $Expected) { return }; throw }
    throw "Verifier accepted an invalid package: $Expected"
}
Set-Content -LiteralPath $manifest -Value $entries
& $verifier -PackageRoot $root
Set-Content -LiteralPath (Join-Path $root 'unexpected.dll') -Value 'extra'
Reject 'Unexpected package file:*'
Remove-Item -LiteralPath (Join-Path $root 'unexpected.dll')
Add-Content -LiteralPath $manifest -Value ($entries[0].Substring(0, 66) + '../outside')
Reject 'Invalid manifest path:*'
Set-Content -LiteralPath $manifest -Value ($entries + $entries[0])
Reject 'Duplicate or reserved manifest path:*'
Set-Content -LiteralPath $manifest -Value $entries
Set-Content -LiteralPath (Join-Path $root $files[1]) -Value 'tampered'
Reject 'Checksum mismatch:*'
Remove-Item -LiteralPath (Join-Path $root $files[1])
Reject 'Package file is missing:*'
Remove-Item -LiteralPath $manifest
Reject '*manifest.sha256*'
Write-Host 'Offline package checks passed: 7 cases.'

. (Join-Path $PSScriptRoot '../deployment/offline/app-transition.ps1')
$install = Join-Path $root 'installation'
$source = Join-Path $root 'source'
$active = Join-Path $install 'app'
New-Item -ItemType Directory -Path (Join-Path $source 'Data') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $source 'version.txt') -Value 'first'
Set-Content -LiteralPath (Join-Path $source 'Data/record.txt') -Value 'seed'
function Assert-Value($Path, $Expected) {
    if ((Get-Content -LiteralPath $Path) -ne $Expected) { throw "Unexpected contents: $Path" }
}
Invoke-AppTransition -Root $install -Source $source -KeepCurrentData $true -Stop {} -Start {} -Resume {}
Assert-Value (Join-Path $active 'Data/record.txt') 'seed'
Set-Content -LiteralPath (Join-Path $active 'Data/record.txt') -Value 'live'
Set-Content -LiteralPath (Join-Path $source 'version.txt') -Value 'second'
Invoke-AppTransition -Root $install -Source $source -KeepCurrentData $true -Stop {} -Start {} -Resume {}
Assert-Value (Join-Path $active 'version.txt') 'second'
Assert-Value (Join-Path $active 'Data/record.txt') 'live'
$snapshot = @(Get-ChildItem -LiteralPath $install -Directory -Filter 'app.previous-*')[0]
Assert-Value (Join-Path $snapshot.FullName 'version.txt') 'first'
try {
    Invoke-AppTransition -Root $install -Source $source -KeepCurrentData $true -Stop {} -Start {
        Set-Content -LiteralPath (Join-Path $active 'Data/record.txt') -Value 'failed mutation'
        throw 'synthetic health failure'
    } -Resume { Set-Content -LiteralPath (Join-Path $install 'resumed.txt') -Value 'resumed' }
    throw 'Expected transition to fail'
} catch { if ($_.Exception.Message -notlike 'Transition failed; previous state restored:*synthetic health failure*') { throw } }
Assert-Value (Join-Path $active 'Data/record.txt') 'live'
Assert-Value (Join-Path $install 'resumed.txt') 'resumed'
Set-Content -LiteralPath (Join-Path $active 'Data/record.txt') -Value 'newer live'
Invoke-AppTransition -Root $install -Source $snapshot.FullName -KeepCurrentData $false -Stop {} -Start {} -Resume {}
Assert-Value (Join-Path $active 'version.txt') 'first'
Assert-Value (Join-Path $active 'Data/record.txt') 'live'
if (@(Get-ChildItem -LiteralPath $install -Directory -Filter 'app.previous-*').Count -ne 2) { throw 'Restore did not preserve current state' }
Write-Host 'Offline transition checks passed: fresh install, upgrade, health rollback, explicit restore.'
