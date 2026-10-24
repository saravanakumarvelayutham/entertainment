import { TextDecoder, TextEncoder } from 'util';
import { SubtitleMatchService } from './subtitle-match.service';
import {
    SubtitleMatch,
    SubtitleSearchQuery,
    SubtitleTitleMatch,
} from './subtitle-contracts';
import { subtitleProviderRequest } from './subtitle-provider-request';

const DOWNLOAD =
    'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/12345';
const QUERY: SubtitleSearchQuery = {
    title: 'A & B/Film',
    type: 'movie',
    year: 2020,
};
const TITLE: SubtitleTitleMatch = {
    imdbId: 'tt1234567',
    title: 'Film',
    year: 2020,
    type: 'movie',
};
const MATCH: SubtitleMatch = {
    id: '12345',
    label: 'English',
    release: 'Film.1080p',
    url: DOWNLOAD,
};
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';

describe('fixed subtitle providers', () => {
    const originalFetch = globalThis.fetch;
    const originalDecoder = globalThis.TextDecoder;
    let fetchMock: jest.Mock;
    let cancel: jest.Mock;
    const service = new SubtitleMatchService();

    function response(value: unknown, url: string, raw = false) {
        const bytes = new TextEncoder().encode(
            raw ? String(value) : JSON.stringify(value)
        );
        let read = false;
        cancel = jest.fn().mockResolvedValue(undefined);
        return {
            ok: true,
            url,
            headers: { get: jest.fn(() => null) },
            body: {
                getReader: () => ({
                    read: jest.fn(async () => {
                        if (read) return { done: true };
                        read = true;
                        return { done: false, value: bytes };
                    }),
                    cancel,
                    releaseLock: jest.fn(),
                }),
            },
        };
    }

    function reply(value: unknown, raw = false) {
        fetchMock.mockImplementation(async (url: string) =>
            response(value, url, raw)
        );
    }

    beforeEach(() => {
        globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
        fetchMock = jest.fn();
        globalThis.fetch = fetchMock;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        globalThis.TextDecoder = originalDecoder;
        jest.useRealTimers();
    });

    it('encodes only public title metadata and omits credentials and referrers', async () => {
        reply({
            metas: [
                {
                    id: TITLE.imdbId,
                    name: 'Film',
                    type: 'movie',
                    releaseInfo: '2020',
                },
            ],
        });
        expect(await service.searchTitles(QUERY)).toEqual([TITLE]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://v3-cinemeta.strem.io/catalog/movie/top/search=A%20%26%20B%2FFilm.json',
            expect.objectContaining({
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                redirect: 'error',
            })
        );
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('headers');
    });

    it('allows explicit IMDb fallback without a title-provider request', async () => {
        expect(
            await service.searchTitles({ ...QUERY, title: 'tt1234567' })
        ).toEqual([{ ...TITLE, title: 'tt1234567' }]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed titles and IMDb matches and incomplete series episodes', async () => {
        await expect(
            service.searchTitles({ ...QUERY, title: '' })
        ).rejects.toThrow('valid');
        await expect(
            service.findEnglish({ ...TITLE, imdbId: '../secret' }, QUERY)
        ).rejects.toThrow('Invalid');
        await expect(
            service.findEnglish(
                { ...TITLE, type: 'series' },
                { ...QUERY, type: 'series' }
            )
        ).rejects.toThrow('season');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('validates title rows, limits matches and preserves provider order', async () => {
        reply({
            metas: [
                null,
                {},
                { id: 'tt12345', name: 'Wrong', type: 'series' },
                ...Array.from({ length: 25 }, (_, index) => ({
                    id: `tt${10000 + index}`,
                    name: `Movie ${index}`,
                    type: 'movie',
                })),
            ],
        });
        const matches = await service.searchTitles(QUERY);
        expect(matches).toHaveLength(20);
        expect(matches[0]).toEqual({
            imdbId: 'tt10000',
            title: 'Movie 0',
            year: null,
            type: 'movie',
        });
        expect(matches[19].title).toBe('Movie 19');
    });

    it('constructs season and episode IDs and retains only valid English downloads', async () => {
        reply({
            subtitles: [
                { id: 'fr', lang: 'fre', url: DOWNLOAD },
                {
                    id: 'unsafe',
                    lang: 'eng',
                    url: 'https://evil.example/file.srt',
                },
                {
                    id: 'a',
                    lang: 'eng',
                    url: DOWNLOAD,
                    movieReleaseName: 'Release A',
                },
                {
                    id: 'b',
                    lang: 'en',
                    url: DOWNLOAD,
                    subtitleFileName: 'Release B.srt',
                },
            ],
        });
        expect(
            await service.findEnglish(
                { ...TITLE, type: 'series' },
                {
                    ...QUERY,
                    type: 'series',
                    season: 0,
                    episode: 3,
                }
            )
        ).toEqual([
            {
                id: 'a',
                label: 'Release A',
                release: 'Release A',
                url: DOWNLOAD,
            },
            {
                id: 'b',
                label: 'Release B.srt',
                release: 'Release B.srt',
                url: DOWNLOAD,
            },
        ]);
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://opensubtitles-v3.strem.io/subtitles/series/tt1234567:0:3.json'
        );
    });

    it('bounds English results to twenty', async () => {
        reply({
            subtitles: Array.from({ length: 25 }, (_, index) => ({
                id: String(index),
                lang: 'eng',
                url: DOWNLOAD,
            })),
        });
        expect(await service.findEnglish(TITLE, QUERY)).toHaveLength(20);
    });

    it.each([
        'http://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/12345',
        'https://subs5.strem.io.evil.example/en/download/subencoding-stremio-utf8/src-api/file/12345',
        `${DOWNLOAD}?token=secret`,
        `${DOWNLOAD}#foo`,
        DOWNLOAD.replace('https://', 'https://user:pass@'),
        DOWNLOAD.replace('/12345', '/../secret'),
        'file:///tmp/subtitle.srt',
    ])('rejects unsafe download %s before network access', async (url) => {
        await expect(service.download({ ...MATCH, url })).rejects.toThrow(
            'Invalid'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['srt', SRT],
        ['vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello'],
    ])('downloads UTF-8 %s content', async (format, content) => {
        reply(`\uFEFF${content}`, true);
        expect(await service.download(MATCH)).toEqual({
            name: `Film.1080p.${format}`,
            format,
            content,
        });
        expect(cancel).toHaveBeenCalled();
    });

    it('rejects HTML and malformed subtitle content', async () => {
        reply('<html>Not subtitles</html>', true);
        await expect(service.download(MATCH)).rejects.toThrow(
            'Invalid subtitle file'
        );
    });

    it('rejects malformed JSON and missing response arrays', async () => {
        reply('nope', true);
        await expect(service.searchTitles(QUERY)).rejects.toThrow();
        reply({});
        await expect(service.findEnglish(TITLE, QUERY)).rejects.toThrow(
            'Invalid subtitle search'
        );
    });

    it('bounds streamed bytes and declared content lengths', async () => {
        reply('abcdef', true);
        await expect(subtitleProviderRequest(DOWNLOAD, 5)).rejects.toThrow(
            'too large'
        );
        const oversized = response('a', DOWNLOAD, true);
        oversized.headers.get.mockReturnValue('9999' as never);
        fetchMock.mockResolvedValue(oversized);
        await expect(subtitleProviderRequest(DOWNLOAD, 5)).rejects.toThrow(
            'too large'
        );
    });

    it('rejects HTTP failures and unexpected final origins', async () => {
        fetchMock.mockResolvedValue({ ok: false });
        await expect(service.download(MATCH)).rejects.toThrow('request failed');
        fetchMock.mockResolvedValue(
            response(SRT, 'https://evil.example', true)
        );
        await expect(service.download(MATCH)).rejects.toThrow(
            'unexpected origin'
        );
    });

    it('cancels before network access and during a request', async () => {
        const already = new AbortController();
        already.abort();
        await expect(service.download(MATCH, already.signal)).rejects.toThrow(
            'cancelled'
        );
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockReturnValue(new Promise(() => undefined));
        const active = new AbortController();
        const result = service.download(MATCH, active.signal);
        active.abort();
        await expect(result).rejects.toThrow('cancelled');
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('times out a stalled request after twenty seconds', async () => {
        jest.useFakeTimers();
        fetchMock.mockReturnValue(new Promise(() => undefined));
        const result = service.download(MATCH);
        const rejected = expect(result).rejects.toThrow('timed out');
        jest.advanceTimersByTime(20_000);
        await rejected;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it.each([
        'https://provider.example/movie/user/password/123.mp4',
        'Film\nSecret',
        'Film\u007f',
    ])(
        'rejects non-public title input %s without sending it',
        async (title) => {
            await expect(
                service.searchTitles({ ...QUERY, title })
            ).rejects.toThrow('valid');
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );

    it('deduplicates title and subtitle IDs before limiting results', async () => {
        reply({
            metas: [
                { id: 'tt1234567', name: 'First', type: 'movie' },
                { id: 'tt1234567', name: 'Duplicate', type: 'movie' },
                { id: 'tt1234568', name: 'Second', type: 'movie' },
            ],
        });
        expect(
            (await service.searchTitles(QUERY)).map((row) => row.title)
        ).toEqual(['First', 'Second']);
        reply({
            subtitles: [
                { id: 'a', lang: 'eng', url: DOWNLOAD },
                { id: 'a', lang: 'eng', url: DOWNLOAD },
                { id: 'b', lang: 'en', url: DOWNLOAD },
            ],
        });
        expect(
            (await service.findEnglish(TITLE, QUERY)).map((row) => row.id)
        ).toEqual(['a', 'b']);
    });

    it('applies the one MiB JSON and two MiB subtitle response limits', async () => {
        reply('x'.repeat(1024 * 1024 + 1), true);
        await expect(service.searchTitles(QUERY)).rejects.toThrow('too large');
        reply('x'.repeat(2 * 1024 * 1024 + 1), true);
        await expect(service.download(MATCH)).rejects.toThrow('too large');
    });

    it('cancels and releases a stalled body reader on timeout', async () => {
        jest.useFakeTimers();
        let finishRead: (value: { done: true }) => void = () => undefined;
        const releaseLock = jest.fn();
        const cancelBody = jest.fn(async () => {
            finishRead({ done: true });
        });
        fetchMock.mockResolvedValue({
            ok: true,
            url: DOWNLOAD,
            headers: { get: () => null },
            body: {
                getReader: () => ({
                    read: () =>
                        new Promise((resolve) => {
                            finishRead = resolve;
                        }),
                    cancel: cancelBody,
                    releaseLock,
                }),
            },
        });
        const result = service.download(MATCH);
        const rejected = expect(result).rejects.toThrow('timed out');
        await Promise.resolve();
        jest.advanceTimersByTime(20_000);
        await rejected;
        await Promise.resolve();
        expect(cancelBody).toHaveBeenCalled();
        expect(releaseLock).toHaveBeenCalled();
    });
});
