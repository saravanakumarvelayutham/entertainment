import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { selectChannels, selectFavorites } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import type { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    M3U_ON_NOW_MAX_FALLBACK,
    M3uLiveOnNowService,
} from './m3u-live-on-now.service';

const NOW = new Date(2026, 2, 12, 21, 12).getTime();

function channel(
    id: string,
    name: string,
    group = 'News',
    tvgId = ''
): Channel {
    return {
        id,
        url: `https://streams.example.test/${id}.m3u8`,
        name,
        group: { title: group },
        tvg: {
            id: tvgId,
            name: '',
            url: '',
            logo: `https://logos.example.test/${id}.png`,
            rec: '',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
    } as Channel;
}

function airing(title: string): EpgProgram {
    return {
        start: new Date(2026, 2, 12, 21, 0).toISOString(),
        stop: new Date(2026, 2, 12, 21, 30).toISOString(),
        channel: 'x',
        title,
        desc: null,
        category: null,
    };
}

describe('M3uLiveOnNowService', () => {
    const channels = [
        channel('c1', 'Aurora News', 'News', 'aurora.news'),
        channel('c2', 'Motion Sports', 'Sports'),
        channel('c3', 'Civic One', 'News'),
        ...Array.from({ length: 10 }, (_, index) =>
            channel(`s${index}`, `Sport ${index}`, 'Sports')
        ),
    ];
    let store: MockStore;
    let epgService: { getCurrentProgramsForChannels: jest.Mock };
    let activePlaylist: ReturnType<typeof signal>;
    let service: M3uLiveOnNowService;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        epgService = {
            getCurrentProgramsForChannels: jest.fn(() => of(new Map())),
        };
        activePlaylist = signal({
            title: 'Home playlist',
            epgUrls: ['https://epg.example.test/guide.xml'],
            recentlyViewed: [],
        });
        TestBed.configureTestingModule({
            providers: [
                M3uLiveOnNowService,
                provideMockStore(),
                { provide: EpgService, useValue: epgService },
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist },
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
        store = TestBed.inject(MockStore);
        store.overrideSelector(selectChannels, channels);
        store.overrideSelector(selectFavorites, []);
        service = TestBed.inject(M3uLiveOnNowService);
        service.nowMs.set(NOW);
        TestBed.tick();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function setFavorites(urls: string[]) {
        store.overrideSelector(selectFavorites, urls);
        store.refreshState();
        TestBed.tick();
    }

    it('falls back to the playlist (or the browsed group) when there are no favorites', () => {
        expect(service.source()).toBe('category');
        expect(service.sourceLabel()).toBe('Home playlist');
        expect(service.tiles().map((tile) => tile.id)).toEqual(
            channels.slice(0, M3U_ON_NOW_MAX_FALLBACK).map((c) => c.id)
        );

        service.selectedGroup.set('Sports');
        TestBed.tick();
        expect(service.sourceLabel()).toBe('Sports');
        expect(service.tiles()[0].name).toBe('Motion Sports');
        expect(service.tiles()).toHaveLength(M3U_ON_NOW_MAX_FALLBACK);
    });

    it('shows favorites by URL, in favorites order, with logo and no programme', () => {
        setFavorites([
            channels[2].url,
            'https://gone.example.test/x',
            channels[0].url,
        ]);

        expect(service.source()).toBe('favorites');
        expect(service.tiles()).toEqual([
            {
                id: 'c3',
                name: 'Civic One',
                logoUrl: 'https://logos.example.test/c3.png',
                program: null,
            },
            {
                id: 'c1',
                name: 'Aurora News',
                logoUrl: 'https://logos.example.test/c1.png',
                program: null,
            },
        ]);
    });

    it('looks the current programmes up only while active, by EPG key, scoped to the playlist sources', () => {
        setFavorites([channels[0].url, channels[1].url]);
        expect(epgService.getCurrentProgramsForChannels).not.toHaveBeenCalled();

        epgService.getCurrentProgramsForChannels.mockReturnValue(
            of(
                new Map([
                    ['aurora.news', airing('Global Window')],
                    ['Motion Sports', null],
                ])
            )
        );
        service.active.set(true);
        TestBed.tick();

        expect(epgService.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['aurora.news', 'Motion Sports'],
            { sourceUrls: ['https://epg.example.test/guide.xml'] }
        );
        const [aurora, motion] = service.tiles();
        expect(aurora.program).toEqual(
            expect.objectContaining({
                title: 'Global Window',
                progress: 40,
                minutesLeft: 18,
            })
        );
        expect(motion.program).toBeNull();
    });

    it('reports the newest recently viewed channel that still exists in the playlist', () => {
        activePlaylist.set({
            title: 'Home playlist',
            epgUrls: [],
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: channels[1].url,
                    url: channels[1].url,
                    title: 'Motion Sports',
                    category_id: 'live',
                    added_at: NOW - 86_400_000,
                },
                {
                    source: 'm3u',
                    id: 'https://gone.example.test/x',
                    url: 'https://gone.example.test/x',
                    title: 'Gone',
                    category_id: 'live',
                    added_at: NOW,
                },
                {
                    source: 'm3u',
                    id: channels[0].url,
                    url: channels[0].url,
                    title: 'Aurora',
                    category_id: 'live',
                    added_at: new Date(NOW - 12 * 60_000).toISOString(),
                },
            ],
        });
        TestBed.tick();

        expect(service.lastWatched()).toEqual({
            id: 'c1',
            name: 'Aurora News',
            logoUrl: 'https://logos.example.test/c1.png',
            watchedAtMs: NOW - 12 * 60_000,
        });
        expect(service.resolveChannel('c1')?.name).toBe('Aurora News');
        expect(service.resolveChannel('missing')).toBeNull();
    });
});
