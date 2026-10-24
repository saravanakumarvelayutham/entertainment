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

test('@web @redesign cinematic browsing reacts to the pointer and movie rows scroll right', async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
        const records: { scene: string; names: string[] }[] = [];
        Object.defineProperty(window, 'sceneTransitions', { value: records });
        const start = document.startViewTransition.bind(document);
        Object.defineProperty(document, 'startViewTransition', {
            value: (update: () => Promise<void>) => {
                const transition = start(update);
                void transition.ready
                    .then(() =>
                        records.push({
                            scene:
                                document.documentElement.dataset
                                    .workspaceScene ?? '',
                            names: document
                                .getAnimations()
                                .map((animation) =>
                                    'animationName' in animation
                                        ? String(animation.animationName)
                                        : ''
                                ),
                        })
                    )
                    .catch(() => undefined);
                return transition;
            },
        });
    });
    await resetPwaMockServers(request);
    await interceptPwaProviderRequests(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
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
                await route.fulfill({
                    contentType: 'application/json',
                    body: '[]',
                });
            }
        }
    );
    await page.route(/\/movie\/user1\/pass1\//, (route) =>
        route.fulfill({
            contentType: 'video/webm',
            path: join(__dirname, 'fixtures/playback/episode.webm'),
        })
    );
    await page.goto('/workspace/settings/general');
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await page.locator('[data-test-id="select-workspace-motion"]').click();
    await page
        .getByRole('option', { name: 'Full motion', exact: true })
        .click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
        page.getByRole('button', { name: 'Save changes' })
    ).toBeHidden();
    const navigation = page.locator('.global-navigation');
    await navigation
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    const marker = page.locator('.global-links .rail-links');
    await expect(marker).toHaveAttribute('data-workspace-nav-ready', '');
    const initialMarker = await marker.evaluate((element) =>
        element.style.getPropertyValue('--workspace-nav-x')
    );
    await navigation
        .getByRole('link', { name: 'Sources', exact: true })
        .click();
    await expect
        .poll(() =>
            marker.evaluate((element) =>
                element.style.getPropertyValue('--workspace-nav-x')
            )
        )
        .not.toBe(initialMarker);
    await addXtreamPortal(page, 'Cinematic Library');
    await page.locator('.context-panel .category-item').first().click();
    const cards = page.locator('app-grid-list mat-card');
    await expect(cards.nth(6)).toBeVisible();
    for (let index = 0; index < 7; index++) {
        await cards.nth(index).click();
        if (index === 0) {
            const detailPoster = page
                .locator('app-content-hero .poster')
                .last();
            await expect(detailPoster).toHaveCSS('animation-name', 'none');
            await expect(
                page.locator('app-content-hero .hero__backdrop-image')
            ).toHaveCSS('animation-name', 'none');
            const backdrop = page.locator(
                'app-content-hero .hero__backdrop-image'
            );
            const before = await backdrop.boundingBox();
            await page.locator('app-content-hero .details__title').hover();
            await detailPoster.hover();
            await expect(detailPoster).toHaveAttribute(
                'data-workspace-pointer-active',
                ''
            );
            await expect(detailPoster).not.toHaveCSS('transform', 'none');
            // Hover may legitimately scroll a tall detail page. The artwork's
            // own size, horizontal position and transforms must stay stable.
            expect(await backdrop.boundingBox()).toMatchObject({
                x: before?.x,
                width: before?.width,
                height: before?.height,
            });
            await expect(backdrop).toHaveCSS('translate', 'none');
            await expect(backdrop).toHaveCSS('scale', 'none');
            await expect(
                page.locator('app-content-hero .hero')
            ).not.toHaveAttribute('data-workspace-pointer-active');
        }
        const favorite = page.locator('[data-testid="vod-favorite-toggle"]');
        await favorite.click();
        await expect(favorite).toHaveAttribute('aria-pressed', 'true');
        if (index === 6) {
            await page
                .locator('app-portal-detail-shell .play-btn')
                .first()
                .click();
        } else {
            await page
                .locator('app-portal-detail-shell .shell__back-button')
                .click();
        }
    }
    await navigation
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    await navigation
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    const favoriteCard = page.locator('.content-card').first();
    await favoriteCard.hover();
    await expect(favoriteCard).toHaveAttribute(
        'data-workspace-pointer-active',
        ''
    );
    await expect(favoriteCard.locator('.thumbnail-wrapper')).not.toHaveCSS(
        'transform',
        'none'
    );
    await favoriteCard.locator('.content-card__activation').click();
    await expect(page.locator('app-content-hero')).toBeVisible();
    await page.locator('app-portal-detail-shell .shell__back-button').click();
    await expect(favoriteCard).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() =>
                (
                    window as Window & {
                        sceneTransitions: { scene: string; names: string[] }[];
                    }
                ).sceneTransitions.some((record) =>
                    record.names.includes('workspace-detail-in')
                )
            )
        )
        .toBe(true);
    await expect
        .poll(() =>
            page.evaluate(() =>
                (
                    window as Window & {
                        sceneTransitions: { scene: string; names: string[] }[];
                    }
                ).sceneTransitions.some(
                    (record) =>
                        record.scene === 'detail-close' &&
                        record.names.includes('workspace-library-return')
                )
            )
        )
        .toBe(true);
    await navigation
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    const hero = page.locator('[data-test-id="dashboard-hero"]');
    await expect(hero).toBeVisible();
    const heroBox = await hero.boundingBox();
    expect(heroBox?.width).toBeGreaterThan(1100);
    expect(heroBox?.height).toBeGreaterThan(500);
    await capture(page, testInfo, 'cinematic-stage');
    const continueTrack = page
        .locator('.rail__track[data-layout="landscape"]')
        .first();
    // Continue Watching is a stable resume target, even in Full motion.
    await expect(continueTrack).not.toHaveAttribute('data-auto-rolling');
    await expect(continueTrack).not.toHaveClass(/rail__track--auto-roll/);
    await expect(
        page.locator(
            '[data-test-id="dashboard-continue-watching-rail"] .rail__auto-roll'
        )
    ).toHaveCount(0);
    const rail = page.locator('[data-test-id="dashboard-favorite-vod-rail"]');
    const track = rail.locator('.rail__track');
    await rail.scrollIntoViewIfNeeded();
    await page.mouse.move(10, 10);
    await expect(track).toHaveAttribute('data-auto-rolling', '');
    await expect(track).toHaveCSS('scroll-snap-type', 'none');
    const rollingStart = await track.evaluate((element) => element.scrollLeft);
    await expect
        .poll(() => track.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(rollingStart + 12);
    // Exercise the real seam without waiting for an entire catalog lap.
    const period = await track.evaluate((element) => {
        const first = element.firstElementChild as HTMLElement;
        const copy = element.querySelector<HTMLElement>('[data-rail-copy]');
        return copy ? copy.offsetLeft - first.offsetLeft : 0;
    });
    expect(period).toBeGreaterThan(0);
    await track.evaluate((element, seam) => {
        element.scrollLeft = seam - 2;
    }, period);
    await expect
        .poll(() => track.evaluate((element) => element.scrollLeft))
        .toBeLessThan(80);
    const wrapped = await track.evaluate((element) => element.scrollLeft);
    await expect
        .poll(() => track.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(wrapped + 12);
    await rail.locator('.rail__title').hover();
    await expect(track).not.toHaveAttribute('data-auto-rolling');
    const hoverPause = await track.evaluate((element) => element.scrollLeft);
    await page.waitForTimeout(250);
    expect(await track.evaluate((element) => element.scrollLeft)).toBe(
        hoverPause
    );
    await rail
        .getByRole('button', { name: 'Pause automatic scrolling', exact: true })
        .click();
    await page.mouse.move(10, 10);
    await expect(track).not.toHaveAttribute('data-auto-rolling');
    await rail
        .getByRole('button', {
            name: 'Resume automatic scrolling',
            exact: true,
        })
        .click();
    await page.mouse.move(10, 10);
    await expect(track).toHaveAttribute('data-auto-rolling', '');
    const next = rail.getByRole('button', {
        name: 'Scroll right',
        exact: true,
    });
    await expect(next).toBeEnabled();
    await expect(next).toHaveCSS('opacity', '1');
    await rail.locator('.rail__title').hover();
    const beforePaging = await track.evaluate((element) => element.scrollLeft);
    await next.click();
    await expect
        .poll(() =>
            track.evaluate(
                (element, start) =>
                    Math.abs(
                        element.scrollLeft - start - element.clientWidth * 0.85
                    ),
                beforePaging
            )
        )
        .toBeLessThan(2);
    await track.focus();
    await track.press('ArrowLeft');
    await expect
        .poll(() =>
            track.evaluate(
                (element, start) => Math.abs(element.scrollLeft - start),
                beforePaging
            )
        )
        .toBeLessThan(2);
    const poster = rail.locator('.rail__card').first();
    await poster.scrollIntoViewIfNeeded();
    const box = await poster.boundingBox();
    if (!box) throw new Error('Poster bounds missing');
    await poster.hover({
        position: { x: box.width * 0.85, y: box.height * 0.2 },
    });
    await expect(poster).toHaveAttribute('data-workspace-pointer-active', '');
    await expect(rail.locator('.rail__art').first()).not.toHaveCSS(
        'transform',
        'none'
    );
    await expect
        .poll(() =>
            poster.evaluate((element) =>
                parseFloat(element.style.getPropertyValue('--workspace-tilt-y'))
            )
        )
        .toBeGreaterThan(0);
    await capture(page, testInfo, 'cinematic-poster-depth');
    await page.setViewportSize({ width: 390, height: 844 });
    await hero.scrollIntoViewIfNeeded();
    await capture(page, testInfo, 'cinematic-phone');
});

