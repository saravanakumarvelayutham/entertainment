import { SubtitleMatch, SubtitleSearchQuery } from './subtitle-contracts';
import { rankEnglishSubtitleReleases } from './subtitle-release-ranking';

const query: SubtitleSearchQuery = {
    title: 'Example Film',
    type: 'movie',
    year: 2024,
};
function match(id: string, release: string, label = 'English'): SubtitleMatch {
    return { id, release, label, url: `https://example.test/${id}` };
}
function ids(matches: SubtitleMatch[]) {
    return matches.map((item) => item.id);
}

describe('English subtitle release ranking', () => {
    it('ranks explicit source, group, resolution and codec matches over generic releases', () => {
        const releases = [
            match('generic', 'Example.Film.2024'),
            match('other', 'Example.Film.2024.720p.BluRay.x264-OTHER'),
            match('exact', 'Example.Film.2024.1080p.WEB-DL.x265-GROUP'),
        ];
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    releases,
                    query,
                    'Example.Film.2024.1080p.WEB-DL.HEVC-GROUP'
                )
            )
        ).toEqual(['exact', 'generic', 'other']);
        expect(releases[0].id).toBe('generic');
    });

    it('uses the playback display title as release evidence by default', () => {
        const releases = [
            match('generic', 'Example Film'),
            match('web', 'Example.Film.1080p.WEBRip'),
        ];
        expect(
            ids(
                rankEnglishSubtitleReleases(releases, {
                    ...query,
                    title: 'Example Film 1080p WEBRip',
                })
            )
        ).toEqual(['web', 'generic']);
    });

    it.each([
        'CAM',
        'HDCAM',
        'HDTS',
        'Telesync',
        'TC',
        'DVDSCR',
        'Screener',
        'TS.x264',
    ])('strongly deprioritizes %s even when source tokens match', (bad) => {
        const releases = [
            match('bad', `Example.Film.2024.${bad}.1080p.WEB-DL.x265-GROUP`),
            match('good', 'Example Film'),
        ];
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    releases,
                    query,
                    '1080p.WEB-DL.x265-GROUP'
                )
            )
        ).toEqual(['good', 'bad']);
    });

    it.each(['Forced', 'Incomplete', 'Partial', 'Foreign.Parts.Only'])(
        'prefers complete English subtitles over %s tracks',
        (suffix) => {
            expect(
                ids(
                    rankEnglishSubtitleReleases(
                        [
                            match(
                                'partial',
                                `Example.Film.2024.1080p.WEB-DL.${suffix}`
                            ),
                            match('full', 'Example Film'),
                        ],
                        query,
                        '1080p.WEB-DL'
                    )
                )
            ).toEqual(['full', 'partial']);
        }
    );

    it('preserves provider order when source evidence is unknown', () => {
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('first', 'Example.Film.720p.HDTV'),
                        match('second', 'Example.Film.2160p.BluRay'),
                        match('third', 'Example.Film.WEBRip'),
                    ],
                    query
                )
            )
        ).toEqual(['first', 'second', 'third']);
    });

    it('preserves provider ordering for equally good matches', () => {
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('a', 'Example.Film.1080p.WEB-DL-GROUP'),
                        match('b', 'Example.Film.1080p.WEB-DL-GROUP'),
                    ],
                    query,
                    '1080p.WEB-DL-GROUP'
                )
            )
        ).toEqual(['a', 'b']);
    });

    it('excludes explicit wrong season or episode markers while retaining untagged releases', () => {
        const episode: SubtitleSearchQuery = {
            title: 'Example Show',
            type: 'series',
            season: 2,
            episode: 3,
        };
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('wrong', 'Example.Show.S02E04.WEB-DL'),
                        match('right', 'Example.Show.S02E03.WEB-DL'),
                        match('other-season', 'Example.Show.1x03.WEB-DL'),
                        match('season-pack', 'Example.Show.Season.1'),
                        match('generic', 'Example Show'),
                    ],
                    episode
                )
            )
        ).toEqual(['right', 'generic']);
        expect(
            rankEnglishSubtitleReleases(
                [match('wrong', 'Example.Show.S01E03')],
                episode
            )
        ).toEqual([]);
    });

    it('does not confuse movie title words, TS transport extensions or TS substrings with bad releases', () => {
        for (const title of ['Cam', 'Screener', 'TS']) {
            expect(
                ids(
                    rankEnglishSubtitleReleases(
                        [
                            match('title', `${title}.2024.1080p.WEB-DL`),
                            match('generic', 'Generic'),
                        ],
                        { ...query, title }
                    )
                )
            ).toEqual(['title', 'generic']);
        }
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match(
                            'transport',
                            'Example.Film.2024.1080p.WEB-DL.x264.ts'
                        ),
                        match('word', 'Example.Film.2024.Hits'),
                        match('plain', 'Example Film'),
                    ],
                    query
                )
            )
        ).toEqual(['transport', 'word', 'plain']);
    });

    it('ignores labels and URLs, including markup and policy-looking text', () => {
        const releases = [
            match(
                'first',
                'Example Film',
                '<img src=x onerror=alert(1)> FORCED HDCAM'
            ),
            match('second', 'Example Film', 'BEST English 1080p WEB-DL-GROUP'),
        ];
        releases[0].url = 'https://example.test/HDCAM/forced';
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    releases,
                    query,
                    '1080p WEB-DL-GROUP'
                )
            )
        ).toEqual(['first', 'second']);
    });

    it('supports a release-hint string without a query', () => {
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('generic', 'Film'),
                        match('match', 'Film.WEB-DL.1080p'),
                    ],
                    'WEB-DL.1080p'
                )
            )
        ).toEqual(['match', 'generic']);
    });

    it('recognizes explicit multi-episode and underscore tags', () => {
        const episode: SubtitleSearchQuery = {
            title: 'Show',
            type: 'series',
            season: 1,
            episode: 3,
        };
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('multi', 'Show.S01E02E03.1080p'),
                        match('underscores', 'Show_S01E03_WEB_DL'),
                        match('other', 'Show.S01E01-E02'),
                    ],
                    episode
                )
            )
        ).toEqual(['multi', 'underscores']);
    });

    it('does not mistake an explicit non-forced track for forced-only subtitles', () => {
        expect(
            ids(
                rankEnglishSubtitleReleases(
                    [
                        match('full', 'Example.Film.2024.Non-Forced'),
                        match('plain', 'Example Film'),
                        match('forced', 'Example.Film.2024.Forced'),
                    ],
                    query
                )
            )
        ).toEqual(['full', 'plain', 'forced']);
    });
});
