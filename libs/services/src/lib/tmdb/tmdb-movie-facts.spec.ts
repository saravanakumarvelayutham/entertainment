import { movieFactsFromTmdb } from './tmdb-movie-facts';
import { trimDetailsForCache } from './tmdb-cache-payload';
import { TmdbMovieDetails } from './tmdb.types';

describe('movieFactsFromTmdb', () => {
    const movie: TmdbMovieDetails = {
        id: 603,
        original_title: ' The Matrix ',
        original_language: 'en',
        release_date: '1999-03-31',
        budget: 63000000,
        revenue: 463517383,
        belongs_to_collection: { name: 'The Matrix Collection' },
        production_companies: [
            { name: 'Warner Bros.' },
            { name: 'Warner Bros.' },
        ],
        credits: {
            crew: [
                { name: 'Lana Wachowski', job: 'Screenplay' },
                { name: ' lana wachowski ', job: 'Screenplay' },
                { name: 'Don Davis', job: 'Original Music Composer' },
                { name: 'Story Author', job: 'Story' },
                { name: 'Music Editor', job: 'Music Editor' },
            ],
        },
    };

    it('keeps stated production facts and precise credit roles', () => {
        expect(movieFactsFromTmdb(movie)).toEqual({
            tmdbId: 603,
            originalTitle: 'The Matrix',
            originalLanguage: 'en',
            releaseDate: '1999-03-31',
            budget: 63000000,
            revenue: 463517383,
            collectionName: 'The Matrix Collection',
            productionCompanies: ['Warner Bros.'],
            screenplayBy: ['Lana Wachowski'],
            musicBy: ['Don Davis'],
        });
    });

    it('omits unknown values rather than inventing facts', () => {
        expect(
            movieFactsFromTmdb({
                id: 603,
                original_title: ' ',
                original_language: 'xx',
                release_date: '2025-02-30',
                budget: 0,
                revenue: NaN,
                belongs_to_collection: null,
                production_companies: [{ name: '' }],
            })
        ).toBeUndefined();
        expect(
            movieFactsFromTmdb({ id: 0, original_title: 'Movie' })
        ).toBeUndefined();
        expect(
            movieFactsFromTmdb({ id: 603, budget: -10, revenue: Infinity })
        ).toBeUndefined();
    });

    it('validates dates without a timezone-dependent day shift', () => {
        expect(
            movieFactsFromTmdb({ id: 1, release_date: '2024-02-29' })
                ?.releaseDate
        ).toBe('2024-02-29');
        for (const date of ['2023-02-29', '0000-00-00', '2020', '2020-13-01']) {
            expect(
                movieFactsFromTmdb({ id: 1, release_date: date })
            ).toBeUndefined();
        }
    });

    it('ignores malformed scalar payload values instead of rendering them', () => {
        const malformed = {
            id: 1,
            original_title: 123,
            original_language: false,
            release_date: 20240229,
            budget: '1000',
            belongs_to_collection: { name: 123 },
            production_companies: [{ name: 123 }],
            credits: { crew: [{ name: 123, job: 'Screenplay' }] },
        } as unknown as TmdbMovieDetails;
        expect(movieFactsFromTmdb(malformed)).toBeUndefined();
    });

    it('bounds lists and preserves their order without mutating details', () => {
        const details = {
            id: 1,
            production_companies: Array.from({ length: 20 }, (_, n) => ({
                name: `Studio ${n}`,
            })),
        };
        expect(movieFactsFromTmdb(details)?.productionCompanies).toEqual(
            Array.from({ length: 8 }, (_, n) => `Studio ${n}`)
        );
        expect(details.production_companies).toHaveLength(20);
    });

    it('preserves all movie facts through a serialized warm cache payload', () => {
        const cached = JSON.parse(JSON.stringify(trimDetailsForCache(movie)));
        expect(movieFactsFromTmdb(cached)).toEqual(movieFactsFromTmdb(movie));
        expect(movieFactsFromTmdb(cached)?.screenplayBy).toEqual([
            'Lana Wachowski',
        ]);
        expect(movieFactsFromTmdb(cached)?.musicBy).toEqual(['Don Davis']);
    });
});
