import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

const MEDIA_ORIGIN = 'https://movie-companion-fixture.local';
const movie = {
    id: 438631,
    title: 'Dune',
    original_title: 'Dune',
    original_language: 'en',
    overview: 'Paul Atreides arrives on Arrakis.',
    release_date: '2021-09-15',
    runtime: 155,
    budget: 165000000,
    revenue: 407573628,
    vote_average: 7.8,
    vote_count: 9000,
    belongs_to_collection: { id: 726871, name: 'Dune Collection' },
    genres: [{ id: 878, name: 'Science Fiction' }],
    credits: {
        cast: [],
        crew: [
            { id: 1, name: 'Denis Villeneuve', job: 'Director' },
            { id: 2, name: 'Hans Zimmer', job: 'Original Music Composer' },
            { id: 3, name: 'Jon Spaihts', job: 'Screenplay' },
        ],
    },
    recommendations: {
        results: [
            {
                id: 693134,
                title: 'Dune: Part Two',
                release_date: '2024-02-27',
                vote_average: 8.2,
                vote_count: 100,
            },
        ],
    },
};

test.use({ serviceWorkers: 'block' });

async function saveIfDirty(page: Page): Promise<void> {
    const save = page.getByRole('button', { name: 'Save changes' });
    if (await save.isVisible()) {
        await save.click();
        await expect(save).toBeHidden();
    }
}

async function configure(page: Page, theme: string, metadata: boolean) {
    await page.goto('/workspace/settings/general');
    await page.locator(`[data-test-id="${theme}"]`).click();
    await saveIfDirty(page);
    await page.goto('/workspace/settings/playback');
    await page.locator('[data-test-id="select-video-player"]').click();
    await page
        .getByRole('option', { name: 'HTML5 video player', exact: true })
        .click();
    await saveIfDirty(page);
    if (!metadata) return;
    await page.goto('/workspace/settings/tmdb');
    await page.locator('[data-test-id="tmdb-enabled"] input').check();
    await page.locator('[data-test-id="tmdb-api-key"]').fill('e2e-key');
    await expect(
        page.locator('[data-test-id="tmdb-m3u-vod-details"] input')
    ).toBeChecked();
    await saveIfDirty(page);
}

