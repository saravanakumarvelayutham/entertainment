import { createServer } from 'node:http';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    resetMockServers,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
    channelItemByTitle,
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

import { fetchXtreamVodFixture, getXtreamTitle } from './portal-mock-fixtures';

function subtitleTestAudio(): Buffer {
    const dataLength = 16000 * 30 * 2;
    const bytes = Buffer.alloc(44 + dataLength);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24);
    bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(dataLength, 40);
    return bytes;
}

for (const automatic of process.env['IPTVNATOR_E2E_REAL_SUBTITLES'] === '1'
    ? [true]
    : [false, true]) {
    test(`@electron ${automatic ? 'automatic' : 'manual'} English subtitles follow movie time, seeking and fullscreen`, async ({
        dataDir,
    }, testInfo) => {
        test.setTimeout(90_000);
        const realProviders =
            process.env['IPTVNATOR_E2E_REAL_SUBTITLES'] === '1';
        const movieTitle = realProviders
            ? (process.env['IPTVNATOR_E2E_SUBTITLE_TITLE'] ??
              'Inception (2010)')
            : 'Subtitle Fixture (2020)';
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        await page.emulateMedia({
            colorScheme:
                process.env['IPTVNATOR_E2E_COLOR_SCHEME'] === 'dark'
                    ? 'dark'
                    : 'light',
        });
        const requests: string[] = [];
        const audio = subtitleTestAudio();
        const media = createServer((request, response) => {
            const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2]
                ? Math.min(Number(range[2]), audio.length - 1)
                : audio.length - 1;
            response.writeHead(range ? 206 : 200, {
                'Content-Type': 'audio/wav',
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                ...(range
                    ? {
                          'Content-Range': `bytes ${start}-${end}/${audio.length}`,
                      }
                    : {}),
            });
            response.end(audio.subarray(start, end + 1));
        });
        try {
            if (!automatic) {
                await openSettings(page);
                await openSettingsSection(page, 'playback');
                await page.getByTestId('auto-english-subtitles-toggle').click();
                await page.getByTestId('save-settings').click();
                await expect(
                    page.getByTestId('settings-unsaved-bar')
                ).toHaveCount(0);
            }
            await new Promise<void>((resolve) =>
                media.listen(0, '127.0.0.1', resolve)
            );
            const address = media.address();
            if (!address || typeof address === 'string')
                throw new Error('Media fixture failed');
            if (!realProviders) {
                await page.route('https://v3-cinemeta.strem.io/**', (route) => {
                    requests.push(route.request().url());
                    const series = route
                        .request()
                        .url()
                        .includes('/catalog/series/');
                    return route.fulfill({
                        json: {
                            metas: [
                                {
                                    id: series ? 'tt7654322' : 'tt7654321',
                                    name: series
                                        ? 'Subtitle Show'
                                        : 'Subtitle Fixture',
                                    type: series ? 'series' : 'movie',
                                    releaseInfo: '2020',
                                },
                            ],
                        },
                    });
                });
                await page.route(
                    'https://opensubtitles-v3.strem.io/**',
                    (route) => {
                        requests.push(route.request().url());
                        const series = route
                            .request()
                            .url()
                            .includes('/subtitles/series/');
                        return route.fulfill({
                            json: {
                                subtitles: [
                                    {
                                        id: 'cam',
                                        lang: 'eng',
                                        movieReleaseName: series
                                            ? 'Subtitle.Show.S01E02.HDCAM'
                                            : 'Subtitle.Fixture.2020.HDCAM',
                                        url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1234568',
                                    },
                                    ...(series
                                        ? [
                                              {
                                                  id: 'wrong-episode',
                                                  lang: 'eng',
                                                  movieReleaseName:
                                                      'Subtitle.Show.S01E01.WEB-DL',
                                                  url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1234569',
                                              },
                                          ]
                                        : []),
                                    {
                                        id: 'english-test',
                                        lang: 'eng',
                                        movieReleaseName: series
                                            ? 'Subtitle.Show.S01E02.WEB-DL'
                                            : 'Subtitle.Fixture.2020.WEB-DL',
                                        url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1234567',
                                    },
                                    {
                                        id: 'french-test',
                                        lang: 'fre',
                                        url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/999',
                                    },
                                ],
                            },
                        });
                    }
                );
                await page.route('https://subs5.strem.io/**', (route) => {
                    requests.push(route.request().url());
                    return route.fulfill({
                        contentType: 'application/x-subrip; charset=utf-8',
                        body: '1\n00:00:01,000 --> 00:00:05,000\nEarly dialogue.\n\n2\n00:00:10,000 --> 00:00:15,000\nLater dialogue.\n',
                    });
                });
            }
            const playlist = writeTemporaryM3uFile(
                dataDir,
                'subtitle-movie.m3u',
                [
                    {
                        name: movieTitle,
                        groupTitle: 'Movies',
                        url: `http://127.0.0.1:${address.port}/movie/subtitle-fixture.mp4`,
                    },
                    ...(automatic && !realProviders
                        ? [
                              {
                                  name: 'Subtitle Show S01E02',
                                  groupTitle: 'Series',
                                  url: `http://127.0.0.1:${address.port}/series/episode-two.mp4`,
                              },
                          ]
                        : []),
                ]
            );
            await importM3uPlaylistFromNativeDialog(app, playlist);
            await waitForM3uCatalog(page);
            await channelItemByTitle(page, movieTitle).first().click();
            const video = page.locator('.vjs-player-shell video');
            await expect
                .poll(() =>
                    video.evaluate(
                        (element) => (element as HTMLVideoElement).currentTime
                    )
                )
                .toBeGreaterThan(0);
            if (automatic) {
                await expect(
                    page.getByTestId('player-auto-subtitles')
                ).toHaveAttribute('data-status', 'LOADED', { timeout: 60_000 });
                await expect(
                    page.getByTestId('player-subtitle-search')
                ).toHaveCount(0);
            }
            await page
                .getByRole('button', { name: 'Pause', exact: true })
                .click();
            if (!automatic) {
                await page
                    .getByRole('button', { name: 'Subtitles', exact: true })
                    .click();
                await page.getByTestId('player-find-subtitles').click();
                await expect(
                    page.getByTestId('player-subtitle-search')
                ).toContainText(movieTitle);
                const result = page.getByTestId('subtitle-search-result');
                if (!realProviders) await expect(result).toHaveCount(2);
                await expect(result.first()).toBeVisible({ timeout: 45_000 });
                await page.screenshot({
                    path: testInfo.outputPath('subtitle-search-releases.png'),
                });
                await result.filter({ hasText: 'WEB-DL' }).first().click();
                await expect(
                    page.getByTestId('player-subtitle-search')
                ).toContainText('English subtitles loaded', {
                    timeout: 30_000,
                });
            }
            if (realProviders) return;
            expect(
                requests.some((url) =>
                    url.includes('/subtitles/movie/tt7654321.json')
                )
            ).toBe(true);
            expect(requests.every((url) => !url.includes('marketing'))).toBe(
                true
            );
            // Both seeking operations use the real shared-controls command path.
            const position = page.getByRole('slider', {
                name: 'Playback position',
                exact: true,
            });
            await position.fill('3');
            await position.dispatchEvent('change');
            const display = page.locator('.vjs-text-track-display');
            await expect(display).toContainText('Early dialogue.');
            if (automatic) {
                await page
                    .getByRole('button', { name: 'Subtitles', exact: true })
                    .click();
                const sync = page.getByTestId('player-controls-subtitle-delay');
                await expect(sync).toBeVisible();
                await expect(
                    sync.getByRole('button', { name: 'Show subtitles earlier' })
                ).toHaveText('Earlier');
                await expect(
                    sync.getByRole('button', { name: 'Show subtitles later' })
                ).toHaveText('Later');
                for (let i = 0; i < 6; i++) {
                    await sync
                        .getByRole('button', { name: 'Show subtitles later' })
                        .click();
                }
                await expect(sync).toContainText('+3.0 s');
                await expect(display).not.toContainText('Early dialogue.');
                await expect
                    .poll(() =>
                        video.evaluate(
                            (element) =>
                                (element as HTMLVideoElement).currentTime
                        )
                    )
                    .toBeCloseTo(3, 0);
                await position.fill('6');
                await position.dispatchEvent('change');
                await expect(display).toContainText('Early dialogue.');
                for (let i = 0; i < 12; i++) {
                    await sync
                        .getByRole('button', { name: 'Show subtitles earlier' })
                        .click();
                }
                await expect(sync).toContainText('3.0 s');
                await expect(sync).not.toContainText('+3.0 s');
                await expect(display).not.toContainText('Early dialogue.');
                await position.fill('8');
                await position.dispatchEvent('change');
                await expect(display).toContainText('Later dialogue.');
                await sync
                    .getByRole('button', { name: 'Reset subtitle delay' })
                    .click();
                await expect(
                    sync.locator('.player-controls__subtitle-delay-value')
                ).toHaveText('0 s');
                await expect(display).not.toContainText('Later dialogue.');
                await position.fill('3');
                await position.dispatchEvent('change');
                await expect(display).toContainText('Early dialogue.');
                await sync.hover();
                await page.evaluate(
                    () =>
                        new Promise<void>((resolve) =>
                            requestAnimationFrame(() =>
                                requestAnimationFrame(() => resolve())
                            )
                        )
                );
                await page.screenshot({
                    animations: 'disabled',
                    path: testInfo.outputPath('subtitle-sync-controls.png'),
                });
            }
            await page.keyboard.press('Escape');
            await page.locator('.vjs-player-shell').hover();
            await page
                .getByRole('button', { name: 'Enter fullscreen', exact: true })
                .click();
            await expect(display).toContainText('Early dialogue.');
            expect(
                await display.evaluate((element) =>
                    document.fullscreenElement?.contains(element)
                )
            ).toBe(true);
            await position.fill('12');
            await position.dispatchEvent('change');
            await expect(display).toContainText('Later dialogue.');
            await expect(display).not.toContainText('Early dialogue.');
            await page.screenshot({
                path: testInfo.outputPath('matched-subtitles-fullscreen.png'),
            });
            await position.fill('3');
            await position.dispatchEvent('change');
            await expect(display).toContainText('Early dialogue.');
            await expect(display).not.toContainText('Later dialogue.');
            if (automatic) {
                expect(
                    requests.filter((url) => url.includes('/download/'))
                ).toEqual([
                    'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1234567',
                ]);
                await page.locator('.vjs-player-shell').hover();
                await page
                    .getByRole('button', {
                        name: 'Exit fullscreen',
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole('button', { name: 'Subtitles', exact: true })
                    .click();
                await page
                    .getByRole('menuitemradio', { name: 'Off', exact: true })
                    .click();
                await expect(display).not.toContainText('Early dialogue.');
                await page
                    .getByRole('button', { name: 'Play', exact: true })
                    .click();
                await expect
                    .poll(() =>
                        video.evaluate(
                            (element) =>
                                (element as HTMLVideoElement).currentTime
                        )
                    )
                    .toBeGreaterThan(3.5);
                expect(
                    requests.filter((url) => url.includes('/download/'))
                ).toHaveLength(1);
                await page
                    .getByRole('button', { name: 'Pause', exact: true })
                    .click();
                await page
                    .getByRole('button', { name: 'Subtitles', exact: true })
                    .click();
                await page.getByTestId('player-subtitles-on').click();
                await expect(
                    page.getByTestId('player-auto-subtitles')
                ).toHaveAttribute('data-status', 'LOADED');
                await expect(display).toContainText('Early dialogue.');
                expect(
                    requests.filter((url) => url.includes('/download/'))
                ).toHaveLength(2);
                await page.keyboard.press('Escape');
                await channelItemByTitle(page, 'Subtitle Show S01E02')
                    .first()
                    .click();
                await expect
                    .poll(() =>
                        requests.some((url) =>
                            url.includes('/subtitles/series/tt7654322:1:2.json')
                        )
                    )
                    .toBe(true);
                await expect(
                    page.getByTestId('player-auto-subtitles')
                ).toHaveAttribute('data-status', 'LOADED');
                expect(
                    requests.some((url) =>
                        url.includes('/subtitles/series/tt7654322:1:2.json')
                    )
                ).toBe(true);
                expect(
                    requests.filter((url) => url.includes('/download/'))
                ).toHaveLength(3);
            }
        } finally {
            await closeElectronApp(app);
            media.closeAllConnections();
            if (media.listening)
                await new Promise<void>((resolve) =>
                    media.close(() => resolve())
                );
        }
    });
}

test('@electron detail-page year selects the right same-name movie without a year in its player title', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamVodFixture(request, {
        username: 'user1',
        password: 'pass1',
    });
    const movie = fixture.items[0];
    const details = await (
        await request.get(xtreamMockServer + '/player_api.php', {
            params: {
                username: 'user1',
                password: 'pass1',
                action: 'get_vod_info',
                vod_id: String(movie.stream_id),
            },
        })
    ).json();
    const title = details.info.name;
    const year = Number(details.info.releasedate.slice(0, 4));
    expect(year).toBeGreaterThan(1900);
    expect(title).not.toMatch(/\b(?:19|20)\d{2}\b/);
    const app = await launchElectronApp(dataDir);
    try {
        const page = app.mainWindow;
        const subtitleRequests: string[] = [];
        await page.route('https://v3-cinemeta.strem.io/**', (route) =>
            route.fulfill({
                json: {
                    metas: [
                        {
                            id: 'tt0497470',
                            type: 'movie',
                            name: title,
                            releaseInfo: String(year - 20),
                        },
                        {
                            id: 'tt26581740',
                            type: 'movie',
                            name: title,
                            releaseInfo: String(year),
                        },
                    ],
                },
            })
        );
        await page.route('https://opensubtitles-v3.strem.io/**', (route) => {
            subtitleRequests.push(route.request().url());
            return route.fulfill({
                json: {
                    subtitles: [
                        {
                            id: 'english',
                            lang: 'eng',
                            movieReleaseName: title + '.WEB-DL',
                            url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1234567',
                        },
                    ],
                },
            });
        });
        await page.route('https://subs5.strem.io/**', (route) =>
            route.fulfill({
                contentType: 'application/x-subrip',
                body: '1\n00:00:01,000 --> 00:00:25,000\nMatched using the detail year.\n',
            })
        );
        await page.route('**/movie/user1/pass1/**', (route) =>
            route.fulfill({
                contentType: 'audio/wav',
                body: subtitleTestAudio(),
            })
        );
        await addXtreamPortal(page);
        await waitForXtreamWorkspaceReady(page);
        await page.getByRole('link', { name: 'Movies', exact: true }).click();
        await clickCategoryByNameExact(page, fixture.categoryName);
        await page
            .getByRole('button', { name: getXtreamTitle(movie), exact: true })
            .click();
        await expect(page.locator('app-content-hero')).toContainText(
            String(year)
        );
        await page.locator('button.play-btn').first().click();
        await expect(page.getByTestId('player-auto-subtitles')).toHaveAttribute(
            'data-status',
            'LOADED'
        );
        expect(subtitleRequests).toHaveLength(1);
        expect(subtitleRequests[0]).toContain('/movie/tt26581740.json');
        await expect(page.locator('.vjs-text-track-display')).toContainText(
            'Matched using the detail year.'
        );
    } finally {
        await closeElectronApp(app);
    }
});
