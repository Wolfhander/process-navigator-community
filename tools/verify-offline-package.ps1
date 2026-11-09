$ErrorActionPreference = 'Stop'
$verifier = Join-Path $PSScriptRoot '../deployment/offline/verify-package.ps1'
$artifacts = Join-Path $PSScriptRoot '../artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$root = (New-Item -ItemType Directory -Path (Join-Path $artifacts ('offline-fixture-' + [guid]::NewGuid()))).FullName
New-Item -ItemType Directory -Path (Join-Path $root 'app/wwwroot') -Force | Out-Null
$files = 'app/ProcessNavigator.Api.exe', 'app/wwwroot/index.html', 'verify-package.ps1'
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
