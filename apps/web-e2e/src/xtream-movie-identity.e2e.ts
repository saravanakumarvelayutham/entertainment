import { expect, test } from './fixtures';
import { setInputValue } from './e2e-helpers';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

const mockServer = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;

test.use({ serviceWorkers: 'block' });

for (const { hasRequestedRelease, untagged } of [
    { hasRequestedRelease: true, untagged: false },
    { hasRequestedRelease: false, untagged: false },
    { hasRequestedRelease: false, untagged: true },
]) {
    test(`@xtream actor credit ${hasRequestedRelease ? 'opens its own release' : untagged ? 'searches when the catalog release is unverified' : 'searches when only another release exists'}`, async ({
        page,
    }) => {
        await page.goto('/workspace/settings/tmdb');
        await page.locator('[data-test-id="tmdb-enabled"] input').check();
        await page.locator('[data-test-id="tmdb-api-key"]').fill('e2e-key');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(
            page.getByRole('button', { name: 'Save changes' })
        ).toBeHidden();

        await page.route('https://api.themoviedb.org/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            await route.fulfill({
                json: path.endsWith('/person/1')
                    ? {
                          id: 1,
                          name: 'Fixture actor',
                          combined_credits: {
                              cast: [
                                  {
                                      id: 452832,
                                      media_type: 'movie',
                                      title: 'Serenity',
                                      release_date: '2019-01-25',
                                      character: 'Baker Dill',
                                  },
                              ],
                          },
                      }
                    : { results: [] },
            });
        });

        const targets = await interceptProviderTargetRegistration(page);
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const original = new URL(route.request().url());
            const action = original.searchParams.get('action');
            if (action === 'get_vod_categories') {
                await route.fulfill({
                    json: {
                        payload: [
                            {
                                category_id: '101',
                                category_name: 'Movies',
                                parent_id: 0,
                            },
                        ],
                        action,
                    },
                });
                return;
            }
            if (action === 'get_vod_streams') {
                const releases = [
                    {
                        stream_id: 5,
                        name: untagged ? 'Serenity' : 'Serenity (2005)',
                        category_id: '101',
                        stream_type: 'movie',
                        container_extension: 'mp4',
                    },
                    ...(hasRequestedRelease
                        ? [
                              {
                                  stream_id: 19,
                                  name: 'Serenity (2019)',
                                  category_id: '101',
                                  stream_type: 'movie',
                                  container_extension: 'mp4',
                              },
                          ]
                        : []),
                ];
                await route.fulfill({ json: { payload: releases, action } });
                return;
            }
            if (action === 'get_vod_info') {
                await route.fulfill({
                    json: {
                        payload: {
                            info: {
                                name: 'Serenity',
                                releasedate: '2019-01-25',
                                plot: 'The selected 2019 release.',
                            },
                            movie_data: {
                                stream_id: 19,
                                name: 'Serenity (2019)',
                                category_id: '101',
                                container_extension: 'mp4',
                            },
                        },
                        action,
                    },
                });
                return;
            }
            const redirected = new URL(`${mockServer}/xtream`);
            const provider = getRegisteredProviderUrl(original, targets);
            if (provider) redirected.searchParams.set('url', provider);
            original.searchParams.forEach((value, key) => {
                if (key !== 'targetId') redirected.searchParams.set(key, value);
            });
            await route.continue({ url: redirected.toString() });
        });

        await page.goto('/workspace/sources');
        await page.getByRole('button', { name: 'Add playlist' }).click();
        const dialog = page.locator('mat-dialog-container');
        await dialog
            .getByRole('radio', { name: /Xtream credentials/i })
            .click();
        for (const [id, value] of Object.entries({
            title: 'Release identity fixture',
            serverUrl: mockServer,
            username: 'user1',
            password: 'pass1',
        })) {
            await setInputValue(dialog.locator(`#${id}`), value);
        }
        await dialog.getByRole('button', { name: 'Add', exact: true }).click();
        await page.waitForURL(/xtreams.*vod/);
        const portal = new URL(page.url()).pathname.match(
            /\/workspace\/xtreams\/([^/]+)/
        )?.[1];
        expect(portal).toBeTruthy();
        await page.goto(`/workspace/xtreams/${portal}/actor/1`);
        const credit = page
            .locator('.title-results__card')
            .filter({ hasText: 'Baker Dill' });
        await expect(credit).toContainText('2019');
        if (hasRequestedRelease) {
            await expect(credit).toContainText('In your library');
        } else {
            await expect(credit).toHaveClass(/unavailable/);
        }
        await credit.click();
        if (hasRequestedRelease) {
            await expect(page).toHaveURL(new RegExp(`/vod/101/19(?:\\?|$)`));
            const detail = page.getByRole('region', {
                name: 'Serenity',
                exact: true,
            });
            await expect(detail).toContainText('The selected 2019 release.');
            await expect(
                detail.getByRole('button', { name: '2019', exact: true })
            ).toBeVisible();
        } else {
            await expect(page).toHaveURL(new RegExp(`/search\\?q=Serenity$`));
        }
    });
}
