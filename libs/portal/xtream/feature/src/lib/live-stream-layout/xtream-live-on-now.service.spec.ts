import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
    EpgQueueService,
    FavoritesService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import type { EpgItem } from '@iptvnator/shared/interfaces';
import { XtreamFavoriteMarksService } from '../portal-channels-list/xtream-favorite-marks.service';
import {
    XTREAM_ON_NOW_MAX_CATEGORY,
    XtreamLiveOnNowService,
} from './xtream-live-on-now.service';

const PLAYLIST = {
    id: 'playlist-1',
    serverUrl: 'http://panel.example.test',
    username: 'user',
    password: 'pass',
};
const NOW = new Date(2026, 2, 12, 21, 12).getTime();

function live(
    xtreamId: number,
    name: string,
    epgChannelId = `epg-${xtreamId}`
) {
    return {
        xtream_id: xtreamId,
        title: name,
        stream_icon: `https://logos.example.test/${xtreamId}.png`,
        category_id: 7,
        epg_channel_id: epgChannelId,
    };
}

function airing(title: string): EpgItem {
    const start = new Date(2026, 2, 12, 21, 0).getTime();
    const stop = new Date(2026, 2, 12, 21, 30).getTime();
    return {
        title,
        start: new Date(start).toISOString(),
        end: new Date(stop).toISOString(),
        start_timestamp: String(Math.floor(start / 1000)),
        stop_timestamp: String(Math.floor(stop / 1000)),
    } as unknown as EpgItem;
}

