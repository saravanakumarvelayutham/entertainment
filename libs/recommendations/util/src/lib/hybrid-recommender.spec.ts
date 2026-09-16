import { rankHybridRecommendations } from './hybrid-recommender';

interface CandidateValue {
    readonly title: string;
}

const candidate = (
    title: string,
    overrides: Partial<{
        affinityKeys: string[];
        sourceRank: number;
        rating: number | null;
        voteCount: number;
        popularity: number;
        year: number | null;
        mediaType: 'movie' | 'tv';
    }> = {}
) => ({
    id: title,
    value: { title } satisfies CandidateValue,
    affinityKeys: overrides.affinityKeys ?? ['genre:action'],
    sourceRank: overrides.sourceRank ?? 0,
    rating: overrides.rating ?? 7,
    voteCount: overrides.voteCount ?? 100,
    popularity: overrides.popularity ?? 50,
    year: overrides.year ?? 2024,
    mediaType: overrides.mediaType ?? ('movie' as const),
});

describe('rankHybridRecommendations', () => {
    const profile = [
        { key: 'genre:action', label: 'Action', weight: 10 },
        { key: 'genre:drama', label: 'Drama', weight: 6 },
    ];

    it('prioritizes taste affinity over generic popularity', () => {
        const ranked = rankHybridRecommendations(
            profile,
            [
                candidate('Popular mismatch', {
                    affinityKeys: ['genre:romance'],
                    rating: 9,
                    voteCount: 1000,
                    popularity: 1000,
                }),
                candidate('Personal match', {
                    affinityKeys: ['genre:action'],
                    sourceRank: 5,
                    rating: 6,
                }),
            ],
            { limit: 2, currentYear: 2026 }
        );

        expect(ranked[0].value.title).toBe('Personal match');
        expect(ranked[0].reasons).toEqual(['Action']);
    });

    it('introduces a second interest instead of returning near duplicates', () => {
        const ranked = rankHybridRecommendations(
            profile,
            [
                candidate('Action one'),
                candidate('Action two', { sourceRank: 1 }),
                candidate('Drama one', {
                    affinityKeys: ['genre:drama'],
                    sourceRank: 1,
                    mediaType: 'tv',
                }),
            ],
            { limit: 2, currentYear: 2026, diversity: 0.5 }
        );

        expect(ranked.map(({ value }) => value.title)).toEqual([
            'Action one',
            'Drama one',
        ]);
    });

    it('is deterministic and respects the requested limit', () => {
        const candidates = [candidate('First'), candidate('Second')];
        const first = rankHybridRecommendations(profile, candidates, {
            limit: 1,
            currentYear: 2026,
        });
        const second = rankHybridRecommendations(profile, candidates, {
            limit: 1,
            currentYear: 2026,
        });

        expect(first).toEqual(second);
        expect(first).toHaveLength(1);
        expect(first[0].value.title).toBe('First');
    });

    it('contains malformed numeric signals at the pure boundary', () => {
        const [ranked] = rankHybridRecommendations(
            [{ key: 'genre:action', label: 'Action', weight: Infinity }],
            [
                candidate('Malformed', {
                    sourceRank: Number.NaN,
                    rating: Number.NaN,
                    voteCount: -4,
                    popularity: Infinity,
                }),
            ],
            { limit: 1, currentYear: Number.NaN, diversity: Number.NaN }
        );

        expect(ranked.value.title).toBe('Malformed');
        expect(Number.isFinite(ranked.score)).toBe(true);
        expect(ranked.reasons).toEqual([]);
    });
});
