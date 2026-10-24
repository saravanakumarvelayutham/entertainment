import type { Page } from '@playwright/test';
import { applyTheme, expectTextContrast } from './theme-contrast';

import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    defaultStalkerMacAddress,
    defaultStalkerPortalName,
    defaultXtreamPassword,
    defaultXtreamPortalName,
    defaultXtreamUsername,
    channelItemByTitle,
    clickCategoryByNameExact,
    expect,
    expectPortalDebugSuccess,
    goToDashboard,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    stalkerMockServer,
    test,
    waitForXtreamImportToFinish,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamLiveFixture, getXtreamTitle } from './portal-mock-fixtures';

test.describe('Electron Provider Smoke Tests', () => {
    test('@xtream @theme @electron keeps sync overlay text readable in both themes', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        try {
            // Hold the cache read so the real local-library overlay stays
            // mounted while its theme and Material interaction states change.
            await app.electronApp.evaluate(({ ipcMain }) => {
                ipcMain.removeHandler('DB_GET_CATEGORIES');
                ipcMain.handle(
                    'DB_GET_CATEGORIES',
                    () =>
                        new Promise(() => {
                            // Intentionally pending until this isolated app closes.
                        })
                );
            });
            await addXtreamPortal(app.mainWindow);
            const overlay = app.mainWindow.locator(
                'app-workspace-shell-import-overlay'
            );
            await expect(overlay).toContainText('Loading the saved catalog');
            const action = overlay.getByRole('button', { name: 'Stop sync' });
            for (const theme of ['light', 'dark', 'light'] as const) {
                await applyTheme(app.mainWindow, theme);
                for (const selector of [
                    'h3',
                    '.workspace-loading-overlay__badge',
                    '.workspace-loading-overlay__phase',
                    '.workspace-loading-overlay__detail',
                ]) {
                    await expectTextContrast(overlay.locator(selector));
                }
                // Leave headroom for Material's translucent hover/focus layer.
                await expectTextContrast(action, 6);
                await action.hover();
                await expectTextContrast(action);
                await action.focus();
                await expectTextContrast(action);
                await app.mainWindow.screenshot({
                    path: test.info().outputPath(`sync-overlay-${theme}.png`),
                });
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron loads Xtream content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');

            await goToDashboard(app.mainWindow);
            await expectRecentSourceCard(
                app.mainWindow,
                defaultXtreamPortalName
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@stalker @electron loads Stalker content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                portalUrl: `${stalkerMockServer}/portal.php`,
            });
            await waitForStalkerCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'stalker');

            await goToDashboard(app.mainWindow);
            await expectRecentSourceCard(
                app.mainWindow,
                defaultStalkerPortalName
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@stalker @electron delivers cmd to the portal decoded exactly once with query injection blocked', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);

        const app = await launchElectronApp(dataDir);

        try {
            // Stored cmd with a pre-encoded token (%3A), a literal '+', and a
            // query-injection attempt (&injected=1#frag).
            const storedCmd =
                'ffrt3 http://example.com/ch/123?token=a%3Ab+c&injected=1#frag';

            const response = await app.mainWindow.evaluate(
                async ({ url, macAddress, cmd }) =>
                    window.electron.stalkerRequest({
                        url,
                        macAddress,
                        params: { action: 'create_link', type: 'itv', cmd },
                    }),
                {
                    url: `${stalkerMockServer}/portal.php`,
                    macAddress: defaultStalkerMacAddress,
                    cmd: storedCmd,
                }
            );

            const js = (
                response as {
                    js: { cmd_received: string; query_keys_received: string[] };
                }
            ).js;

            // The portal must see the stored cmd decoded exactly once —
            // %3A → ':', '+' → space — the same view it gets from a real STB.
            // The old encodeURIComponent transport double-encoded '%' and
            // delivered the %3A/+ sequences still encoded.
            expect(js.cmd_received).toBe(
                'ffrt3 http://example.com/ch/123?token=a:b c&injected=1#frag'
            );

            // The '&'/'#' inside cmd stayed inside the cmd value instead of
            // restructuring the portal query.
            expect(js.query_keys_received).toEqual([
                'JsHttpRequest',
                'action',
                'cmd',
                'type',
            ]);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron shows refresh overlay immediately from the dashboard Xtream source menu', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');

            await goToDashboard(app.mainWindow);
            await refreshRecentXtreamSourceFromDashboard(
                app.mainWindow,
                defaultXtreamPortalName
            );
            await waitForXtreamImportToFinish(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function expectRecentSourceCard(
    page: Page,
    title: string
): Promise<void> {
    await expect(page.getByTestId('dashboard-recent-sources-rail')).toBeVisible(
        {
            timeout: 20000,
        }
    );

    await expect(
        page
            .getByTestId('dashboard-recent-sources-rail-card')
            .filter({
                hasText: title,
            })
            .first()
    ).toBeVisible({
        timeout: 20000,
    });
}

async function refreshRecentXtreamSourceFromDashboard(
    page: Page,
    title: string
): Promise<void> {
    const sourceCard = page
        .getByTestId('dashboard-recent-sources-rail-card')
        .filter({
            hasText: title,
        })
        .first();

    await expect(sourceCard).toBeVisible({ timeout: 20000 });
    await sourceCard.hover();
    await sourceCard
        .getByTestId('dashboard-recent-sources-rail-card-actions')
        .click();
    await page
        .getByRole('menuitem', {
            name: 'Refresh Xtream playlist from remote',
            exact: true,
        })
        .click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();

    const refreshOverlay = page.locator('app-workspace-shell-import-overlay');
    await expect(refreshOverlay).toBeVisible({ timeout: 5000 });
    await expect(
        refreshOverlay.getByRole('heading', {
            name: 'Refreshing playlist',
            exact: true,
        })
    ).toBeVisible();
    await expect(refreshOverlay).toContainText(/Local library/);
    await expect(refreshOverlay).toContainText(
        /Preserving your library data|Removing cached streams|Removing cached categories/
    );

    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

test.describe('Electron Live TV "On now" stage', () => {
    test("@xtream @live @electron fills the player area with the category's channels before a pick and plays a tile", async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const liveFixture = await fetchXtreamLiveFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                liveFixture.categoryName
            );

            // No favorites yet, so the open category's first channels fill
            // the grid; the old "select a channel" placeholder is gone.
            const stage = app.mainWindow.getByTestId('live-on-now-stage');
            await expect(stage).toBeVisible();
            await expect(stage).toContainText('On now');
            await expect(stage).toContainText(liveFixture.categoryName);
            await expect(
                app.mainWindow.getByText(
                    'Please select a channel to start playback'
                )
            ).toHaveCount(0);

            const tiles = stage.getByTestId('live-on-now-tile');
            await expect(tiles.first()).toBeVisible();
            const fixtureTitles = liveFixture.items.map(getXtreamTitle);
            const tileName = (
                await tiles.first().locator('.tile__name').innerText()
            ).trim();
            expect(fixtureTitles).toContain(tileName);
            // The first tile is the hero and spans two grid columns.
            await expect(tiles.first()).toHaveClass(/tile--hero/);

            // A tile click takes the channel list's own selection path: the
            // sidebar row lights up, the player mounts, the stage leaves.
            await tiles.first().click();
            await expect(
                app.mainWindow.locator('app-web-player-view').first()
            ).toBeVisible({ timeout: 15000 });
            await expect(stage).toHaveCount(0);
            await expect(
                channelItemByTitle(app.mainWindow, tileName).first()
            ).toHaveClass(/active/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@stalker @live @electron shows the stage for an ITV category and a tile starts playback', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const app = await launchElectronApp(dataDir);

        try {
            // Keep the public demo stream the mock redirects to off the wire.
            await app.mainWindow.route(
                'https://test-streams.mux.dev/**',
                (route) => route.abort()
            );
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: /live|itv/i })
                .click();
            await app.mainWindow.waitForURL(/stalker.*itv/);
            const categories = app.mainWindow.locator('.category-item');
            await expect(categories.first()).toBeVisible({ timeout: 10_000 });
            await categories.first().click();

            const stage = app.mainWindow.getByTestId('live-on-now-stage');
            await expect(stage).toBeVisible({ timeout: 20_000 });
            const tiles = stage.getByTestId('live-on-now-tile');
            await expect(tiles.first()).toBeVisible();
            const tileName = (
                await tiles.first().locator('.tile__name').innerText()
            ).trim();
            expect(tileName).not.toBe('');

            await tiles.first().click();
            await expect(
                app.mainWindow.locator('app-web-player-view').first()
            ).toBeVisible({ timeout: 15_000 });
            await expect(stage).toHaveCount(0);
            await expect(
                channelItemByTitle(app.mainWindow, tileName).first()
            ).toHaveClass(/active/);
        } finally {
            await closeElectronApp(app);
        }
    });
});
