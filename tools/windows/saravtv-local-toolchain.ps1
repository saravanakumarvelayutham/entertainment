Set-StrictMode -Version Latest

$script:SaravTvExpectedPnpmVersion = '10.33.0'
$script:SaravTvPnpm = $null

function Initialize-SaravTvPnpm {
    if ($script:SaravTvPnpm) {
        return
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    $direct = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($direct) {
        $candidates.Add($direct.Source)
    }

    $cacheRoot = Join-Path $env:LOCALAPPDATA 'pnpm-cache\dlx'
    if (Test-Path $cacheRoot) {
        Get-ChildItem -LiteralPath $cacheRoot -Filter pnpm.cmd -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match 'node_modules\\\.bin\\pnpm\.CMD$' } |
            Sort-Object LastWriteTime -Descending |
            ForEach-Object { $candidates.Add($_.FullName) }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        try {
            $version = (& $candidate --version 2>$null).Trim()
            if ($LASTEXITCODE -eq 0 -and $version -eq $script:SaravTvExpectedPnpmVersion) {
                $script:SaravTvPnpm = $candidate
                $pnpmDirectory = Split-Path -Parent $candidate
                $env:PATH = "$pnpmDirectory;$env:PATH"
                return
            }
        } catch {
            # Keep looking for the pinned version instead of accepting a
            # broken or unrelated pnpm launcher.
        }
    }

    $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
    if ($corepack) {
        $script:SaravTvPnpm = @($corepack.Source, 'pnpm')
        return
    }

    throw "pnpm $script:SaravTvExpectedPnpmVersion was not found. Install the Node version from .nvmrc and run 'corepack enable'."
}

function Invoke-SaravTvPnpm([string[]]$CommandArguments) {
    Initialize-SaravTvPnpm
    if ($script:SaravTvPnpm -is [array]) {
        & $script:SaravTvPnpm[0] $script:SaravTvPnpm[1] @CommandArguments
    } else {
        & $script:SaravTvPnpm @CommandArguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm $($CommandArguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Test-SaravTvDependenciesCurrent([string]$RepoRoot) {
    $workspaceLock = Join-Path $RepoRoot 'pnpm-lock.yaml'
    $installedLock = Join-Path $RepoRoot 'node_modules\.pnpm\lock.yaml'
    $modulesManifest = Join-Path $RepoRoot 'node_modules\.modules.yaml'
    if (!(Test-Path $installedLock) -or !(Test-Path $modulesManifest)) {
        return $false
    }
    # Git commonly checks the workspace lock out with CRLF on Windows while
    # pnpm writes its installed snapshot with LF. Compare normalized content
    # so line endings do not force a 1,700-package relink on every launch.
    $workspaceContent = (Get-Content -Raw -LiteralPath $workspaceLock).Replace("`r`n", "`n")
    $installedContent = (Get-Content -Raw -LiteralPath $installedLock).Replace("`r`n", "`n")
    return $workspaceContent -ceq $installedContent
}

function Ensure-SaravTvDependencies([string]$RepoRoot) {
    if (Test-SaravTvDependenciesCurrent $RepoRoot) {
        Write-Host 'Dependencies already match pnpm-lock.yaml; skipping install.' -ForegroundColor Green
        return
    }

    Write-Host 'Dependency lock changed; relinking once without native lifecycle rebuilds.' -ForegroundColor Yellow
    Invoke-SaravTvPnpm @('install', '--frozen-lockfile', '--ignore-scripts')
}
