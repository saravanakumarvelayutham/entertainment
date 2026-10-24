import {
    confidentSubtitleTitle,
    subtitleQueryForTitle,
} from './subtitle-search-query';
import type { SubtitleTitleMatch } from '@iptvnator/services';

describe('subtitle title matching', () => {
    it('separates release hints from movie identity without losing its year', () => {
        expect(
            subtitleQueryForTitle({ primary: 'Inception (2010) 1080p WEB-DL' })
        ).toEqual({ title: 'Inception', type: 'movie', year: 2010 });
        expect(
            subtitleQueryForTitle({
                primary: 'Inception.2010.1080p.WEB-DL.x264-GROUP',
            })
        ).toEqual({ title: 'Inception', type: 'movie', year: 2010 });
    });
    it('extracts movie year without confusing a numeric movie title', () => {
        expect(subtitleQueryForTitle({ primary: 'Inception (2010)' })).toEqual({
            title: 'Inception',
            type: 'movie',
            year: 2010,
        });
        expect(subtitleQueryForTitle({ primary: '1917' })).toEqual({
            title: '1917',
            type: 'movie',
        });
    });
    it('uses series title and episode numbers rather than searching the episode name', () => {
        expect(
            subtitleQueryForTitle({
                primary: 'Breaking Bad',
                secondary: 'S01E02 · Pilot',
            })
        ).toEqual({
            title: 'Breaking Bad',
            type: 'series',
            season: 1,
            episode: 2,
        });
        expect(
            subtitleQueryForTitle({ primary: 'Show S02E03 - Episode name' })
        ).toEqual({ title: 'Show', type: 'series', season: 2, episode: 3 });
        expect(
            subtitleQueryForTitle({ primary: 'Show', secondary: '1x04' })
        ).toMatchObject({ season: 1, episode: 4 });
    });
    it('requires a year to disambiguate remakes', () => {
        const matches: SubtitleTitleMatch[] = [
            { imdbId: 'tt1234567', title: 'Movie', type: 'movie', year: 1990 },
            { imdbId: 'tt1234568', title: 'Movie', type: 'movie', year: 2020 },
            { imdbId: 'tt1234569', title: 'Movie', type: 'movie', year: null },
        ];
        expect(
            confidentSubtitleTitle(matches, { title: 'Movie', type: 'movie' })
        ).toBeNull();
        expect(
            confidentSubtitleTitle(matches, {
                title: 'Movie',
                type: 'movie',
                year: 2020,
            })
        ).toBe(matches[1]);
        expect(
            confidentSubtitleTitle(matches, {
                title: 'Movie',
                type: 'movie',
                year: 2010,
            })
        ).toBeNull();
    });
    it('matches Weapons with or without its year without choosing a different title', () => {
        const matches: SubtitleTitleMatch[] = [
            {
                imdbId: 'tt26581740',
                title: 'Weapons',
                type: 'movie',
                year: 2025,
            },
            {
                imdbId: 'tt0497470',
                title: 'Weapons',
                type: 'movie',
                year: 2007,
            },
            {
                imdbId: 'tt0069952',
                title: 'Deadly Weapons',
                type: 'movie',
                year: 1974,
            },
        ];
        for (const primary of [
            'weapons 2025',
            'Weapons (2025)',
            'Weapons.2025.1080p.WEB-DL',
        ]) {
            const query = subtitleQueryForTitle({ primary });
            expect(query.title.toLowerCase()).toBe('weapons');
            expect(confidentSubtitleTitle(matches, query)).toBe(matches[0]);
        }
        expect(
            confidentSubtitleTitle(matches, {
                title: 'Weapons',
                year: 2007,
                type: 'movie',
            })
        ).toBe(matches[1]);
        expect(
            confidentSubtitleTitle(matches, {
                title: 'Weapons',
                year: 2024,
                type: 'movie',
            })
        ).toBeNull();
        expect(
            confidentSubtitleTitle(matches.slice(2), {
                title: 'Weapons',
                type: 'movie',
            })
        ).toBeNull();
    });

    it('uses structured page year over title text and rejects invalid years', () => {
        expect(
            subtitleQueryForTitle({ primary: 'Weapons', year: 2025 })
        ).toEqual({ title: 'Weapons', type: 'movie', year: 2025 });
        expect(
            subtitleQueryForTitle({ primary: 'Weapons (2007)', year: 2025 })
        ).toEqual({ title: 'Weapons', type: 'movie', year: 2025 });
        expect(
            subtitleQueryForTitle({ primary: 'Weapons (2025)', year: NaN })
        ).toEqual({ title: 'Weapons', type: 'movie', year: 2025 });
    });

    it('accepts unique exact Unicode titles while ignoring punctuation and case', () => {
        const match: SubtitleTitleMatch = {
            imdbId: 'tt1234567',
            title: 'Amélie!',
            type: 'movie',
            year: 2001,
        };
        expect(
            confidentSubtitleTitle([match], { title: 'AMÉLIE', type: 'movie' })
        ).toBe(match);
        expect(
            confidentSubtitleTitle([match], {
                title: 'Different movie',
                type: 'movie',
            })
        ).toBeNull();
    });
});
