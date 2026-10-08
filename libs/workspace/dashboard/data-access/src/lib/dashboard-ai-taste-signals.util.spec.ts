import type {
    PlaybackPositionData,
    PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { buildDashboardAiTasteSignals } from './dashboard-ai-taste-signals.util';

const item = (
    title: string,
    id = 1,
    type: 'movie' | 'series' | 'live' = 'movie'
): PortalActivityItem => ({
    title,
    id,
    type,
    playlist_id: 'private-source',
    xtream_id: id,
    category_id: 1,
    playlist_name: 'private account',
    poster_url: 'https://private.example/?password=secret',
});
const position = (
    positionSeconds: number,
    extra: Partial<PlaybackPositionData> = {}
): PlaybackPositionData => ({
    contentXtreamId: 1,
    contentType: 'vod',
    positionSeconds,
    durationSeconds: 100,
    ...extra,
});

describe('buildDashboardAiTasteSignals', () => {
    it('shares only title, media type and coarse progress, using the existing watched threshold', () => {
        const result = buildDashboardAiTasteSignals(
            [
                item('Started', 1),
                item('Progress', 2),
                item('Completed', 3),
                item('Live', 4, 'live'),
            ],
            [item('Favorite')],
            new Map([
                ['private-source::2::vod', position(50)],
                ['private-source::3::vod', position(90)],
            ]),
            []
        );
        expect(result.watched.map(({ completion }) => completion)).toEqual([
            'started',
            'in-progress',
            'completed',
        ]);
        expect(result.favorites).toEqual([
            { title: 'Favorite', mediaType: 'movie' },
        ]);
        const payload = JSON.stringify(result);
        for (const secret of [
            'private-source',
            'private account',
            'private.example',
            'password',
            'playlist',
            'updatedAt',
        ])
            expect(payload).not.toContain(secret);
    });

    it('matches series landing rows to the newest saved episode while keeping timestamps local', () => {
        const result = buildDashboardAiTasteSignals(
            [item('Series', 10, 'series')],
            [],
            new Map([
                [
                    'private-source::100::episode',
                    position(100, {
                        contentType: 'episode',
                        seriesXtreamId: 10,
                        updatedAt: '2026-10-06',
                    }),
                ],
                [
                    'private-source::101::episode',
                    position(50, {
                        contentType: 'episode',
                        seriesXtreamId: 10,
                        updatedAt: '2026-10-07',
                    }),
                ],
            ]),
            []
        );
        expect(result.watched).toEqual([
            { title: 'Series', mediaType: 'tv', completion: 'in-progress' },
        ]);
    });

    it('deduplicates and bounds history, favorites and votes while retaining old votes without titles', () => {
        const rows = [
            item('Same'),
            item('same'),
            ...Array.from({ length: 70 }, (_, i) => item(`Title ${i}`, i + 2)),
        ];
        const votes = Array.from({ length: 120 }, (_, i) => ({
            tmdbId: i + 1,
            mediaType: 'movie' as const,
            genreIds: [18, 18],
            choice: 'more-like-this' as const,
            updatedAt: 'private-date',
            ...(i === 0 ? { title: 'Arrival' } : {}),
        }));
        const result = buildDashboardAiTasteSignals(
            rows,
            rows,
            new Map(),
            votes
        );
        expect(result.watched).toHaveLength(50);
        expect(result.favorites).toHaveLength(50);
        expect(result.votes).toHaveLength(100);
        expect(result.votes[0]).toEqual({
            tmdbId: 1,
            mediaType: 'movie',
            genreIds: [18],
            choice: 'more-like-this',
            title: 'Arrival',
        });
        expect(result.votes[1]).not.toHaveProperty('title');
        expect(JSON.stringify(result)).not.toContain('private-date');
    });
});
