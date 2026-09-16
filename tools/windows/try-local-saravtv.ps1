[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'saravtv-local-toolchain.ps1')

try {
    Push-Location $repoRoot
    Write-Host "`n==> Checking the incremental development environment" -ForegroundColor Cyan
    Ensure-SaravTvDependencies $repoRoot

    $running = @(Get-Process -Name SaravTV -ErrorAction SilentlyContinue)
    foreach ($process in $running) {
        if ($process.MainWindowHandle -ne 0) {
            $null = $process.CloseMainWindow()
        }
    }
    if ($running.Count -gt 0) {
        Start-Sleep -Seconds 2
        Get-Process -Name SaravTV -ErrorAction SilentlyContinue | Stop-Process -Force
    }

    $env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT = 'false'
    Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue
    Write-Host "`n==> Starting SaravTV in incremental watch mode" -ForegroundColor Cyan
    Write-Host 'Keep this window open. Edits rebuild without creating or reinstalling an NSIS package.' -ForegroundColor Green
    Invoke-SaravTvPnpm @('run', 'serve:backend')
} catch {
    Write-Host "`nSaravTV development launch failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
