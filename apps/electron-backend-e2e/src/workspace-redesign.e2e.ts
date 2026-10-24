import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';

test('@electron @redesign top navigation and responsive settings render in the desktop app', async ({
    dataDir,
}, testInfo) => {
    const app = await launchElectronApp(dataDir);
    try {
        const page = app.mainWindow;
        const navigation = page.locator('.global-navigation');
        await expect(navigation).toBeVisible();
        await expect(
            navigation.getByRole('link', { name: 'Dashboard', exact: true })
        ).toBeVisible();
        await navigation.getByRole('link', { name: 'Open settings' }).click();
        await expect(
            page.locator('.settings-group__header').first()
        ).toBeVisible();
        await page.getByRole('radio', { name: 'Dark', exact: true }).click();
        const save = page.getByRole('button', { name: 'Save changes' });
        if (await save.isVisible()) {
            await save.click();
            await expect(save).toBeHidden();
        }
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setContentSize(920, 740);
        });
        const setting = page.locator('.setting-item').first();
        await expect
            .poll(async () => {
                const header = await page
                    .locator('.settings-group__header')
                    .first()
                    .boundingBox();
                const item = await setting.boundingBox();
                return !!header && !!item && header.y + header.height <= item.y;
            })
            .toBe(true);
        await expect
            .poll(() =>
                page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                )
            )
            .toBe(true);
        await page.screenshot({
            path: testInfo.outputPath('desktop-settings.png'),
        });
        await page.locator('body').focus();
        await page.keyboard.press(
            process.platform === 'darwin' ? 'Meta+K' : 'Control+K'
        );
        await expect(
            page.locator('app-workspace-command-palette')
        ).toBeVisible();
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @redesign list guide fits a short desktop player stage', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const credentials = { username: 'epg', password: 'epg' };
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const app = await launchElectronApp(dataDir);
    try {
        const page = app.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'epg');
        await page.getByTestId('epg-view-mode-list').click();
        await saveSettings(page);
        await addXtreamPortal(page, {
            name: 'Layout guide fixture',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, fixture.categoryName);
        await channelItemByTitle(page, fixture.stream.name ?? '')
            .first()
            .click();
        const content = page.locator(
            'app-live-stream-layout .content-container'
        );
        const player = content.locator('> .video-player');
        const guide = content.locator(
            '> .epg.epg--inline.epg--list:not(.epg-collapsed)'
        );
        await expect(guide).toBeVisible();
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setContentSize(871, 640);
        });
        await expect
            .poll(async () => {
                const frame = await content.boundingBox();
                const video = await player.boundingBox();
                const epg = await guide.boundingBox();
                return (
                    !!frame &&
                    !!video &&
                    !!epg &&
                    video.height >= 180 &&
                    epg.height >= 112 &&
                    epg.y + epg.height <= frame.y + frame.height + 1
                );
            })
            .toBe(true);
    } finally {
        await closeElectronApp(app);
    }
});
