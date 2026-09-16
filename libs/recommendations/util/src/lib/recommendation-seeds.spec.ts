import { selectBalancedRecommendationSeeds } from './recommendation-seeds';

interface Seed {
    readonly id: string;
    readonly source: string;
}

const seed = (id: string, source: string): Seed => ({ id, source });

describe('selectBalancedRecommendationSeeds', () => {
    it('keeps a large source from starving smaller sources', () => {
        const selected = selectBalancedRecommendationSeeds(
            [
                Array.from({ length: 10 }, (_, index) =>
                    seed(`recent-${index}`, 'recent')
                ),
                [seed('favorite', 'favorite')],
                [seed('external', 'external')],
            ],
            { limit: 6, key: ({ id }) => id }
        );

        expect(selected.map(({ source }) => source)).toEqual([
            'recent',
            'favorite',
            'external',
            'recent',
            'recent',
            'recent',
        ]);
    });

    it('deduplicates across sources without wasting a slot', () => {
        const selected = selectBalancedRecommendationSeeds(
            [
                [seed('shared', 'recent'), seed('recent-2', 'recent')],
                [seed('shared', 'favorite'), seed('favorite-2', 'favorite')],
            ],
            { limit: 3, key: ({ id }) => id }
        );

        expect(selected.map(({ id }) => id)).toEqual([
            'shared',
            'favorite-2',
            'recent-2',
        ]);
    });

    it('returns no seeds for a non-positive limit', () => {
        expect(
            selectBalancedRecommendationSeeds([[seed('recent', 'recent')]], {
                limit: 0,
                key: ({ id }) => id,
            })
        ).toEqual([]);
    });
});
