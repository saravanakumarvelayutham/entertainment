import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

const MEDIA_HOST = 'https://watching-insights-fixture.local';
const PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="insights-news" group-title="News",Insights News',
    `${MEDIA_HOST}/news.m3u8`,
    '#EXTINF:-1 tvg-id="insights-culture" group-title="Culture",Insights Culture',
    `${MEDIA_HOST}/culture.m3u8`,
].join('\n');

test.use({ serviceWorkers: 'block' });

const insights = (page: Page) => page.locator('[data-test-id="insights-page"]');
const liveCount = (page: Page) =>
    page.locator('[data-test-id="insights-history-live"]');

async function importChannels(
    page: Page,
    playlist = PLAYLIST,
    expectedCount = '2 channels'
): Promise<void> {
    // The test exercises recorded selection, not measured playback duration.
    // Keep the stream local and deterministic without contacting a real source.
    await page.route(`${MEDIA_HOST}/**`, (route) =>
        route.fulfill({
            contentType: 'application/vnd.apple.mpegurl',
            body: '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST\n',
        })
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(playlist);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await expect(page.getByText(expectedCount, { exact: true })).toBeVisible();
}

async function mockMovieMetadata(page: Page): Promise<void> {
    const movie = {
        id: 987654321,
        title: 'Night Signal',
        original_title: 'Night Signal',
        release_date: '2024-05-10',
        overview: 'A night-shift archivist follows an unexplained broadcast.',
        runtime: 104,
        vote_count: 450,
        vote_average: 7.9,
        genre_ids: [9648],
        genres: [{ id: 9648, name: 'Mystery' }],
        poster_path: '/night-signal-poster.jpg',
        backdrop_path: '/night-signal-backdrop.jpg',
        credits: { cast: [], crew: [] },
    };
    await page.route('https://api.themoviedb.org/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        const body = path.endsWith('/search/movie')
            ? { results: [movie] }
            : path.endsWith(`/movie/${movie.id}`)
              ? movie
              : path.includes('/genre/')
                ? { genres: movie.genres }
                : { results: [] };
        return route.fulfill({ json: body });
    });
    // Artwork URLs remain the metadata service's canonical TMDB URLs. Only the
    // HTTP response is a tiny local fixture, so this never fetches remote art.
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#243b53"/></svg>',
        })
    );
}

async function selectChannel(page: Page, name: string): Promise<void> {
    await page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: name })
        .click();
    // Selecting another row must wait for the actual player host to mount.
    await expect(page.locator('app-web-player-view')).toBeVisible();
}

test('@web @insights empty history invites browsing without invented statistics', async ({
    page,
}) => {
    await page.goto('/workspace/insights');
    await expect(insights(page)).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Your next chapter starts here' })
    ).toBeVisible();
    for (const kind of ['movies', 'series', 'live']) {
        await expect(
            page.locator(`[data-test-id="insights-history-${kind}"]`)
        ).toHaveText('0');
    }
    const browse = page.getByRole('link', {
        name: 'Browse sources',
        exact: true,
    });
    await browse.focus();
    await browse.press('Enter');
    await expect(page).toHaveURL(/\/workspace\/sources$/);
});

test('@web @insights real M3U selections feed persisted distinct-channel insights', async ({
    page,
}, testInfo) => {
    await importChannels(page);
    await selectChannel(page, 'Insights News');
    await selectChannel(page, 'Insights Culture');
    await selectChannel(page, 'Insights News');

    // Navigate through the shell so this covers discovery of the new destination.
    await page.getByRole('link', { name: 'Your taste', exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/insights$/);
    await expect(liveCount(page)).toHaveText('2');
    await expect(
        page.locator('[data-test-id="insights-history-movies"]')
    ).toHaveText('0');
    await expect(
        page.locator('[data-test-id="insights-history-series"]')
    ).toHaveText('0');
    await page.getByText('Your recorded history', { exact: false }).click();
    await expect(
        insights(page).getByRole('link', { name: /Insights News/ })
    ).toBeVisible();
    await expect(
        insights(page).getByRole('link', { name: /Insights Culture/ })
    ).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('watching-insights-live.png'),
        fullPage: true,
    });

    await page.reload();
    await expect(liveCount(page)).toHaveText('2');
    // Reopen through the history link, exercising its playback navigation state.
    await page.getByText('Your recorded history', { exact: false }).click();
    await insights(page)
        .getByRole('link', { name: /Insights News/ })
        .click();
    await expect(page).toHaveURL(/\/workspace\/playlists\/.+\/recent$/);
    await expect(page.locator('app-web-player-view')).toBeVisible();
    await page.getByRole('link', { name: 'Your taste', exact: true }).click();
    await expect(liveCount(page)).toHaveText('2');
});