test('@web @redesign workspace motion follows system preferences in both themes', async ({
    page,
    request,
}) => {
    await resetPwaMockServers(request);
    await interceptPwaProviderRequests(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/workspace/settings/general');

    for (const theme of ['Dark', 'Light']) {
        await page.getByRole('radio', { name: theme, exact: true }).click();
        const save = page.getByRole('button', { name: 'Save changes' });
        await expect(save).toBeVisible();
        await save.click();
        await expect(save).toBeHidden();
        const sources = page.locator('.global-navigation').getByRole('link', {
            name: 'Sources',
            exact: true,
        });
        await sources.click();
        const routeHost = page.locator(
            '.workspace-content > router-outlet + *'
        );
        await expect(routeHost).toHaveCSS('animation-name', 'none');
        // A transform on this ancestor would change fixed/native video bounds.
        await expect(routeHost).toHaveCSS('transform', 'none');
        await expect(routeHost).toHaveCSS('translate', 'none');
        await sources.hover();
        await expect(sources.locator('mat-icon')).toHaveCSS(
            'translate',
            '0px -3px'
        );

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(routeHost).toHaveCSS('animation-name', 'none');
        await expect(sources.locator('mat-icon')).toHaveCSS(
            'translate',
            'none'
        );
        await expect(sources).toHaveCSS('transition-duration', '0s');

        await page
            .locator('.global-navigation')
            .getByRole('link', {
                name: 'Open settings',
                exact: true,
            })
            .click();
        await expect(routeHost).toHaveCSS('animation-name', 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
    }

    await addXtreamPortal(page, 'Motion Library');
    await page.locator('.context-panel .category-item').first().click();
    await expect(page.locator('.category-title')).toHaveText('Action');
    await expect(page.locator('app-grid-list .grid-skeleton-card')).toHaveCount(
        0
    );
    await expect(page.locator('html')).not.toHaveAttribute(
        'data-workspace-scene'
    );
    const poster = page.locator('app-grid-list mat-card').first();
    await expect(poster).toHaveCSS('animation-name', 'none');
    await poster.hover();
    // Scroll intentionally releases tilt; send the measured movement after
    // the viewport's scroll events and paint have settled.
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    const posterBox = await poster.boundingBox();
    if (!posterBox) throw new Error('Poster has no bounds');
    await page.mouse.move(
        posterBox.x + posterBox.width * 0.85,
        posterBox.y + posterBox.height * 0.2
    );
    await expect(poster).toHaveAttribute('data-workspace-pointer-active', '');
    await expect
        .poll(() =>
            poster.evaluate((element) =>
                parseFloat(element.style.getPropertyValue('--workspace-tilt-y'))
            )
        )
        .toBeGreaterThan(0);
    await expect(poster).not.toHaveCSS('transform', 'none');
    await page
        .locator('.global-navigation')
        .getByRole('link', {
            name: 'Dashboard',
            exact: true,
        })
        .click();
    const masthead = page.locator('.dashboard-masthead');
    await expect(masthead).toBeVisible();
    await expect(masthead).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.workspace-content')).toHaveCSS(
        'view-transition-name',
        'workspace-scene'
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(masthead).toHaveCSS('animation-name', 'none');

    await page
        .getByRole('link', { name: 'Open settings', exact: true })
        .click();
    const motionSelect = page.locator(
        '[data-test-id="select-workspace-motion"]'
    );
    await motionSelect.click();
    await page
        .getByRole('option', { name: 'Full motion', exact: true })
        .click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('html')).toHaveAttribute(
        'data-workspace-motion',
        'full'
    );
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
        'data-workspace-motion',
        'full'
    );
    await page
        .locator('.global-navigation')
        .getByRole('link', { name: 'Sources', exact: true })
        .click();
    await expect(
        page.locator('.workspace-content > router-outlet + *')
    ).toHaveCSS('animation-name', 'none');

    await page
        .getByRole('link', { name: 'Open settings', exact: true })
        .click();
    await motionSelect.click();
    await page
        .getByRole('option', { name: 'Reduced motion', exact: true })
        .click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page
        .locator('.global-navigation')
        .getByRole('link', { name: 'Sources', exact: true })
        .click();
    await expect(
        page.locator('.workspace-content > router-outlet + *')
    ).toHaveCSS('animation-name', 'none');
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
    // Finish finite entrances/transitions while leaving ambient artwork running.
    await page.evaluate(async () => {
        await Promise.all(
            document
                .getAnimations()
                .filter((animation) =>
                    Number.isFinite(
                        animation.effect?.getTiming().iterations ?? 1
                    )
                )
                .map((animation) => animation.finished.catch(() => undefined))
        );
    });
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
    await expect(save).toBeVisible();
    await save.click();
    await expect(save).toBeHidden();
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