describe('XtreamLiveOnNowService', () => {
    const streams = [
        live(11, 'Aurora News'),
        live(12, 'Motion Sports'),
        live(13, 'Civic One'),
        ...Array.from({ length: 10 }, (_, index) =>
            live(100 + index, `Channel ${index}`)
        ),
    ];
    let xtreamStore: {
        currentPlaylist: ReturnType<typeof signal>;
        liveStreams: ReturnType<typeof signal>;
        selectItemsFromSelectedCategory: ReturnType<typeof signal>;
        recentItems: ReturnType<typeof signal>;
        loadRecentItems: jest.Mock;
    };
    let favorites$: Subject<unknown[]>;
    let epgResult$: Subject<{ streamId: number; items: EpgItem[] }>;
    let favoriteChanges$: Subject<unknown>;
    let epgQueue: {
        getCached: jest.Mock;
        enqueue: jest.Mock;
        epgResult$: Subject<unknown>;
    };
    let service: XtreamLiveOnNowService;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        xtreamStore = {
            currentPlaylist: signal(PLAYLIST),
            liveStreams: signal(streams),
            selectItemsFromSelectedCategory: signal(streams),
            recentItems: signal([]),
            loadRecentItems: jest.fn(),
        };
        favorites$ = new Subject();
        epgResult$ = new Subject();
        favoriteChanges$ = new Subject();
        epgQueue = {
            getCached: jest.fn(() => null),
            enqueue: jest.fn(() => Promise.resolve()),
            epgResult$,
        };
        TestBed.configureTestingModule({
            providers: [
                XtreamLiveOnNowService,
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: jest.fn(() => favorites$) },
                },
                {
                    provide: XtreamFavoriteMarksService,
                    useValue: { changes$: favoriteChanges$ },
                },
                { provide: EpgQueueService, useValue: epgQueue },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpg: true },
                },
            ],
        });
        service = TestBed.inject(XtreamLiveOnNowService);
        service.nowMs.set(NOW);
        TestBed.tick();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function emitFavorites(ids: number[]) {
        favorites$.next(
            ids.map((id) => ({
                xtream_id: id,
                type: 'live',
                playlist_id: PLAYLIST.id,
            }))
        );
        TestBed.tick();
    }

    it('loads the playlist favorites and recent items once per playlist', () => {
        expect(xtreamStore.loadRecentItems).toHaveBeenCalledWith({
            id: PLAYLIST.id,
        });
        expect(service.source()).toBe('category');
        expect(service.tiles().map((tile) => tile.id)).toEqual(
            streams
                .slice(0, XTREAM_ON_NOW_MAX_CATEGORY)
                .map((s) => String(s.xtream_id))
        );
    });

    it('prefers favorite live channels, in favorites order, over the category', () => {
        favorites$.next([
            { xtream_id: 13, type: 'live' },
            { xtream_id: 999, type: 'movie' },
            { xtream_id: 11, type: 'live' },
        ]);
        TestBed.tick();

        expect(service.source()).toBe('favorites');
        expect(service.tiles().map((tile) => tile.name)).toEqual([
            'Civic One',
            'Aurora News',
        ]);
        expect(service.tiles()[0]).toEqual(
            expect.objectContaining({
                id: '13',
                logoUrl: 'https://logos.example.test/13.png',
                program: null,
            })
        );
    });

    it('only asks the EPG queue while the stage is active, and maps its answers', () => {
        emitFavorites([11, 12]);
        expect(epgQueue.enqueue).not.toHaveBeenCalled();

        service.active.set(true);
        TestBed.tick();

        expect(epgQueue.enqueue).toHaveBeenCalledWith(
            [
                {
                    streamId: 11,
                    epgChannelId: 'epg-11',
                    playlistId: PLAYLIST.id,
                },
                {
                    streamId: 12,
                    epgChannelId: 'epg-12',
                    playlistId: PLAYLIST.id,
                },
            ],
            new Set([11, 12]),
            expect.objectContaining({ username: 'user', password: 'pass' })
        );

        epgResult$.next({ streamId: 12, items: [airing('Harbor Derby')] });
        // Results for channels the stage does not show are ignored.
        epgResult$.next({ streamId: 13, items: [airing('Elsewhere')] });
        TestBed.tick();

        const [aurora, motion] = service.tiles();
        expect(aurora.program).toBeNull();
        expect(motion.program).toEqual(
            expect.objectContaining({
                title: 'Harbor Derby',
                timeRange: '21:00 – 21:30',
                minutesLeft: 18,
                progress: 40,
            })
        );
    });

    it('uses cached EPG answers without re-enqueueing them', () => {
        epgQueue.getCached.mockImplementation((id: number) =>
            id === 11 ? [airing('Global Window')] : null
        );
        emitFavorites([11, 12]);
        service.active.set(true);
        TestBed.tick();

        expect(epgQueue.enqueue).toHaveBeenCalledWith(
            [{ streamId: 12, epgChannelId: 'epg-12', playlistId: PLAYLIST.id }],
            new Set([11, 12]),
            expect.anything()
        );
        expect(service.tiles()[0].program?.title).toBe('Global Window');
    });

    it('follows heart toggles from the channel lists', () => {
        emitFavorites([11]);
        favoriteChanges$.next({
            playlistId: PLAYLIST.id,
            key: 'live:12',
            isFavorite: true,
        });
        favoriteChanges$.next({
            playlistId: PLAYLIST.id,
            key: 'movie:5',
            isFavorite: true,
        });
        favoriteChanges$.next({
            playlistId: 'other',
            key: 'live:13',
            isFavorite: true,
        });
        TestBed.tick();
        expect(service.tiles().map((tile) => tile.id)).toEqual(['11', '12']);

        favoriteChanges$.next({
            playlistId: PLAYLIST.id,
            key: 'live:11',
            isFavorite: false,
        });
        TestBed.tick();
        expect(service.tiles().map((tile) => tile.id)).toEqual(['12']);
    });

    it('reports the newest live channel watched on this playlist', () => {
        xtreamStore.recentItems.set([
            {
                type: 'live',
                playlist_id: PLAYLIST.id,
                xtream_id: 12,
                title: 'Old',
                viewed_at: '2026-03-11 09:00:00',
            },
            {
                type: 'movie',
                playlist_id: PLAYLIST.id,
                xtream_id: 50,
                title: 'Film',
                viewed_at: '2026-03-12 20:00:00',
            },
            {
                type: 'live',
                playlist_id: 'other',
                xtream_id: 13,
                title: 'Other',
                viewed_at: '2026-03-12 20:30:00',
            },
            {
                type: 'live',
                playlist_id: PLAYLIST.id,
                xtream_id: 11,
                title: 'Stored name',
                viewed_at: '2026-03-12 19:04:00',
            },
        ]);
        TestBed.tick();

        expect(service.lastWatched()).toEqual({
            id: '11',
            name: 'Aurora News',
            logoUrl: 'https://logos.example.test/11.png',
            watchedAtMs: Date.parse('2026-03-12T19:04:00Z'),
        });
    });

    it('resolves stage ids to catalog channels', () => {
        emitFavorites([11]);
        expect(service.resolveChannel('11')?.title).toBe('Aurora News');
        expect(service.resolveChannel('13')?.title).toBe('Civic One');
        expect(service.resolveChannel('42')).toBeNull();
        expect(
            service.displayedChannels().map((item) => item.xtream_id)
        ).toEqual([11]);
    });
});
