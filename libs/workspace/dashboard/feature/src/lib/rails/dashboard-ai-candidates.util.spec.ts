import type {
    DashboardRecommendationItem,
    DashboardTrendingItem,
    DashboardTmdbLookupItem,
} from '@iptvnator/workspace/dashboard/data-access';
import {
    balanceDashboardAiPools,
    buildDashboardAiCandidates,
    distinctDashboardCards,
} from './dashboard-ai-candidates.util';

const candidate = (
    title: string,
    tmdbId: number,
    playlistId = 'library'
): DashboardRecommendationItem => ({
    tmdbId,
    title,
    mediaType: 'movie',
    originalTitle: null,
    year: 2020,
    rating: '7',
    genreIds: [18],
    posterUrl: null,
    seedTitle: 'Private watched seed',
    match: {
        queryTitle: title,
        playlistId,
        playlistName: 'Private source',
        categoryId: 1,
        xtreamId: tmdbId,
        type: 'movie',
        trailingYear: null,
    },
});

describe('AI candidate library filtering', () => {
    it('gives discovery and smaller source pools room within the model budget', () => {
        const large = Array.from({ length: 60 }, (_, index) =>
            candidate('Large', index)
        );
        const discovery = [
            candidate('Discovery', 100),
            candidate('Adjacent', 101),
        ];
        expect(
            balanceDashboardAiPools([large, discovery])
                .slice(0, 4)
                .map((item) => item.tmdbId)
        ).toEqual([0, 100, 1, 101]);
        expect(balanceDashboardAiPools([large, [large[0]]])).toHaveLength(60);
    });

    it('gives each title one row while preserving cards and stable ordering', () => {
        const used = new Set(['ai']);
        const retained = { id: 'new', title: 'Keep me' };
        expect(
            distinctDashboardCards([{ id: 'ai' }, retained, retained], used)
        ).toEqual([retained]);
        expect(
            distinctDashboardCards([retained, { id: 'next' }], used)
        ).toEqual([{ id: 'next' }]);
    });
    it('excludes watched, favorited, dismissed, deleted and unmatched titles', () => {
        const items = [
            candidate('Seen', 1),
            candidate('Favorite', 2),
            candidate('Dismissed', 3),
            candidate('Deleted', 4, 'removed'),
            candidate('Available', 5),
        ];
        const activity = [
            { title: 'Seen', type: 'movie' },
            { title: 'Favorite', type: 'movie' },
        ] as DashboardTmdbLookupItem[];
        const unmatched = {
            ...candidate('Unmatched', 6),
            match: null,
            popularity: 1,
        } as DashboardTrendingItem;
        expect(
            buildDashboardAiCandidates(
                items,
                [unmatched],
                activity,
                new Set(['library']),
                (item) => item.tmdbId === 3
            ).map((item) => item.title)
        ).toEqual(['Available']);
    });

    it('merges matched trending and recommendation pools without duplicate identities', () => {
        const item = candidate('Available', 5);
        const trending = { ...item, popularity: 1 } as DashboardTrendingItem;
        expect(
            buildDashboardAiCandidates(
                [item],
                [trending],
                [],
                new Set(['library']),
                () => false
            )
        ).toEqual([item]);
        const [result] = buildDashboardAiCandidates(
            [],
            [trending],
            [],
            new Set(['library']),
            () => false
        );
        expect(result.seedTitle).toBe('');
        expect(result.match.playlistId).toBe('library');
    });
});
