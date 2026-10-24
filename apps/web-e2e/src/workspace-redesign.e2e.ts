import type { Page, TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    addStalkerPortal,
    interceptPwaProviderRequests,
    openSources,
    resetPwaMockServers,
} from './sources-pwa.helpers';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });

async function capture(page: Page, testInfo: TestInfo, name: string) {
    await expect(page.locator('mat-snack-bar-container')).toHaveCount(0, {
        timeout: 10_000,
    });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(page.viewportSize()?.width ?? 1440);
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('@web @redesign studio navigation connects browsing, details, live, sources and settings', async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(120_000);
    await resetPwaMockServers(request);
    await interceptPwaProviderRequests(page);
    const artwork = readFileSync(
        join(__dirname, 'fixtures/artwork/cinematic-landscape.svg')
    );
    await page.route(
        /^https?:\/\/(?!localhost|127\.0\.0\.1)/,
        async (route) => {
            if (route.request().resourceType() === 'image') {
                await route.fulfill({
                    contentType: 'image/svg+xml',
                    body: artwork,
                });
            } else {
                await route.fallback();
            }
        }
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/workspace/settings/general');
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save changes' });
    if (await save.isVisible()) {
        await save.click();
        await expect(save).toBeHidden();
    }
    await capture(page, testInfo, 'settings');
    await page.setViewportSize({ width: 920, height: 740 });
    const sectionHeader = page.locator('.settings-group__header');
    const firstSetting = page.locator('.setting-item').first();
    await expect
        .poll(async () => {
            const header = await sectionHeader.boundingBox();
            const item = await firstSetting.boundingBox();
            return !!header && !!item && header.y + header.height <= item.y;
        })
        .toBe(true);
    await expect
        .poll(async () => {
            const meta = await firstSetting
                .locator('.setting-item__meta')
                .boundingBox();
            const control = await firstSetting
                .locator('.setting-item__control')
                .boundingBox();
            return !!meta && !!control && meta.y + meta.height <= control.y;
        })
        .toBe(true);
    await capture(page, testInfo, 'compact-settings');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
        .locator('.global-navigation')
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    await addXtreamPortal(page, 'Studio Library');
    const category = page.locator('.context-panel .category-item').first();
    await expect(category).toBeVisible();
    await category.click();
    const card = page.locator('app-grid-list [role="button"]').first();
    await expect(card).toBeVisible();
    await expect(page.locator('.category-title')).toHaveText('Action');
    await capture(page, testInfo, 'movies');
    await card.focus();
    await card.press('Enter');
    const detail = page.locator('app-portal-detail-shell');
    await expect(detail).toBeVisible();
    await capture(page, testInfo, 'movie-detail');
    await detail.locator('.shell__back-button').click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await expect(category).toBeVisible();
    await category.click();
    await expect(page.locator('app-live-stream-layout .sidebar')).toBeVisible();
    await capture(page, testInfo, 'live-workspace');
    await openSources(page);
    await expect(
        page.locator('app-playlist-item').filter({ hasText: 'Studio Library' })
    ).toBeVisible();
    await capture(page, testInfo, 'sources');
    await addStalkerPortal(page, 'Studio Stalker');
    await expect(category).toBeVisible();
    await category.click();
    await expect(
        page.locator('app-grid-list [role="button"]').first()
    ).toBeVisible();
    await capture(page, testInfo, 'stalker-movies');
    await page.setViewportSize({ width: 871, height: 1000 });
    await expect(
        page.locator('.global-navigation .rail-link-label').first()
    ).toBeVisible();
    await capture(page, testInfo, 'compact-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-test-id="context-drawer-toggle"]').click();
    await expect(page.locator('.context-panel')).toBeVisible();
    await page.locator('[data-test-id="context-drawer-close"]').click();
    await expect(page.locator('.context-panel')).toBeHidden();
    await capture(page, testInfo, 'phone-catalog');
});
