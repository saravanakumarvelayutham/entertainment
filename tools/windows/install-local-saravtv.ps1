[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$packageJsonPath = Join-Path $repoRoot 'package.json'
$localMakerOptions = 'apps/electron-backend/src/app/options/local-install.options.json'
$installedAppPath = Join-Path $env:LOCALAPPDATA 'Programs\saravtv\SaravTV.exe'
$pipelineStartedAt = Get-Date
. (Join-Path $PSScriptRoot 'saravtv-local-toolchain.ps1')

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Stop-SaravTV {
    $running = @(Get-Process -Name SaravTV -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        return
    }

    Write-Step 'Closing the running SaravTV app so packaging files are not locked'
    foreach ($process in $running) {
        if ($process.MainWindowHandle -ne 0) {
            $null = $process.CloseMainWindow()
        }
    }
    Start-Sleep -Seconds 3
    Get-Process -Name SaravTV -ErrorAction SilentlyContinue | Stop-Process -Force
}

try {
    Push-Location $repoRoot

    Write-Step 'Checking the local toolchain'
    $nodeVersion = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Node.js is not available on PATH. Install the version in .nvmrc and retry.'
    }
    Write-Host "Node $nodeVersion"
    if ($nodeVersion -match '^v(22|24)\.(\d+)\.(\d+)$') {
        $minor = [int]$Matches[2]
        $patch = [int]$Matches[3]
        $supported = ($Matches[1] -eq '22' -and ($minor -gt 22 -or ($minor -eq 22 -and $patch -ge 3))) -or
            ($Matches[1] -eq '24' -and ($minor -gt 15 -or ($minor -eq 15 -and $patch -ge 0)))
        if (!$supported) {
            Write-Warning 'This Node version is below the repository minimum (^22.22.3 or ^24.15.0). The build will continue, but update Node if it fails.'
        }
    } else {
        Write-Warning 'This repository expects Node ^22.22.3 or ^24.15.0.'
    }

    Write-Step 'Checking dependency freshness'
    Ensure-SaravTvDependencies $repoRoot
    $sqlitePrebuild = Get-ChildItem -Path (Join-Path $repoRoot 'node_modules\.pnpm\better-sqlite3@*\node_modules\better-sqlite3\prebuilds\win32-x64.node') -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (!$sqlitePrebuild) {
        throw 'The better-sqlite3 Windows x64 prebuild is missing after dependency installation.'
    }
    Write-Host "Using native SQLite prebuild: $($sqlitePrebuild.FullName)" -ForegroundColor Green

    Stop-SaravTV
    $env:NX_DAEMON = 'false'
    $env:CI = '1'
    $env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT = 'false'
    $env:NO_COLOR = '1'
    Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue

    Write-Step 'Building a fresh Windows x64 installer from the current working tree'
    Invoke-SaravTvPnpm @(
        'run', 'make:app', '--',
        "--makerOptionsPath=$localMakerOptions"
    )

    $version = (Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json).version
    $installerPath = Join-Path $repoRoot "dist\executables\saravtv-$version-windows-x64-setup.exe"
    if (!(Test-Path $installerPath)) {
        throw "The build completed without producing $installerPath."
    }
    if ((Get-Item -LiteralPath $installerPath).LastWriteTime -lt $pipelineStartedAt) {
        throw 'The installer was not refreshed by this run; refusing to reinstall a stale build.'
    }

    Write-Step 'Verifying the packaged Electron layout and native SQLite module'
    & node tools/packaging/verify-electron-package-layout.mjs windows x64
    if ($LASTEXITCODE -ne 0) {
        throw "Package verification failed with exit code $LASTEXITCODE."
    }

    Write-Step 'Installing SaravTV for the current Windows user'
    $installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -PassThru -Wait
    if ($installer.ExitCode -ne 0) {
        throw "The SaravTV installer exited with code $($installer.ExitCode)."
    }
    if (!(Test-Path $installedAppPath)) {
        throw "SaravTV was not found at $installedAppPath after installation."
    }

    Write-Step 'Launching the freshly installed app'
    Start-Process -FilePath $installedAppPath
    $runningApp = $null
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Seconds 1
        $runningApp = Get-Process -Name SaravTV -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($runningApp) {
            break
        }
    }
    if (!$runningApp) {
        throw 'SaravTV was installed, but no running process appeared after launch.'
    }

    Write-Host "`nSaravTV $version is installed and running." -ForegroundColor Green
    Write-Host "Installer: $installerPath"
    Write-Host "Pipeline duration: $([math]::Round(((Get-Date) - $pipelineStartedAt).TotalSeconds, 1)) seconds"
} catch {
    Write-Host "`nLocal install failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
