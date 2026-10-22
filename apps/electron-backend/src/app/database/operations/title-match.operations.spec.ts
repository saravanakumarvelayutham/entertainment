import type { AppDatabase } from '../database.types';
import { matchTitles } from './title-match.operations';

function createDbMock(rowsPerCall: unknown[][]) {
    let call = 0;
    const all = jest.fn().mockImplementation(() => {
        const rows = rowsPerCall[call] ?? [];
        call += 1;
        return Promise.resolve(rows);
    });
    return { db: { all } as unknown as AppDatabase, all };
}

const matrixRow = {
    title: 'The Matrix [4K]',
    xtream_id: 42,
    type: 'movie',
    category_xtream_id: 7,
    playlist_id: 'playlist-1',
    playlist_name: 'My Portal',
};

describe('title-match.operations', () => {
    it('returns confident matches with playlist context', async () => {
        const { db } = createDbMock([[matrixRow]]);

        await expect(matchTitles(db, ['The Matrix'])).resolves.toEqual([
            {
                queryTitle: 'The Matrix',
                playlistId: 'playlist-1',
                playlistName: 'My Portal',
                categoryId: 7,
                xtreamId: 42,
                type: 'movie',
                trailingYear: null,
                tmdbId: null,
            },
        ]);
    });

    it('reports a bracketed year tag on the exact tier', async () => {
        // "Dune (1984)" and "Dune (2021)" normalize to the same exact key,
        // so the bracket is the only thing that tells the two films apart.
        const { db } = createDbMock([
            [
                { ...matrixRow, title: 'Dune (1984)', xtream_id: 84 },
                { ...matrixRow, title: 'Dune (2021)', xtream_id: 21 },
            ],
        ]);

        const matches = await matchTitles(db, ['Dune']);
        expect(matches.map((match) => match.trailingYear)).toEqual([
            1984, 2021,
        ]);
    });

    it('falls back to the stored provider release year and TMDB id', async () => {
        const { db } = createDbMock([
            [
                {
                    ...matrixRow,
                    title: 'Dune',
                    release_year: 2021,
                    tmdb_id: 438631,
                },
            ],
        ]);

        const [match] = await matchTitles(db, ['Dune']);
        expect(match.trailingYear).toBe(2021);
        expect(match.tmdbId).toBe(438631);
    });

    it('prefers the title tag over the stored release year', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'Dune (1984)', release_year: 2021 }],
        ]);

        const [match] = await matchTitles(db, ['Dune']);
        expect(match.trailingYear).toBe(1984);
    });

    it('treats junk stored ids and years as unknown', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, release_year: 0, tmdb_id: '12' }],
        ]);

        const [match] = await matchTitles(db, ['The Matrix']);
        expect(match.trailingYear).toBeNull();
        expect(match.tmdbId).toBeNull();
    });

    it('reports the stripped year tag for base-tier matches', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'The Matrix 1999' }],
        ]);

        const matches = await matchTitles(db, ['The Matrix']);
        expect(matches).toHaveLength(1);
        expect(matches[0].trailingYear).toBe(1999);
    });

    it('keeps title-years intact on the exact tier', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'Blade Runner 2049' }],
        ]);

        // Exact-tier: the query itself carries the year as part of the title
        const exact = await matchTitles(db, ['Blade Runner 2049']);
        expect(exact).toHaveLength(1);
        expect(exact[0].trailingYear).toBeNull();
    });

    it('flags "Blade Runner" matching "Blade Runner 2049" with the year tag', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'Blade Runner 2049' }],
        ]);

        // Base-tier hit: the renderer must reject it via the 2049/1982
        // year incompatibility (trailingYear is surfaced for exactly that)
        const matches = await matchTitles(db, ['Blade Runner']);
        expect(matches).toHaveLength(1);
        expect(matches[0].trailingYear).toBe(2049);
    });

    it('drops FTS candidates whose normalized title differs', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'The Matrix Reloaded' }],
        ]);

        await expect(matchTitles(db, ['The Matrix'])).resolves.toEqual([]);
    });

    it('skips titles that normalize to nothing usable and deduplicates', async () => {
        const { db, all } = createDbMock([[matrixRow]]);

        await matchTitles(db, ['', '  ', 'The Matrix', 'The Matrix']);
        expect(all).toHaveBeenCalledTimes(1);
    });

    it('survives a failing FTS query for one title', async () => {
        let call = 0;
        const all = jest.fn().mockImplementation(() => {
            call += 1;
            return call === 1
                ? Promise.reject(new Error('fts syntax'))
                : Promise.resolve([matrixRow]);
        });
        const db = { all } as unknown as AppDatabase;

        const matches = await matchTitles(db, ['Weird "Title"', 'The Matrix']);
        expect(matches).toHaveLength(1);
        expect(matches[0].queryTitle).toBe('The Matrix');
    });
});
