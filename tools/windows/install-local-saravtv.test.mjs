import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = join(import.meta.dirname, '..', '..');
const scriptPath = join(root, 'tools', 'windows', 'install-local-saravtv.ps1');
const launcherPath = join(root, 'install-saravtv-local.cmd');
const optionsPath = join(
    root,
    'apps',
    'electron-backend',
    'src',
    'app',
    'options',
    'local-install.options.json'
);

test('Windows local installer keeps the build fresh and verified', () => {
    const source = readFileSync(scriptPath, 'utf8');
    assert.match(source, /--skip-nx-cache/);
    assert.match(source, /--frozen-lockfile', '--ignore-scripts/);
    assert.match(source, /local-install\.options\.json/);
    assert.match(source, /prebuilds\\win32-x64\.node/);
    assert.match(source, /Remove-Item Env:FORCE_COLOR/);
    assert.match(source, /NX_TASKS_RUNNER_DYNAMIC_OUTPUT/);
    assert.match(source, /\$env:PATH = "\$pnpmDirectory;\$env:PATH"/);
    assert.match(source, /verify-electron-package-layout\.mjs windows x64/);
    assert.match(source, /LastWriteTime -lt \$pipelineStartedAt/);
    assert.match(source, /Start-Process -FilePath \$installerPath/);
});

test('one-click launcher delegates to the checked-in PowerShell pipeline', () => {
    const source = readFileSync(launcherPath, 'utf8');
    assert.match(source, /install-local-saravtv\.ps1/);
    assert.match(source, /pause/i);
});

test('local maker profile builds only Windows x64 and skips native rebuild', () => {
    const options = JSON.parse(readFileSync(optionsPath, 'utf8'));
    assert.equal(options.arch, 'x64');
    assert.equal(options.npmRebuild, false);
    assert.equal(options.win.target, 'nsis');
});

test('PowerShell pipeline parses on Windows', { skip: process.platform !== 'win32' }, () => {
    const escapedPath = scriptPath.replaceAll("'", "''");
    const result = spawnSync(
        'powershell.exe',
        [
            '-NoLogo',
            '-NoProfile',
            '-Command',
            `$null = [ScriptBlock]::Create((Get-Content -Raw -LiteralPath '${escapedPath}'))`,
        ],
        { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
});
