import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    RuntimeCapabilitiesService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { DashboardDataService } from './dashboard-data.service';
import { ExternalWatchHistoryService } from './external-watch-history.service';
import { RecommendationFeedbackService } from './recommendation-feedback.service';
import { DashboardTasteProfileService } from './dashboard-taste-profile.service';
import { DashboardGenreRecommendationsService } from './dashboard-genre-recommendations.service';

describe('DashboardGenreRecommendationsService', () => {
    const recent = (title: string, xtreamId: number) => ({
        title,
        type: 'movie',
        source: 'xtream',
        playlist_id: 'pl-1',
        xtream_id: xtreamId,
        viewed_at: `2026-09-${10 - xtreamId}T12:00:00.000Z`,
    });
    const favorite = (title: string, xtreamId: number) => ({
        ...recent(title, xtreamId),
        added_at: '2026-09-10T12:00:00.000Z',
    });
    const discoveries = (prefix: string, mediaType: 'movie' | 'tv' = 'movie') =>
        Array.from({ length: 6 }, (_, index) => ({
            tmdbId: index + 100,
            mediaType,
            title: `${prefix} ${index + 1}`,
            originalTitle: null,
            year: 2020 + index,
            posterUrl: null,
            genreIds: index === 1 ? [35] : [28],
        }));

    let activePlaylists: { _id: string }[];
    let recentItems: ReturnType<typeof recent>[];
    let favorites: ReturnType<typeof favorite>[];
    let positions: Record<
        string,
        { positionSeconds: number; durationSeconds: number }
    >;
    let enrichMovie: jest.Mock;
    let enrichTv: jest.Mock;
    let discoverTitles: jest.Mock;
    let matchTitles: jest.Mock;
    let loadExternalHistory: jest.Mock;
    let externalEntries: { title: string; watchedAt: string }[];
    let isDismissed: jest.Mock;
    let affinityWeights: jest.Mock;
    let feedbackCacheKey: jest.Mock;
    let matchedTitleIds: Map<string, number>;

    function createService(): DashboardGenreRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        language: () => 'en-US',
                        enrichMovie: async (query: { title: string }) => {
                            const result = await enrichMovie(query);
                            return result
                                ? {
                                      id:
                                          [
                                              ...new Set(
                                                  [
                                                      ...recentItems,
                                                      ...favorites,
                                                  ].map((item) => item.title)
                                              ),
                                          ].indexOf(query.title) + 1 || 99,
                                      ...result,
                                  }
                                : null;
                        },
                        enrichTv: async (query: { title: string }) => {
                            const result = await enrichTv(query);
                            return result ? { id: 900, ...result } : null;
                        },
                        discoverTitles,
                    },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: { isAvailable: true, matchTitles },
                },
                {
                    provide: DashboardDataService,
                    useValue: {
                        globalRecentVodItems: () => recentItems,
                        globalRecentItems: () => recentItems,
                        globalFavoriteItems: () => favorites,
                        playlists: () => activePlaylists,
                        getPlaybackPositionForItem: (item: { title: string }) =>
                            positions[item.title] ?? null,
                    },
                },
                {
                    provide: ExternalWatchHistoryService,
                    useValue: {
                        load: loadExternalHistory,
                        entries: () => externalEntries,
                    },
                },
                {
                    provide: RecommendationFeedbackService,
                    useValue: {
                        load: jest.fn().mockResolvedValue(undefined),
                        isDismissed,
                        affinityWeights,
                        entries: () => [],
                        cacheKey: feedbackCacheKey,
                    },
                },
            ],
        });
        return TestBed.inject(DashboardGenreRecommendationsService);
    }

    beforeEach(() => {
        activePlaylists = [{ _id: 'pl-1' }];
        recentItems = [recent('Recent Action', 1)];
        favorites = [];
        positions = {};
        externalEntries = [];
        loadExternalHistory = jest.fn().mockResolvedValue(undefined);
        isDismissed = jest.fn().mockReturnValue(false);
        affinityWeights = jest.fn().mockReturnValue(new Map());
        feedbackCacheKey = jest.fn().mockReturnValue('');
        matchedTitleIds = new Map();
        enrichMovie = jest.fn().mockImplementation(async ({ title }) => ({
            vote_average: title === 'Recent Action' ? 8 : 7,
            vote_count: 100,
            genres:
                title === 'Recent Action'
                    ? [{ id: 28, name: 'Action' }]
                    : [{ id: 35, name: 'Comedy' }],
        }));
        enrichTv = jest.fn().mockResolvedValue(null);
        discoverTitles = jest
            .fn()
            .mockImplementation(async (_type, filters) =>
                filters.genreId === 28
                    ? discoveries('Action')
                    : discoveries('Comedy')
            );
        matchTitles = jest.fn().mockImplementation(async (titles: string[]) =>
            titles.map((title) => {
                if (!matchedTitleIds.has(title)) {
                    matchedTitleIds.set(title, matchedTitleIds.size + 500);
                }
                return {
                    queryTitle: title,
                    playlistId: 'pl-1',
                    playlistName: 'My Library',
                    categoryId: 9,
                    xtreamId: matchedTitleIds.get(title),
                    type: 'movie',
                    trailingYear:
                        2019 + Number(title.match(/(\d+)$/)?.[1] ?? 1),
                    tmdbId: null,
                };
            })
        );
    });

    it('builds a playable rail from the strongest inferred genre', async () => {
        const service = createService();

        await service.load();

        expect(service.rails()).toHaveLength(1);
        expect(service.rails()[0].genre).toBe('Action');
        expect(service.rails()[0].items).toHaveLength(6);
        expect(service.rails()[0].items[0].match.playlistName).toBe(
            'My Library'
        );
        expect(discoverTitles).toHaveBeenCalledWith('movie', { genreId: 28 });
    });

    it('removes titles marked not for me', async () => {
        isDismissed.mockImplementation(
            (item: { tmdbId: number }) => item.tmdbId === 100
        );
        const service = createService();

        await service.load();

        expect(
            service.rails()[0].items.map((item) => item.tmdbId)
        ).not.toContain(100);
    });

    it('uses more-like-this genre affinities in candidate ranking', async () => {
        affinityWeights.mockReturnValue(new Map([['movie:genre:35', 20]]));
        feedbackCacheKey.mockReturnValue('movie:101:more-like-this:35');
        const service = createService();

        await service.load();

        expect(service.rails()[0].items[0].tmdbId).toBe(101);
    });

    it('stays in the loading state while persisted history is restored', async () => {
        let resolveHistory!: () => void;
        loadExternalHistory.mockReturnValue(
            new Promise<void>((resolve) => {
                resolveHistory = resolve;
            })
        );
        const service = createService();

        const load = service.load();
        expect(service.loading()).toBe(true);
        resolveHistory();
        await load;

        expect(service.loading()).toBe(false);
        expect(service.rails()[0].genre).toBe('Action');
    });

    it('gives favorites enough weight to lead a merely recent genre', async () => {
        favorites = [favorite('Favorite Comedy', 2)];
        const service = createService();

        await service.load();

        expect(service.rails().map((rail) => rail.genre)).toEqual([
            'Comedy',
            'Action',
        ]);
    });

    it('uses completion as an affinity signal', async () => {
        recentItems = [recent('Recent Action', 1), recent('Older Comedy', 2)];
        positions['Older Comedy'] = {
            positionSeconds: 95,
            durationSeconds: 100,
        };
        const service = createService();

        await service.load();

        expect(service.rails()[0].genre).toBe('Comedy');
    });

    it('uses the full taste profile to rank candidates within a genre', async () => {
        recentItems = [recent('Recent Action', 1), recent('Recent Comedy', 2)];
        favorites = [favorite('Recent Action', 1)];
        enrichMovie.mockImplementation(async ({ title }) => ({
            vote_average: 8,
            vote_count: 100,
            genres:
                title === 'Recent Action'
                    ? [{ id: 28, name: 'Action' }]
                    : [{ id: 35, name: 'Comedy' }],
        }));
        discoverTitles.mockImplementation(async (_type, filters) => {
            const results =
                filters.genreId === 28
                    ? discoveries('Action')
                    : discoveries('Comedy');
            return results.map((item, index) => ({
                ...item,
                genreIds:
                    filters.genreId === 28 && index === 4
                        ? [28, 35]
                        : [filters.genreId],
                popularity: 10,
                voteAverage: 7,
                voteCount: 100,
            }));
        });
        const service = createService();

        await service.load();

        expect(service.rails()[0].genre).toBe('Action');
        expect(service.rails()[0].items[0].title).toBe('Action 5');
    });

    it('uses imported Netflix titles as private genre-preference seeds', async () => {
        recentItems = [];
        externalEntries = [
            { title: 'Netflix Action', watchedAt: '2026-09-14T12:00:00.000Z' },
        ];
        enrichMovie.mockImplementation(async ({ title }) =>
            title === 'Netflix Action'
                ? {
                      vote_average: 8,
                      vote_count: 100,
                      genres: [{ id: 28, name: 'Action' }],
                  }
                : null
        );
        const service = createService();

        await service.load();

        expect(service.rails()[0].genre).toBe('Action');
        expect(enrichMovie).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Netflix Action' })
        );
    });

    it('keeps imported history represented when local recents fill the seed budget', async () => {
        recentItems = Array.from({ length: 20 }, (_, index) =>
            recent(`Recent ${index + 1}`, index + 1)
        );
        externalEntries = [
            { title: 'Netflix Action', watchedAt: '2026-09-14T12:00:00.000Z' },
        ];
        const service = createService();

        await service.load();

        expect(enrichMovie).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Netflix Action' })
        );
    });

    it('can surface four distinct taste rails', async () => {
        recentItems = [
            recent('Action Seed', 1),
            recent('Comedy Seed', 2),
            recent('Drama Seed', 3),
            recent('Science Fiction Seed', 4),
        ];
        const genres = new Map([
            ['Action Seed', { id: 28, name: 'Action' }],
            ['Comedy Seed', { id: 35, name: 'Comedy' }],
            ['Drama Seed', { id: 18, name: 'Drama' }],
            ['Science Fiction Seed', { id: 878, name: 'Science Fiction' }],
        ]);
        enrichMovie.mockImplementation(async ({ title }) => ({
            vote_average: 8,
            vote_count: 100,
            genres: [genres.get(title)],
        }));
        discoverTitles.mockImplementation(async (_type, filters) =>
            discoveries(`Genre ${filters.genreId}`)
        );
        const service = createService();

        await service.load();

        expect(service.rails().map(({ genre }) => genre)).toEqual([
            'Action',
            'Comedy',
            'Drama',
            'Science Fiction',
        ]);
    });

    it('does not repeat a catalog title across personalized rails', async () => {
        recentItems = [recent('Action Seed', 1), recent('Comedy Seed', 2)];
        enrichMovie.mockImplementation(async ({ title }) => ({
            vote_average: 8,
            vote_count: 100,
            genres: [
                title === 'Action Seed'
                    ? { id: 28, name: 'Action' }
                    : { id: 35, name: 'Comedy' },
            ],
        }));
        discoverTitles.mockImplementation(async (_type, filters) => [
            ...discoveries('Shared'),
            ...discoveries(`Genre ${filters.genreId}`).map((item) => ({
                ...item,
                tmdbId: item.tmdbId + filters.genreId,
            })),
        ]);
        const service = createService();

        await service.load();

        const [first, second] = service.rails();
        expect(first.items).toHaveLength(12);
        expect(second.items).toHaveLength(6);
        expect(
            first.items.some((left) =>
                second.items.some(
                    (right) =>
                        left.match.playlistId === right.match.playlistId &&
                        left.match.type === right.match.type &&
                        left.match.xtreamId === right.match.xtreamId
                )
            )
        ).toBe(false);
    });

    it('looks up Netflix episode history as a TV series seed', async () => {
        recentItems = [];
        externalEntries = [
            {
                title: 'Great Series: Season 2: Episode 4: Return',
                watchedAt: '2026-09-14T12:00:00.000Z',
            },
        ];
        enrichMovie.mockResolvedValue(null);
        enrichTv.mockResolvedValue({
            vote_average: 8,
            vote_count: 100,
            genres: [{ id: 18, name: 'Drama' }],
        });
        const service = createService();

        await service.load();

        expect(enrichTv).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Great Series' })
        );
        expect(service.rails()[0].genre).toBe('Drama');
    });

    it('keeps movie and TV genre identities separate despite equal labels', async () => {
        recentItems = [
            recent('Recent Action', 1),
            { ...recent('Action Series', 2), type: 'series' },
        ];
        enrichTv.mockResolvedValue({
            vote_average: 8,
            vote_count: 100,
            genres: [{ id: 10759, name: 'Action' }],
        });
        discoverTitles.mockImplementation(async (type) =>
            type === 'movie'
                ? discoveries('Movie Action')
                : discoveries('TV Action', 'tv')
        );
        matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title, index) => ({
                queryTitle: title,
                playlistId: 'pl-1',
                playlistName: 'My Library',
                categoryId: 9,
                xtreamId: index + 500,
                type: title.startsWith('TV') ? 'series' : 'movie',
                trailingYear: 2019 + Number(title.match(/(\d+)$/)?.[1] ?? 1),
                tmdbId: null,
            }))
        );
        const service = createService();

        await service.load();

        expect(discoverTitles).toHaveBeenCalledWith('movie', { genreId: 28 });
        expect(discoverTitles).toHaveBeenCalledWith('tv', { genreId: 10759 });
        expect(
            service
                .rails()
                .flatMap((rail) => rail.items)
                .some((item) => item.mediaType === 'tv')
        ).toBe(true);
    });

    it('drops watched titles and hides sparse genre rails', async () => {
        discoverTitles.mockResolvedValue([
            {
                ...discoveries('Action')[0],
                title: 'Recent Action',
            },
            ...discoveries('Action').slice(1, 5),
        ]);
        const service = createService();

        await service.load();

        expect(service.rails()).toEqual([]);
    });

    it('does nothing when TMDB or catalog matching is unavailable', async () => {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => false },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: { isAvailable: false },
                },
                {
                    provide: DashboardDataService,
                    useValue: {},
                },
                {
                    provide: ExternalWatchHistoryService,
                    useValue: { load: jest.fn(), entries: () => [] },
                },
            ],
        });
        const service = TestBed.inject(DashboardGenreRecommendationsService);

        await service.load();

        expect(service.rails()).toEqual([]);
    });
    it('shares deduplicated evidence without interpreting public ratings as preference', async () => {
        recentItems = [recent('Copy One', 1), recent('Copy Two', 2)];
        enrichMovie.mockResolvedValue({
            id: 42,
            vote_average: 10,
            genres: [{ id: 28, name: 'Action' }],
        });
        createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        await taste.load();
        expect(taste.profile().titles).toHaveLength(1);
        expect(taste.profile().genres[0]).toMatchObject({
            key: 'movie:genre:28',
            titleCount: 1,
            score: 4,
        });
        enrichMovie.mockResolvedValue({
            id: 42,
            vote_average: 0,
            genres: [{ id: 28, name: 'Action' }],
        });
        expect(taste.profile().genres[0].score).toBe(4);
    });

    it('does not enrich on second-level playback ticks but refreshes meaningful completion', async () => {
        createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        positions['Recent Action'] = {
            positionSeconds: 10,
            durationSeconds: 100,
        };
        await taste.load();
        const key = taste.key();
        positions['Recent Action'].positionSeconds = 11;
        expect(taste.key()).toBe(key);
        await taste.load();
        expect(enrichMovie).toHaveBeenCalledTimes(1);
        positions['Recent Action'].positionSeconds = 90;
        await taste.load();
        expect(taste.profile().genres[0].score).toBe(5);
    });

    it('discards an in-flight profile after history is cleared', async () => {
        let resolve!: (value: unknown) => void;
        enrichMovie.mockReturnValue(new Promise((done) => (resolve = done)));
        createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        const pending = taste.load();
        for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve();
        recentItems = [];
        resolve({ id: 42, genres: [{ id: 28, name: 'Action' }] });
        await pending;
        expect(taste.profile().titles).toEqual([]);
    });

    it('surfaces failed profile loading and retries through the supported load path', async () => {
        enrichMovie.mockRejectedValueOnce(new Error('Offline'));
        createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        await taste.load();
        expect(taste.error()).toBeTruthy();
        await taste.load();
        expect(taste.error()).toBeNull();
        expect(taste.profile().resolvedSeeds).toBe(1);
    });
    it('clears removed source taste despite retained recent and favorite snapshots', async () => {
        favorites = [favorite('Favorite Comedy', 2)];
        const service = createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        await service.load();
        expect(taste.profile().titles).toHaveLength(2);
        activePlaylists = [];
        await service.load();
        expect(recentItems).toHaveLength(1);
        expect(favorites).toHaveLength(1);
        expect(taste.profile().titles).toEqual([]);
        expect(service.rails()).toEqual([]);
    });

    it('retains imported evidence when the source of retained app history is removed', async () => {
        externalEntries = [
            { title: 'Imported Movie', watchedAt: '2026-09-14T12:00:00.000Z' },
        ];
        createService();
        const taste = TestBed.inject(DashboardTasteProfileService);
        await taste.load();
        activePlaylists = [];
        await taste.load();
        expect(taste.profile().titles).toHaveLength(1);
        expect(taste.profile().titles[0]).toMatchObject({
            title: 'Imported Movie',
            external: true,
            recent: false,
        });
    });

    it.each(['recent', 'favorite'])(
        'invalidates exclusions for a %s record beyond the seed budget',
        async (kind) => {
            recentItems = Array.from({ length: 20 }, (_, index) =>
                recent('Seed ' + index, index + 1)
            );
            const service = createService();
            const taste = TestBed.inject(DashboardTasteProfileService);
            await service.load();
            expect(taste.profile().totalSeeds).toBe(16);
            expect(
                service
                    .rails()
                    .flatMap((rail) => rail.items)
                    .some((item) => item.title === 'Comedy 1')
            ).toBe(true);
            const oldKey = taste.key();
            if (kind === 'recent') recentItems.push(recent('Comedy 1', 21));
            else
                favorites = Array.from({ length: 20 }, (_, index) =>
                    favorite('Seed ' + index, index + 1)
                ).concat(favorite('Comedy 1', 21));
            expect(taste.key()).not.toBe(oldKey);
            await service.load();
            expect(
                taste.profile().titles.some((item) => item.title === 'Comedy 1')
            ).toBe(false);
            expect(
                service
                    .rails()
                    .flatMap((rail) => rail.items)
                    .some((item) => item.title === 'Comedy 1')
            ).toBe(false);
        }
    );
    it('infers PWA interests from recorded source history without desktop app-state reads', async () => {
        const service = createService();
        Object.defineProperty(
            TestBed.inject(RuntimeCapabilitiesService),
            'isElectron',
            { value: false }
        );
        const feedback = TestBed.inject(RecommendationFeedbackService);
        const feedbackLoad = jest
            .spyOn(feedback, 'load')
            .mockRejectedValue(
                new Error('Electron app state persistence is unavailable')
            );
        loadExternalHistory.mockRejectedValue(
            new Error('Electron app state persistence is unavailable')
        );
        const taste = TestBed.inject(DashboardTasteProfileService);
        await service.load();
        expect(loadExternalHistory).not.toHaveBeenCalled();
        expect(feedbackLoad).not.toHaveBeenCalled();
        expect(enrichMovie).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Recent Action' })
        );
        expect(taste.error()).toBeNull();
        expect(taste.profile().genres[0]).toMatchObject({
            name: 'Action',
            titleCount: 1,
        });
        expect(taste.profile().titles[0]).toMatchObject({
            recent: true,
            title: 'Recent Action',
        });
    });
});
