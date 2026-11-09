function Invoke-AppTransition {
    param(
        [string]$Root, [string]$Source, [bool]$KeepCurrentData,
        [scriptblock]$Stop, [scriptblock]$Start, [scriptblock]$Resume
    )
    $ErrorActionPreference = 'Stop'
    $Root = [IO.Path]::GetFullPath($Root)
    $Source = (Get-Item -LiteralPath $Source -Force).FullName
    $target = Join-Path $Root 'app'
    $token = [guid]::NewGuid().ToString('N')
    $stage = Join-Path $Root "app.stage-$token"
    $previous = Join-Path $Root "app.previous-$token"
    $failed = Join-Path $Root "app.failed-$token"
    if ($Source -eq $target -or $Source.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Use a separate package or a retained snapshot, not the active app directory.'
    }
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    function Assert-OrdinaryTree([string]$Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path is not supported: $Path" }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Assert-OrdinaryTree $child.FullName }
        }
    }
    $rootItem = Get-Item -LiteralPath $Root -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation root must not be a link.' }
    Assert-OrdinaryTree $Source
    $lock = [IO.File]::Open((Join-Path $Root 'transition.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $hadApp = Test-Path -LiteralPath $target
        $saved = $false
        $activated = $false
        New-Item -ItemType Directory -Path $stage | Out-Null
        foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
            if (-not ($hadApp -and $KeepCurrentData -and $item.Name -eq 'Data')) {
                Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse
            }
        }
        try {
            & $Stop
            if ($hadApp) {
                Assert-OrdinaryTree $target
                if ($KeepCurrentData) {
                    Copy-Item -LiteralPath (Join-Path $target 'Data') -Destination $stage -Recurse
                }
                [IO.Directory]::Move($target, $previous)
                $saved = $true
            }
            [IO.Directory]::Move($stage, $target)
            $activated = $true
            & $Start
        } catch {
            $cause = $_
            try {
                if ($activated) {
                    & $Stop
                    [IO.Directory]::Move($target, $failed)
                }
                if ($saved) { [IO.Directory]::Move($previous, $target) }
                & $Resume
            } catch {
                throw "Transition failed: $cause. Automatic recovery failed: $_. Inspect $target, $previous, $stage and $failed."
            }
            throw "Transition failed; previous state restored: $cause. Failed app, if activated: $failed."
        }
        if ($saved) { Write-Host "Previous app and data snapshot: $previous" }
    } finally { $lock.Dispose() }
}
