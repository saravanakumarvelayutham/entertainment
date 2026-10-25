import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import {
    groupTitleMatchesByKey,
    pickTitleMatch,
} from './catalog-title-match.service';

describe('catalog title matching', () => {
    const match = (
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle: 'Dune',
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: 1,
        type: 'movie',
        trailingYear: null,
        tmdbId: null,
        ...overrides,
    });

    const pick = (
        lookup: {
            titles: string[];
            year: number | null;
            type?: 'movie' | 'series';
            tmdbId?: number | null;
        },
        matches: CatalogTitleMatch[]
    ) =>
        pickTitleMatch(
            { type: lookup.type ?? 'movie', ...lookup },
            groupTitleMatchesByKey(matches)
        );

    describe('groupTitleMatchesByKey', () => {
        it('keeps every row sharing a key, in worker order', () => {
            const first = match({ trailingYear: 1984, xtreamId: 84 });
            const second = match({ trailingYear: 2021, xtreamId: 21 });

            expect(groupTitleMatchesByKey([first, second])).toEqual(
                new Map([['movie:dune', [first, second]]])
            );
        });

        it('separates the same title across media types', () => {
            const movie = match({ type: 'movie' });
            const series = match({ type: 'series' });

            expect([...groupTitleMatchesByKey([movie, series]).keys()]).toEqual(
                ['movie:dune', 'series:dune']
            );
        });
    });

    describe('pickTitleMatch', () => {
        it('prefers the row whose stripped year is the lookup year', () => {
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: 1984, xtreamId: 84 }),
                match({ trailingYear: 2021, xtreamId: 21 }),
            ]);

            expect(picked?.xtreamId).toBe(21);
        });

        it('prefers the exact-year row over an untagged one', () => {
            // An untagged row merely fails to contradict the lookup; a row
            // carrying the year is positive evidence for this exact film.
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: null, xtreamId: 7 }),
                match({ trailingYear: 2021, xtreamId: 21 }),
            ]);

            expect(picked?.xtreamId).toBe(21);
        });

        it('prefers an untagged row over a merely year-compatible one', () => {
            // No row states 2021. An untagged "Dune" does not contradict
            // the lookup at all, while a "Dune 2020" only survives on the
            // one-year drift — so the untagged row outranks it.
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: 2020, xtreamId: 20 }),
                match({ trailingYear: null, xtreamId: 7 }),
            ]);

            expect(picked?.xtreamId).toBe(7);
        });

        it('prefers an untagged row when the lookup year is unknown', () => {
            const picked = pick({ titles: ['Dune'], year: null }, [
                match({ trailingYear: 1984, xtreamId: 84 }),
                match({ trailingYear: null, xtreamId: 7 }),
            ]);

            expect(picked?.xtreamId).toBe(7);
        });

        it('rejects every year-incompatible row', () => {
            expect(
                pick({ titles: ['Blade Runner'], year: 1982 }, [
                    match({ queryTitle: 'Blade Runner', trailingYear: 2049 }),
                ])
            ).toBeNull();
        });

        it('accepts a one-year drift', () => {
            expect(
                pick({ titles: ['Dune'], year: 2021 }, [
                    match({ trailingYear: 2020, xtreamId: 20 }),
                ])?.xtreamId
            ).toBe(20);
        });

        it('does not match across media types', () => {
            expect(
                pick({ titles: ['Dune'], year: 2021, type: 'series' }, [
                    match({ type: 'movie', trailingYear: 2021 }),
                ])
            ).toBeNull();
        });

        it('ranks by evidence across aliases, not by alias order', () => {
            // The localized title finds only an untagged row while the
            // original-title alias holds the row carrying the lookup's own
            // year — the better evidence must win regardless of which
            // alias found it.
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: null,
                        xtreamId: 1,
                    }),
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: 2012,
                        xtreamId: 2,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(2);
        });

        it('falls back to the alias when the first alias is incompatible', () => {
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: 2020,
                        xtreamId: 1,
                    }),
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: null,
                        xtreamId: 2,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(2);
        });

        it('breaks ties inside a tier by alias order', () => {
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: null,
                        xtreamId: 2,
                    }),
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: null,
                        xtreamId: 1,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(1);
        });

        it('returns null when nothing matched the title at all', () => {
            expect(
                pick({ titles: ['Unmatched'], year: null }, [match()])
            ).toBeNull();
        });

        it('rejects a same-titled row that states a different year', () => {
            // The worker reports "Dune (1984)" as an exact match carrying
            // 1984, so a 2021 lookup must not open the 1984 film.
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: 1984, xtreamId: 84 }),
            ]);

            expect(picked).toBeNull();
        });

        it('drops a row carrying a different TMDB id, whatever its year', () => {
            const picked = pick(
                { titles: ['Dune'], year: 2021, tmdbId: 438631 },
                [
                    match({ tmdbId: 841, trailingYear: 2021, xtreamId: 84 }),
                    match({ tmdbId: null, trailingYear: null, xtreamId: 7 }),
                ]
            );

            expect(picked).toBeNull();
        });

        it('does not claim an untagged Brothers catalog row for a specific TMDB release', () => {
            expect(
                pick(
                    {
                        titles: ['Brothers'],
                        year: 2026,
                        type: 'series',
                        tmdbId: 999,
                    },
                    [
                        match({
                            queryTitle: 'Brothers',
                            type: 'series',
                            trailingYear: null,
                            tmdbId: null,
                        }),
                    ]
                )
            ).toBeNull();
        });

        it('requires the same stored ID when a TMDB lookup has no year', () => {
            expect(
                pick({ titles: ['Dune'], year: null, tmdbId: 438631 }, [
                    match(),
                ])
            ).toBeNull();
            expect(
                pick({ titles: ['Dune'], year: null, tmdbId: 438631 }, [
                    match({ tmdbId: 438631 }),
                ])?.xtreamId
            ).toBe(1);
        });

        it('accepts a known compatible year for a TMDB lookup without a stored ID', () => {
            expect(
                pick({ titles: ['Dune'], year: 2021, tmdbId: 438631 }, [
                    match({ trailingYear: 2021 }),
                ])?.xtreamId
            ).toBe(1);
        });

        it('lets a matching TMDB id outrank every title-only row', () => {
            const picked = pick(
                { titles: ['Dune'], year: 2021, tmdbId: 438631 },
                [
                    match({ trailingYear: 2021, xtreamId: 21 }),
                    match({ tmdbId: 438631, trailingYear: null, xtreamId: 9 }),
                ]
            );

            expect(picked?.xtreamId).toBe(9);
        });

        it('ignores an unknown lookup id and a missing row id', () => {
            const picked = pick(
                { titles: ['Dune'], year: 2021, tmdbId: null },
                [match({ tmdbId: 841, trailingYear: null, xtreamId: 84 })]
            );

            expect(picked?.xtreamId).toBe(84);
        });
    });
});
