[CmdletBinding()]
param(
  [string]$HomePath = (Join-Path $env:LOCALAPPDATA 'ProcessNavigatorCommunity'),
  [string]$ImportFrom = '',
  [int]$Port = 5081,
  [switch]$SkipUpdate,
  [switch]$PrepareOnly,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$repositoryUrl = 'https://github.com/Wolfhander/process-navigator-community.git'
$sourcePath = Join-Path $HomePath 'source'
$runtimePath = Join-Path $HomePath 'runtime'
$dataPath = Join-Path $runtimePath 'Data'
$logPath = Join-Path $HomePath 'logs'

function Run-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}
function Quote-Argument([string]$Value) { return '"' + $Value.Replace('"', '\"') + '"' }
function Is-PortOpen([int]$Number) {
  $client = New-Object Net.Sockets.TcpClient
  try { $task = $client.ConnectAsync('127.0.0.1', $Number); return ($task.Wait(300) -and $client.Connected) }
  catch { return $false } finally { $client.Dispose() }
}
try {
  if ($Stop) {
    $statePath = Join-Path $runtimePath 'server-state.json'
    if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No recorded server session.'; exit 0 }
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    $owned = Get-Process -Id ([int]$state.processId) -ErrorAction SilentlyContinue
    if (-not $owned) { Write-Host 'Recorded server has already stopped.'; exit 0 }
    $details = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$state.processId)
    $expectedDll = Join-Path $runtimePath 'app\ProcessNavigator.Api.dll'
    if ($owned.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$state.startTicks -or -not $details.CommandLine -or $details.CommandLine.IndexOf($expectedDll, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $details.CommandLine.IndexOf($runtimePath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      throw 'Recorded PID does not match this application session. No process was stopped.'
    }
    Stop-Process -Id $owned.Id
    Write-Host 'This application server was stopped; data was retained.'
    exit 0
  }
  foreach ($program in @('git', 'dotnet', 'node')) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Required program not found: $program" }
  }
  $resolvedHome = [IO.Path]::GetFullPath($HomePath)
  if ($resolvedHome -eq [IO.Path]::GetPathRoot($resolvedHome)) { throw 'Choose a dedicated application folder, not a drive root.' }
  New-Item -ItemType Directory -Path $HomePath, $runtimePath, $logPath -Force | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath '.git'))) {
    if (Test-Path -LiteralPath $sourcePath) { throw 'Source directory exists but is not a Git checkout; it was not overwritten.' }
    Run-Checked 'git' @('clone', '--branch', 'main', $repositoryUrl, $sourcePath)
  } else {
    $origin = (& git -C $sourcePath remote get-url origin | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $origin.TrimEnd('/') -notin @($repositoryUrl, $repositoryUrl.Substring(0, $repositoryUrl.Length - 4))) {
      throw 'Unexpected origin. Refusing to update a different repository.'
    }
    $dirty = @(& git -C $sourcePath status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw 'Source checkout has local changes; they were not committed, uploaded or overwritten.' }
    if (-not $SkipUpdate) { Run-Checked 'git' @('-C', $sourcePath, 'pull', '--ff-only') }
  }
  Run-Checked 'git' @('-C', $sourcePath, 'remote', 'set-url', '--push', 'origin', 'DISABLED')
  # All mutable state lives under runtime, never under the checkout.
  if (-not (Test-Path -LiteralPath $dataPath)) {
    $seed = Join-Path $sourcePath 'backend\ProcessNavigator.Api\Data'
    if ($ImportFrom) {
      if (-not (Test-Path -LiteralPath $ImportFrom -PathType Container)) { throw 'ImportFrom directory does not exist.' }
      $seed = $ImportFrom
    }
    $staging = Join-Path $runtimePath ('Data.import-' + [Guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $seed -Destination $staging -Recurse
    $copied = @(Get-ChildItem -LiteralPath $seed -File -Recurse)
    foreach ($file in $copied) {
      $relative = $file.FullName.Substring((Resolve-Path -LiteralPath $seed).Path.TrimEnd('\').Length).TrimStart('\')
      $copy = Join-Path $staging $relative
      if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $copy).Hash) { throw 'Initial data copy verification failed; source data was not changed.' }
    }
    Move-Item -LiteralPath $staging -Destination $dataPath
    Write-Host 'Initial data copied and verified. Source data was not changed.'
  } elseif ($ImportFrom) { throw 'Runtime data already exists; import was not performed to avoid overwriting it.' }
  Write-Host "Local data: $dataPath"
  if ($PrepareOnly) { Write-Host 'Preparation completed; no server was started.'; exit 0 }
  if (Is-PortOpen $Port) { throw "Port $Port is already in use. No process was stopped. Close the previous server or choose -Port." }

  $frontend = Join-Path $sourcePath 'frontend\process-navigator-ui'
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
  if (-not $pnpm -and -not $corepack) { throw 'pnpm or Corepack is required. No global software was installed.' }
  Push-Location $frontend
  try {
    if ($pnpm) { Run-Checked $pnpm.Source @('install', '--frozen-lockfile'); Run-Checked $pnpm.Source @('build') }
    else { Run-Checked $corepack.Source @('pnpm', 'install', '--frozen-lockfile'); Run-Checked $corepack.Source @('pnpm', 'build') }
  } finally { Pop-Location }
  $appPath = Join-Path $runtimePath 'app'
  Run-Checked 'dotnet' @('publish', (Join-Path $sourcePath 'backend\ProcessNavigator.Api\ProcessNavigator.Api.csproj'), '-c', 'Release', '-o', $appPath, '--self-contained', 'false')
  $webRoot = Join-Path $runtimePath 'wwwroot'
  New-Item -ItemType Directory -Path $webRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $frontend 'dist\*') -Destination $webRoot -Recurse -Force
  # Ship refreshed template files only. Existing business data is never reset on update.
  $templates = Join-Path $dataPath 'Templates'
  New-Item -ItemType Directory -Path $templates -Force | Out-Null
  Copy-Item -Path (Join-Path $sourcePath 'backend\ProcessNavigator.Api\Data\Templates\*') -Destination $templates -Force
  $url = "http://127.0.0.1:$Port"
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
  $env:ASPNETCORE_ENVIRONMENT = 'Development'
  try {
    $arguments = (Quote-Argument (Join-Path $appPath 'ProcessNavigator.Api.dll')) + ' --contentRoot ' + (Quote-Argument $runtimePath) + ' --webroot ' + (Quote-Argument $webRoot) + ' --urls ' + $url
    $server = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList $arguments -WorkingDirectory $runtimePath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath "$stamp-out.log") -RedirectStandardError (Join-Path $logPath "$stamp-error.log")
  } finally { $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment }
  @{ processId = $server.Id; startTicks = $server.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'server-state.json') -Encoding ASCII
  $deadline = (Get-Date).AddSeconds(45)
  $ready = $false
  do {
    if ($server.HasExited) { throw "Server stopped. Inspect logs: $logPath" }
    try { $null = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  if ($ready) {
    Write-Host "Ready: $url"
    try { Start-Process $url } catch { Write-Warning 'Browser was not opened. Open the local URL manually.' }
    exit 0
  }
  # Only the process created by this invocation may be stopped here.
  if (-not $server.HasExited) { $server.Kill(); $server.WaitForExit() }
  throw "Server readiness timeout. Inspect logs: $logPath"
} catch { Write-Error $_; exit 1 }
