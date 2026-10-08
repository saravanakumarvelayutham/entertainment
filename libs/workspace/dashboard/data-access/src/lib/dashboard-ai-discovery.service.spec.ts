import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    type DiscoverTitle,
} from '@iptvnator/services';
import type { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { buildRecommendationExclusionIndex } from './dashboard-recommendations.util';
import {
    DashboardAiDiscoveryService,
    type DashboardAiDiscoveryInput,
} from './dashboard-ai-discovery.service';

const discovered = (
    id: number,
    mediaType: 'movie' | 'tv' = 'movie'
): DiscoverTitle => ({
    tmdbId: id,
    mediaType,
    title: 'Title ' + id,
    originalTitle: null,
    year: 2020,
    posterUrl: null,
    genreIds: [18],
    voteAverage: 8,
    voteCount: 10,
});
const match = (
    title: string,
    type: 'movie' | 'series' = 'movie',
    playlistId = 'library'
): CatalogTitleMatch => ({
    queryTitle: title,
    type,
    playlistId,
    playlistName: 'Local library',
    categoryId: 1,
    xtreamId: Number(title.replace(/\D/g, '')) || 1,
    trailingYear: null,
});
const input = (
    changes: Partial<DashboardAiDiscoveryInput> = {}
): DashboardAiDiscoveryInput => ({
    enabled: true,
    evidenceGeneration: 'evidence-1',
    hints: { discoveryGenres: [{ genreId: 18, mediaType: 'movie' }] },
    activePlaylistIds: ['library'],
    excluded: buildRecommendationExclusionIndex([]),
    dismissedIds: new Set(),
    ...changes,
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

describe('DashboardAiDiscoveryService', () => {
    let service: DashboardAiDiscoveryService;
    let enrichment: {
        isEnabled: jest.Mock;
        discoverTitles: jest.Mock;
        enrichMovie: jest.Mock;
        enrichTv: jest.Mock;
    };
    let titleMatch: { isAvailable: boolean; matchTitles: jest.Mock };
    beforeEach(() => {
        enrichment = {
            isEnabled: jest.fn(() => true),
            discoverTitles: jest.fn().mockResolvedValue([discovered(1)]),
            enrichMovie: jest.fn().mockResolvedValue({
                id: 1,
                title: 'Title 1',
                release_date: '2020-01-01',
                genres: [{ id: 18 }],
                vote_average: 8,
                vote_count: 10,
            }),
            enrichTv: jest.fn().mockResolvedValue({ id: 2, name: 'Title 2' }),
        };
        titleMatch = {
            isAvailable: true,
            matchTitles: jest.fn(async (titles: string[]) =>
                titles.map((title) => match(title))
            ),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TmdbEnrichmentService, useValue: enrichment },
                { provide: CatalogTitleMatchService, useValue: titleMatch },
            ],
        });
        service = TestBed.inject(DashboardAiDiscoveryService);
    });

    it('waits for first nonempty hints and ignores reranking hints for that evidence generation', async () => {
        service.refresh(input({ hints: {} }));
        await settle();
        expect(enrichment.discoverTitles).not.toHaveBeenCalled();
        service.refresh(input());
        await settle();
        expect(service.items().map((item) => item.tmdbId)).toEqual([1]);
        service.refresh(
            input({
                hints: { discoveryGenres: [{ genreId: 878, mediaType: 'tv' }] },
            })
        );
        await settle();
        expect(enrichment.discoverTitles).toHaveBeenCalledTimes(1);
        expect(service.loading()).toBe(false);
    });

    it('keeps item signal identity stable for repeated same-generation and disabled input', async () => {
        service.refresh(input({ enabled: false }));
        const empty = service.items();
        service.refresh(input({ enabled: false }));
        expect(service.items()).toBe(empty);
        service.refresh(input());
        await settle();
        const items = service.items();
        service.refresh(input());
        expect(service.items()).toBe(items);
        service.refresh(
            input({
                hints: {
                    suggestedTitles: [
                        { title: 'Different hint', mediaType: 'movie' },
                    ],
                },
            })
        );
        expect(service.items()).toBe(items);
        expect(enrichment.discoverTitles).toHaveBeenCalledTimes(1);
    });

    it('batchmatches suggestions before any metadata requests and drops unavailable titles', async () => {
        titleMatch.matchTitles.mockImplementation(async (titles: string[]) =>
            titles
                .filter((title) => title === 'Title 1')
                .map((title) => match(title))
        );
        service.refresh(
            input({
                hints: {
                    suggestedTitles: [
                        { title: 'Title 1', mediaType: 'movie' },
                        { title: 'Unavailable', mediaType: 'movie' },
                    ],
                },
            })
        );
        await settle();
        expect(titleMatch.matchTitles.mock.calls[0][0]).toEqual([
            'Title 1',
            'Unavailable',
        ]);
        expect(titleMatch.matchTitles.mock.invocationCallOrder[0]).toBeLessThan(
            enrichment.enrichMovie.mock.invocationCallOrder[0]
        );
        expect(enrichment.enrichMovie).toHaveBeenCalledTimes(1);
        expect(enrichment.enrichMovie).toHaveBeenCalledWith({
            title: 'Title 1',
        });
        expect(service.items().map((item) => item.title)).toEqual(['Title 1']);
    });

    it('filters activity, dismissed IDs, deleted sources and incompatible catalog years', async () => {
        enrichment.discoverTitles.mockResolvedValue([
            discovered(1),
            discovered(2),
            discovered(3),
            discovered(4),
            discovered(5),
        ]);
        titleMatch.matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title) => ({
                ...match(title),
                playlistId: title === 'Title 3' ? 'deleted' : 'library',
                trailingYear: title === 'Title 4' ? 1980 : null,
            }))
        );
        service.refresh(
            input({
                excluded: buildRecommendationExclusionIndex([
                    { title: 'Title 1', type: 'movie' },
                ] as never[]),
                dismissedIds: new Set(['movie:2']),
            })
        );
        await settle();
        expect(service.items().map((item) => item.tmdbId)).toEqual([5]);
        service.refresh(input({ activePlaylistIds: [] }));
        expect(service.items()).toEqual([]);
        expect(enrichment.discoverTitles).toHaveBeenCalledTimes(1);
    });

    it('does not let an earlier generation or disabled intent publish late results', async () => {
        const old = deferred<DiscoverTitle[]>();
        enrichment.discoverTitles
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce([discovered(2)]);
        service.refresh(input());
        await settle();
        service.refresh(input({ evidenceGeneration: 'evidence-2' }));
        await settle();
        expect(service.items().map((item) => item.tmdbId)).toEqual([2]);
        old.resolve([discovered(1)]);
        await settle();
        expect(service.items().map((item) => item.tmdbId)).toEqual([2]);
        const late = deferred<DiscoverTitle[]>();
        enrichment.discoverTitles.mockReturnValueOnce(late.promise);
        service.refresh(input({ evidenceGeneration: 'evidence-3' }));
        await settle();
        service.refresh(input({ enabled: false }));
        late.resolve([discovered(3)]);
        await settle();
        expect(service.items()).toEqual([]);
        expect(service.loading()).toBe(false);
    });

    it('reuses completed generation discovery after navigation and retries failed original hints explicitly', async () => {
        enrichment.discoverTitles.mockResolvedValueOnce(null);
        service.refresh(input());
        await settle();
        expect(service.failed()).toBe(true);
        service.refresh(
            input({
                hints: {
                    discoveryGenres: [{ genreId: 878, mediaType: 'movie' }],
                },
            }),
            true
        );
        await settle();
        expect(enrichment.discoverTitles).toHaveBeenLastCalledWith('movie', {
            genreId: 18,
        });
        expect(service.failed()).toBe(false);
        service.refresh(input({ enabled: false }));
        service.refresh(input());
        await settle();
        expect(enrichment.discoverTitles).toHaveBeenCalledTimes(2);
    });

    it('bounds facet queries and balances verified movie and series pools to 160', async () => {
        enrichment.discoverTitles.mockImplementation(
            async (
                mediaType: 'movie' | 'tv',
                { genreId }: { genreId: number }
            ) =>
                Array.from({ length: 100 }, (_, index) =>
                    discovered(index + genreId * 100, mediaType)
                )
        );
        titleMatch.matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title) =>
                match(
                    title,
                    Number(title.replace(/\D/g, '')) >= 300 ? 'series' : 'movie'
                )
            )
        );
        service.refresh(
            input({
                hints: {
                    discoveryGenres: [
                        { genreId: 1, mediaType: 'movie' },
                        { genreId: 2, mediaType: 'movie' },
                        { genreId: 3, mediaType: 'tv' },
                        { genreId: 4, mediaType: 'tv' },
                        { genreId: 5, mediaType: 'movie' },
                    ],
                },
            })
        );
        await settle();
        expect(enrichment.discoverTitles).toHaveBeenCalledTimes(4);
        expect(service.items()).toHaveLength(160);
        expect(
            service.items().filter((item) => item.mediaType === 'movie')
        ).toHaveLength(80);
        expect(
            service.items().filter((item) => item.mediaType === 'tv')
        ).toHaveLength(80);
    });

    it('interleaves facets so one long movie genre cannot consume the discovery pool', async () => {
        enrichment.discoverTitles.mockImplementation(
            async (_type: string, { genreId }: { genreId: number }) =>
                Array.from({ length: 100 }, (_, index) =>
                    discovered(index + genreId * 100)
                )
        );
        service.refresh(
            input({
                hints: {
                    discoveryGenres: [1, 2, 3, 4].map((genreId) => ({
                        genreId,
                        mediaType: 'movie',
                    })),
                },
            })
        );
        await settle();
        const items = service.items();
        expect(items).toHaveLength(160);
        for (const genreId of [1, 2, 3, 4])
            expect(
                items.filter(
                    (item) => Math.floor(item.tmdbId / 100) === genreId
                )
            ).toHaveLength(40);
    });

    it('does not discover while metadata or the catalog bridge is unavailable', () => {
        enrichment.isEnabled.mockReturnValue(false);
        service.refresh(input());
        expect(enrichment.discoverTitles).not.toHaveBeenCalled();
        expect(service.items()).toEqual([]);
    });
});
