import { PlaylistMeta } from './playlist-meta.type';
import { buildPlaylistRecentItems } from './playlist-recently-viewed.utils';

describe('M3U recently viewed content type', () => {
    it.each([
        ['movie', 'movie'],
        ['live', 'live'],
        [undefined, 'live'],
    ] as const)('maps stored category %s to %s', (category, type) => {
        const url = 'https://example.test/movie/stream.mkv';
        const items = buildPlaylistRecentItems(
            [
                {
                    _id: 'playlist-1',
                    title: 'My source',
                    recentlyViewed: [
                        {
                            source: 'm3u',
                            id: 'stored-id',
                            url,
                            title: 'Dune',
                            category_id: category,
                            added_at: '2026-10-23T12:00:00Z',
                        },
                    ],
                } as unknown as PlaylistMeta,
            ],
            { stalker: 'Stalker', m3u: 'M3U' }
        );

        expect(items).toHaveLength(1);
        expect(items[0]).toEqual(
            expect.objectContaining({
                id: 'stored-id',
                xtream_id: url,
                playlist_id: 'playlist-1',
                source: 'm3u',
                type,
                category_id: type,
            })
        );
    });
});