test('@web @insights @tmdb recognized movie history enriches the shared taste profile', async ({
    page,
}, testInfo) => {
    await mockMovieMetadata(page);
    await page.goto('/workspace/settings/tmdb');
    await page.locator('[data-test-id="tmdb-enabled"] input').check();
    await page.locator('[data-test-id="tmdb-api-key"]').fill('e2e-key');
    await expect(
        page.locator('[data-test-id="tmdb-m3u-vod-details"] input')
    ).toBeChecked();
    const save = page.getByRole('button', { name: 'Save changes' });
    await save.click();
    await expect(save).toBeHidden();
    await importChannels(
        page,
        [
            '#EXTM3U',
            '#EXTINF:-1 group-title="Movies",Night Signal (2024)',
            `${MEDIA_HOST}/night-signal.mp4`,
        ].join('\n'),
        '1 channels'
    );
    const clip = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    await page.route(`${MEDIA_HOST}/night-signal.mp4`, (route) =>
        route.fulfill({ contentType: 'video/webm', body: clip })
    );
    await page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: 'Night Signal (2024)' })
        .click();
    const detail = page.locator('app-m3u-vod-detail');
    await expect(detail).toBeVisible();
    await expect(
        detail.getByText('Mystery', { exact: true }).first()
    ).toBeVisible();
    await page.getByRole('link', { name: 'Your taste', exact: true }).click();
    const count = page.locator('[data-test-id="insights-history-movies"]');
    await expect(count).toHaveText('1');
    await expect(liveCount(page)).toHaveText('0');
    await expect(
        page
            .locator('[data-test-id="insights-genres"]')
            .getByRole('button', { name: /Mystery/ })
    ).toBeVisible();
    await expect(
        page.locator('[data-test-id="insights-hero"] h1')
    ).toContainText('Mystery');
    await expect(page.locator('.taste-hero__art')).toHaveAttribute(
        'src',
        'https://image.tmdb.org/t/p/w1280/night-signal-backdrop.jpg'
    );
    await page.screenshot({
        path: testInfo.outputPath('watching-insights-movie.png'),
        fullPage: true,
    });
    await page.reload();
    await expect(count).toHaveText('1');
    await expect(
        page.locator('[data-test-id="insights-hero"] h1')
    ).toContainText('Mystery');
    await page.getByText('Your recorded history', { exact: false }).click();
    await expect(
        insights(page).getByRole('link', { name: /Night Signal/ })
    ).toBeVisible();
});

for (const theme of ['Light', 'Dark'] as const) {
    test(`@web @insights mobile ${theme.toLowerCase()} layout retains native keyboard filters`, async ({
        page,
    }, testInfo) => {
        await page.goto('/workspace/settings/general');
        await page
            .locator('[data-test-id="select-theme"][role="radiogroup"]')
            .getByRole('radio', { name: theme, exact: true })
            .click();
        const save = page.getByRole('button', { name: 'Save changes' });
        await save.click();
        await expect(save).toBeHidden();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/workspace/insights');
        await expect(insights(page)).toBeVisible();
        const filter = page.locator('[data-test-id="insights-content-filter"]');
        await filter.focus();
        await expect(filter).toBeFocused();
        await filter.press('Home');
        await filter.press('ArrowDown');
        await filter.press('Enter');
        await expect(filter).toHaveValue('movie');
        await filter.press('Escape');
        // Inspect rendered geometry only; product state is changed through UI.
        const width = await page.evaluate(() => ({
            content: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
        }));
        expect(width.content).toBeLessThanOrEqual(width.viewport);
        await expect(liveCount(page)).toHaveText('0');
        await page.screenshot({
            path: testInfo.outputPath(
                `watching-insights-${theme.toLowerCase()}.png`
            ),
            fullPage: true,
        });
    });
}