async function openMovie(page: Page): Promise<void> {
    // Reuse the four-second, synthetic VP9 fixture. The legacy episode.webm
    // fixture ends after one second, before a real pause can be exercised.
    const clip = readFileSync(join(__dirname, 'fixtures/dash/clear-video.mp4'));
    await page.route(`${MEDIA_ORIGIN}/movie.mp4`, async (route) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(
            route.request().headers()['range'] ?? ''
        );
        const start = Number(range?.[1] ?? 0);
        const end = range?.[2] ? Number(range[2]) : clip.length - 1;
        await route.fulfill({
            status: range ? 206 : 200,
            headers: {
                'content-type': 'video/mp4',
                'accept-ranges': 'bytes',
                ...(range
                    ? {
                          'content-range': `bytes ${start}-${end}/${clip.length}`,
                      }
                    : {}),
            },
            body: clip.subarray(start, end + 1),
        });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog
        .getByLabel('Insert m3u(8) playlist as text')
        .fill(
            [
                '#EXTM3U',
                '#EXTINF:-1 group-title="Movies",Dune (2021) 1080p',
                `${MEDIA_ORIGIN}/movie.mp4`,
            ].join('\n')
        );
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await page.locator('[data-test-id="channel-item"]').click();
    await expect(page.locator('app-web-player-view video')).toBeVisible();
}

for (const theme of ['DARK_THEME', 'LIGHT_THEME']) {
    test(`@web @m3u @tmdb movie companion enriches the watch page without restarting playback (${theme})`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 2200, height: 1200 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        let releaseMetadata: () => void = () => undefined;
        const metadataGate = new Promise<void>((resolve) => {
            releaseMetadata = resolve;
        });
        await page.route('https://api.themoviedb.org/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            let body: unknown = {};
            if (path.endsWith('/search/movie')) body = { results: [movie] };
            if (path.endsWith(`/movie/${movie.id}`)) {
                await metadataGate;
                body = movie;
            }
            await route.fulfill({ json: body });
        });
        await configure(page, theme, true);
        await openMovie(page);
        const view = page.locator('app-web-player-view');
        const video = view.locator('video');
        await expect
            .poll(() =>
                video.evaluate(
                    (el: HTMLVideoElement) =>
                        el.currentTime > 0.5 && !el.paused && !el.ended
                )
            )
            .toBe(true);
        await view.hover();
        await view.getByRole('button', { name: 'Pause', exact: true }).click();
        const currentTime = await video.evaluate(
            (el: HTMLVideoElement) => el.currentTime
        );
        expect(currentTime).toBeGreaterThan(0);
        await expect
            .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
            .toBe(true);
        const originalVideo = await video.elementHandle();
        if (!originalVideo) throw new Error('Missing playing video');
        releaseMetadata();

        const companion = page.locator('[data-test-id="movie-companion"]');
        await expect(companion).toBeVisible();
        const facts = companion.locator('[data-test-id="movie-facts"]');
        await expect(facts).toContainText('Behind the movie');
        await expect(facts).toContainText('Hans Zimmer');
        await expect(facts).toContainText('Dune Collection');
        await expect(facts).toContainText('Jon Spaihts');
        await expect(companion).toContainText('TMDB');
        const suggestions = companion.locator(
            '[data-test-id="movie-recommendations"]'
        );
        await expect(suggestions).toContainText('More like this');
        await expect(suggestions).toContainText('Dune: Part Two');
        await expect(companion).toContainText(
            'Availability is not checked for these suggestions.'
        );
        const discovery = companion.locator(
            '[data-test-id="movie-discovery-recommendation"]'
        );
        await expect(discovery).toHaveAttribute(
            'href',
            'https://www.themoviedb.org/movie/693134'
        );
        await expect(discovery).toHaveAttribute('target', '_blank');
        await expect(
            companion.locator('[data-test-id="movie-library-recommendation"]')
        ).toHaveCount(0);
        await expect(discovery).toContainText('Explore on TMDB');
        expect(
            await video.evaluate((el, old) => el === old, originalVideo)
        ).toBe(true);
        expect(
            await video.evaluate((el: HTMLVideoElement) => el.currentTime)
        ).toBeCloseTo(currentTime, 1);

        const playerBounds = await view.boundingBox();
        const companionBounds = await companion.boundingBox();
        if (!playerBounds || !companionBounds)
            throw new Error('Missing layout');
        expect(companionBounds.x).toBeGreaterThanOrEqual(
            playerBounds.x + playerBounds.width
        );
        for (const width of [2200, 1280, 390]) {
            await page.setViewportSize({ width, height: 1200 });
            await expect
                .poll(() =>
                    page.evaluate(() => document.documentElement.scrollWidth)
                )
                .toBeLessThanOrEqual(width);
            expect(
                await companion.evaluate(
                    (el) => el.scrollWidth <= el.clientWidth
                )
            ).toBe(true);
            if (width < 1600) {
                const player = await view.boundingBox();
                const panel = await companion.boundingBox();
                if (!player || !panel)
                    throw new Error('Missing compact layout');
                expect(panel.y).toBeGreaterThanOrEqual(
                    player.y + player.height
                );
            }
            const screenshot = testInfo.outputPath(
                `movie-companion-${width}.png`
            );
            await page.screenshot({ path: screenshot, fullPage: true });
            await testInfo.attach(`movie-companion-${width}`, {
                path: screenshot,
                contentType: 'image/png',
            });
            if (width === 390) {
                // The detail shell owns its scrollbar, so a document screenshot
                // alone cannot show the facts below the player on a phone.
                await facts.scrollIntoViewIfNeeded();
                await expect(facts).toBeInViewport();
                const factsBounds = await facts.boundingBox();
                if (!factsBounds) throw new Error('Missing phone facts layout');
                expect(factsBounds.x).toBeGreaterThanOrEqual(0);
                expect(factsBounds.x + factsBounds.width).toBeLessThanOrEqual(
                    width
                );
                const phoneFacts = testInfo.outputPath(
                    'movie-companion-phone-facts.png'
                );
                await page.screenshot({ path: phoneFacts });
                await testInfo.attach('movie-companion-phone-facts', {
                    path: phoneFacts,
                    contentType: 'image/png',
                });
            }
        }
    });
}

test('@web @m3u movie companion respects disabled metadata', async ({
    page,
}) => {
    const metadataRequests: string[] = [];
    await page.route('https://api.themoviedb.org/**', async (route) => {
        metadataRequests.push(route.request().url());
        await route.fulfill({ json: {} });
    });
    await configure(page, 'DARK_THEME', false);
    await openMovie(page);
    await expect
        .poll(() =>
            page
                .locator('app-web-player-view video')
                .evaluate((el: HTMLVideoElement) => el.currentTime)
        )
        .toBeGreaterThan(1);
    await expect(page.locator('[data-test-id="movie-companion"]')).toHaveCount(
        0
    );
    expect(metadataRequests).toEqual([]);
});
