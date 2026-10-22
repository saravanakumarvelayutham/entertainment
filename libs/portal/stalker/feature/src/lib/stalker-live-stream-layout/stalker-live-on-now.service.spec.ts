import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import type { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    STALKER_ON_NOW_MAX_CATEGORY,
    StalkerLiveOnNowService,
} from './stalker-live-on-now.service';

const NOW = new Date(2026, 2, 12, 21, 12).getTime();
const START = new Date(2026, 2, 12, 21, 0);
const STOP = new Date(2026, 2, 12, 21, 30);

function channel(id: number, name: string) {
    return {
        id,
        cmd: `ffmpeg http://portal.example.test/${id}`,
        name,
        logo: `https://logos.example.test/${id}.png`,
    };
}

function program(title: string): EpgProgram {
    return {
        start: START.toISOString(),
        stop: STOP.toISOString(),
        channel: 'x',
        title,
        desc: null,
        category: null,
    };
}

function epgItem(title: string): EpgItem {
    return {
        title,
        start: START.toISOString(),
        end: STOP.toISOString(),
        start_timestamp: String(Math.floor(START.getTime() / 1000)),
        stop_timestamp: String(Math.floor(STOP.getTime() / 1000)),
    } as unknown as EpgItem;
}

describe('StalkerLiveOnNowService', () => {
    const categoryRows = Array.from({ length: 10 }, (_, index) =>
        channel(200 + index, `Row ${index}`)
    );
    const fullList = [
        channel(1, 'Aurora News'),
        channel(2, 'Motion Sports'),
        ...categoryRows,
    ];
    let store: {
        currentPlaylist: ReturnType<typeof signal>;
        itvChannels: ReturnType<typeof signal>;
        itvFullChannelList: ReturnType<typeof signal>;
        bulkItvEpgByChannel: ReturnType<typeof signal>;
        bulkItvEpgLoaded: ReturnType<typeof signal>;
        hasItvEpgMappingOverride: jest.Mock;
        fetchChannelEpg: jest.Mock;
    };
    let favorites: unknown[];
    let recent: unknown[];
    let service: StalkerLiveOnNowService;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        store = {
            currentPlaylist: signal({ _id: 'portal-1' }),
            itvChannels: signal(categoryRows),
            itvFullChannelList: signal(fullList),
            bulkItvEpgByChannel: signal({}),
            bulkItvEpgLoaded: signal(true),
            hasItvEpgMappingOverride: jest.fn(() => false),
            fetchChannelEpg: jest.fn(async () => []),
        };
        favorites = [];
        recent = [];
        TestBed.configureTestingModule({
            providers: [
                StalkerLiveOnNowService,
                { provide: StalkerStore, useValue: store },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPortalFavorites: jest.fn(() => of(favorites)),
                        getPortalRecentlyViewed: jest.fn(() => of(recent)),
                    },
                },
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
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function create(): StalkerLiveOnNowService {
        service = TestBed.inject(StalkerLiveOnNowService);
        service.nowMs.set(NOW);
        TestBed.tick();
        return service;
    }

    it('falls back to the selected category rows when the portal has no ITV favorites', () => {
        favorites = [{ id: 'vod-1', category_id: 'vod', cmd: 'x' }];
        create();

        expect(service.source()).toBe('category');
        expect(service.tiles()).toHaveLength(STALKER_ON_NOW_MAX_CATEGORY);
        expect(service.tiles()[0]).toEqual({
            id: '200',
            name: 'Row 0',
            logoUrl: 'https://logos.example.test/200.png',
            program: null,
        });
    });

    it('shows ITV favorites with the bulk guide programme, radio favorites excluded', () => {
        favorites = [
            { id: 2, category_id: 'itv', cmd: 'x' },
            { id: 2, category_id: 'radio', cmd: 'x' },
            { id: 1, cmd: 'legacy row without category' },
        ];
        store.bulkItvEpgByChannel.set({ '2': [program('Harbor Derby')] });
        create();

        expect(service.source()).toBe('favorites');
        expect(service.tiles().map((tile) => tile.name)).toEqual([
            'Motion Sports',
            'Aurora News',
        ]);
        expect(service.tiles()[0].program).toEqual(
            expect.objectContaining({ title: 'Harbor Derby', progress: 40 })
        );
    });

    it('fetches the short EPG for tiles the bulk guide cannot answer, only while active', async () => {
        favorites = [{ id: 1, category_id: 'itv', cmd: 'x' }];
        store.fetchChannelEpg.mockResolvedValue([epgItem('Global Window')]);
        create();
        expect(store.fetchChannelEpg).not.toHaveBeenCalled();

        service.active.set(true);
        TestBed.tick();
        await jest.advanceTimersByTimeAsync(1_000);
        TestBed.tick();

        expect(store.fetchChannelEpg).toHaveBeenCalledWith(
            '1',
            expect.any(Number)
        );
        expect(service.tiles()[0].program?.title).toBe('Global Window');
    });

    it('never falls back for a manually mapped channel', async () => {
        favorites = [{ id: 1, category_id: 'itv', cmd: 'x' }];
        store.hasItvEpgMappingOverride.mockReturnValue(true);
        create();
        service.active.set(true);
        TestBed.tick();
        await jest.advanceTimersByTimeAsync(1_000);

        expect(store.fetchChannelEpg).not.toHaveBeenCalled();
    });

    it('reports the newest ITV channel watched on this portal', () => {
        recent = [
            {
                id: 2,
                category_id: 'itv',
                cmd: 'x',
                title: 'Older',
                added_at: NOW - 86_400_000,
            },
            {
                id: 77,
                category_id: 'vod',
                cmd: 'x',
                title: 'Film',
                added_at: NOW,
            },
            {
                id: 1,
                category_id: 'itv',
                cmd: 'x',
                title: 'Stored',
                added_at: NOW - 12 * 60_000,
            },
        ];
        create();

        expect(service.lastWatched()).toEqual({
            id: '1',
            name: 'Aurora News',
            logoUrl: 'https://logos.example.test/1.png',
            watchedAtMs: NOW - 12 * 60_000,
        });
    });

    it('keeps the tiles in step with heart toggles and resolves stage ids to playable rows', () => {
        favorites = [
            {
                id: 9,
                category_id: 'itv',
                cmd: 'ffmpeg http://x/9',
                name: 'Gone from catalog',
            },
        ];
        create();

        // A favorite missing from the catalog is still playable from its row.
        expect(service.tiles().map((tile) => tile.name)).toEqual([
            'Gone from catalog',
        ]);
        expect(service.resolveChannel('9')?.cmd).toBe('ffmpeg http://x/9');

        service.setFavorite(fullList[0], true);
        TestBed.tick();
        expect(service.tiles().map((tile) => tile.id)).toEqual(['9', '1']);

        service.setFavorite(fullList[0], false);
        service.setFavorite({ ...fullList[1], id: 9 }, false);
        TestBed.tick();
        expect(service.source()).toBe('category');
        expect(service.resolveChannel('201')?.name).toBe('Row 1');
        expect(service.resolveChannel('404')).toBeNull();
    });
});
