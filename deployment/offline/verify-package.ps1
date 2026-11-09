[CmdletBinding()]
param([string]$PackageRoot = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$root = Get-Item -LiteralPath $PackageRoot
if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Package root must be an ordinary directory.'
}
$manifest = Join-Path $root.FullName 'manifest.sha256'
$manifestItem = Get-Item -LiteralPath $manifest -Force
if ($manifestItem.PSIsContainer -or ($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Package manifest must be an ordinary file.'
}
$expected = @{}
foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
    if ($line -notmatch '^([0-9a-fA-F]{64})  ([^\\:]+)$') { throw 'Invalid package manifest line.' }
    $hash = $Matches[1]
    $relative = $Matches[2]
    foreach ($segment in $relative.Split('/')) {
        if (-not $segment -or $segment -in '.', '..' -or $segment -match '[. ]$') {
            throw "Invalid manifest path: $relative"
        }
    }
    if ($relative -eq 'manifest.sha256' -or $expected.ContainsKey($relative)) {
        throw "Duplicate or reserved manifest path: $relative"
    }
    $expected[$relative] = $hash
}
foreach ($required in 'app/ProcessNavigator.Api.exe', 'app/wwwroot/index.html', 'verify-package.ps1', 'app-transition.ps1') {
    if (-not $expected.ContainsKey($required)) { throw "Required manifest entry is missing: $required" }
}
$seen = @{}
function Test-PackageDirectory([string]$Directory, [string]$Prefix) {
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
        $relative = $Prefix + $item.Name
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Package contains a link: $relative" }
        if ($item.PSIsContainer) {
            Test-PackageDirectory $item.FullName ($relative + '/')
        } elseif ($relative -ne 'manifest.sha256') {
            if (-not $expected.ContainsKey($relative)) { throw "Unexpected package file: $relative" }
            if ((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -ne $expected[$relative]) {
                throw "Checksum mismatch: $relative"
            }
            $seen[$relative] = $true
        }
    }
}
Test-PackageDirectory $root.FullName ''
foreach ($relative in $expected.Keys) {
    if (-not $seen.ContainsKey($relative)) { throw "Package file is missing: $relative" }
}
Write-Host "Package verified: $($seen.Count) files."
