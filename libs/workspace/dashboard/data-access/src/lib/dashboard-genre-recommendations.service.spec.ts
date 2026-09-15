import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { DashboardDataService } from './dashboard-data.service';
import { ExternalWatchHistoryService } from './external-watch-history.service';
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
        }));

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
    let externalEntries: { title: string; watchedAt: string }[];

    function createService(): DashboardGenreRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        language: () => 'en-US',
                        enrichMovie,
                        enrichTv,
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
                        playlists: () => [{ _id: 'pl-1' }],
                        getPlaybackPositionForItem: (item: { title: string }) =>
                            positions[item.title] ?? null,
                    },
                },
                {
                    provide: ExternalWatchHistoryService,
                    useValue: {
                        load: jest.fn(),
                        entries: () => externalEntries,
                    },
                },
            ],
        });
        return TestBed.inject(DashboardGenreRecommendationsService);
    }

    beforeEach(() => {
        recentItems = [recent('Recent Action', 1)];
        favorites = [];
        positions = {};
        externalEntries = [];
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
            titles.map((title, index) => ({
                queryTitle: title,
                playlistId: 'pl-1',
                playlistName: 'My Library',
                categoryId: 9,
                xtreamId: index + 500,
                type: 'movie',
                trailingYear: null,
            }))
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

    it('combines the movie and TV genre ids for the same preference', async () => {
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
                trailingYear: null,
            }))
        );
        const service = createService();

        await service.load();

        expect(discoverTitles).toHaveBeenCalledWith('movie', { genreId: 28 });
        expect(discoverTitles).toHaveBeenCalledWith('tv', { genreId: 10759 });
        expect(
            service.rails()[0].items.some((item) => item.mediaType === 'tv')
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
});
