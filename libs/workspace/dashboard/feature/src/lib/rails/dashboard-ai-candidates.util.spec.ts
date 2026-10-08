import type {
    DashboardRecommendationItem,
    DashboardTrendingItem,
    DashboardTmdbLookupItem,
} from '@iptvnator/workspace/dashboard/data-access';
import { buildDashboardAiCandidates } from './dashboard-ai-candidates.util';

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
