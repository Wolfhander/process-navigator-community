[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet("win-x64", "linux-x64")]
    [string]$Runtime = "win-x64",
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repoRoot "frontend/process-navigator-ui"
if (-not $Version) {
    $Version = (Get-Content -LiteralPath (Join-Path $frontend "package.json") -Raw | ConvertFrom-Json).version
}
$apiProject = Join-Path $repoRoot "backend/ProcessNavigator.Api/ProcessNavigator.Api.csproj"
$artifacts = Join-Path $repoRoot "artifacts"
$staging = Join-Path $repoRoot ".release-staging"
$packageName = "ProcessNavigator-$Version-$Runtime-offline"
$packageRoot = Join-Path $staging $packageName
$appRoot = Join-Path $packageRoot "app"

if (Test-Path $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null

Push-Location $frontend
try {
    if (-not $SkipDependencyInstall) { & npm.cmd install }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
}
finally { Pop-Location }

& dotnet publish $apiProject --configuration Release --runtime $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $appRoot
if ($LASTEXITCODE -ne 0) { throw "API publish failed." }

$wwwroot = Join-Path $appRoot "wwwroot"
New-Item -ItemType Directory -Path $wwwroot -Force | Out-Null
Copy-Item -Path (Join-Path $frontend "dist/*") -Destination $wwwroot -Recurse -Force

Copy-Item (Join-Path $repoRoot "deployment/offline/install.ps1") $packageRoot
Copy-Item (Join-Path $repoRoot "deployment/offline/uninstall.ps1") $packageRoot
Copy-Item (Join-Path $repoRoot "deployment/offline/Start-ProcessNavigator.cmd") $packageRoot
Copy-Item (Join-Path $repoRoot "deployment/offline/Install-ProcessNavigator.cmd") $packageRoot
Copy-Item (Join-Path $repoRoot "deployment/offline/Stop-Portable.cmd") $packageRoot
Copy-Item (Join-Path $repoRoot "docs/offline-deployment.md") (Join-Path $packageRoot "INSTALLATION.md")
Copy-Item (Join-Path $repoRoot "docs/user-manual.md") (Join-Path $packageRoot "USER-MANUAL.md")
Copy-Item (Join-Path $repoRoot "integrations/one-c-extension") (Join-Path $packageRoot "one-c-extension") -Recurse

$manifest = Join-Path $packageRoot "manifest.sha256"
Get-ChildItem $packageRoot -File -Recurse | Where-Object FullName -ne $manifest | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace("\", "/")
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
} | Set-Content -LiteralPath $manifest -Encoding UTF8

$zipPath = Join-Path $artifacts "$packageName.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$zipPath.sha256" -Value "$zipHash  $([IO.Path]::GetFileName($zipPath))" -Encoding ASCII

Write-Host "Offline package: $zipPath"
Write-Host "SHA256: $zipHash"
