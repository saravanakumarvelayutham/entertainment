import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
    SettingsStore,
    SubtitleMatchService,
    type SubtitleMatch,
} from '@iptvnator/services';
import { AutoEnglishSubtitlesComponent } from './auto-english-subtitles.component';
import {
    createEmptyControlsState,
    DEFAULT_PLAYER_CAPABILITIES,
} from '../player-controls/player-controls-defaults';
import type { PlayerController } from '../player-controls/player-controls.model';

describe('automatic English subtitles', () => {
    const good: SubtitleMatch = {
        id: 'good',
        release: 'Movie.2020.1080p.WEB-DL-GROUP',
        label: 'Good',
        url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/2',
    };
    const bad: SubtitleMatch = {
        ...good,
        id: 'cam',
        release: 'Movie.2020.HDCAM',
        label: 'CAM',
    };
    const file = {
        name: 'English.srt',
        format: 'srt' as const,
        content: '1\n00:00:01,000 --> 00:00:05,000\nHello',
    };
    const enabled = signal(true);
    const state = signal(createEmptyControlsState());
    const source = signal('one');
    const service = {
        searchTitles: jest.fn(),
        findEnglish: jest.fn(),
        download: jest.fn(),
    };
    const load = jest.fn();
    let fixture: ComponentFixture<AutoEnglishSubtitlesComponent>;
    let controller: PlayerController;
    const settle = async () => {
        await fixture.whenStable();
        for (let index = 0; index < 12; index++) await Promise.resolve();
        fixture.detectChanges();
        await fixture.whenStable();
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        enabled.set(true);
        source.set('one');
        state.set({
            ...createEmptyControlsState(),
            isLive: false,
            status: 'playing',
        });
        service.searchTitles.mockResolvedValue([
            { imdbId: 'tt1234567', title: 'Movie', year: 2020, type: 'movie' },
        ]);
        service.findEnglish.mockResolvedValue([bad, good]);
        service.download.mockResolvedValue(file);
        load.mockReturnValue(true);
        controller = {
            state,
            capabilities: signal({
                ...DEFAULT_PLAYER_CAPABILITIES,
                externalSubtitles: true,
            }),
            commands: {
                setSubtitleTrack: jest.fn(() =>
                    state.update((value) => ({
                        ...value,
                        subtitlesEnabled: false,
                    }))
                ),
            } as unknown as PlayerController['commands'],
            getSubtitleTarget: () => {
                const key = source();
                return { key, load: (data) => source() === key && load(data) };
            },
        };
        await TestBed.configureTestingModule({
            imports: [AutoEnglishSubtitlesComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { autoEnglishSubtitles: enabled },
                },
                { provide: SubtitleMatchService, useValue: service },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(AutoEnglishSubtitlesComponent);
        fixture.componentRef.setInput('controller', controller);
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Movie (2020)',
        });
    });
    afterEach(() => fixture.destroy());

    it('loads the best English release on playback without opening a menu', async () => {
        fixture.detectChanges();
        await settle();
        expect(service.download).toHaveBeenCalledWith(
            good,
            expect.any(AbortSignal)
        );
        expect(load).toHaveBeenCalledWith(file);
        expect(fixture.componentInstance.status()).toBe('LOADED');
        state.update((value) => ({ ...value, positionSeconds: 15 }));
        await settle();
        expect(service.searchTitles).toHaveBeenCalledTimes(1);
    });

    it.each(['live', 'disabled', 'loading', 'selected'])(
        'does not download while %s',
        async (reason) => {
            if (reason === 'live')
                state.update((value) => ({ ...value, isLive: true }));
            if (reason === 'disabled') enabled.set(false);
            if (reason === 'loading')
                state.update((value) => ({ ...value, status: 'loading' }));
            if (reason === 'selected')
                state.update((value) => ({ ...value, subtitlesEnabled: true }));
            fixture.detectChanges();
            await settle();
            expect(service.searchTitles).not.toHaveBeenCalled();
        }
    );

    it('explicit On retries after manual Off while paused even with startup automation disabled', async () => {
        enabled.set(false);
        state.update((value) => ({ ...value, status: 'paused' }));
        fixture.detectChanges();
        await settle();
        fixture.componentInstance.override();
        fixture.componentInstance.enable();
        await settle();
        expect(load).toHaveBeenCalledWith(file);
        expect(service.download).toHaveBeenCalledWith(
            good,
            expect.any(AbortSignal)
        );
        expect(fixture.componentInstance.status()).toBe('LOADED');
        expect(enabled()).toBe(false);
    });

    it('keeps an explicit request alive across playback ticks when startup matching is disabled', async () => {
        enabled.set(false);
        let resolveTitles!: (value: unknown[]) => void;
        service.searchTitles.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveTitles = resolve;
            })
        );
        fixture.detectChanges();
        await settle();
        fixture.componentInstance.enable();
        state.update((value) => ({ ...value, positionSeconds: 10 }));
        await settle();
        expect(fixture.componentInstance.status()).toBe('SEARCHING');
        resolveTitles([
            { imdbId: 'tt1234567', title: 'Movie', year: 2020, type: 'movie' },
        ]);
        await settle();
        expect(load).toHaveBeenCalledWith(file);
        source.set('next');
        state.update((value) => ({ ...value, positionSeconds: 0 }));
        await settle();
        expect(service.searchTitles).toHaveBeenCalledTimes(1);
    });

    it('explicit On retries a previous failed automatic lookup', async () => {
        service.searchTitles.mockRejectedValueOnce(new Error('offline'));
        fixture.detectChanges();
        await settle();
        expect(fixture.componentInstance.status()).toBe('ERROR');
        fixture.componentInstance.enable();
        await settle();
        expect(load).toHaveBeenCalledWith(file);
        expect(fixture.componentInstance.status()).toBe('LOADED');
    });

    it('starts after playback readiness and respects preference changes', async () => {
        enabled.set(false);
        fixture.detectChanges();
        await settle();
        enabled.set(true);
        await settle();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('keeps manual Off for this source and searches again for the next source', async () => {
        fixture.detectChanges();
        await settle();
        fixture.componentInstance.override();
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Movie (2020)',
            secondary: 'Updated display details',
        });
        state.update((value) => ({ ...value, positionSeconds: 20 }));
        await settle();
        expect(service.download).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.status()).toBe('MANUAL');
        source.set('two');
        await settle();
        expect(service.download).toHaveBeenCalledTimes(2);
    });

    it('never applies a download after a manual choice or destruction', async () => {
        let resolve!: (value: typeof file) => void;
        service.download.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        fixture.detectChanges();
        await settle();
        fixture.componentInstance.override();
        resolve(file);
        await settle();
        expect(load).not.toHaveBeenCalled();
    });

    it('cancels stale source work and uses the new episode identity', async () => {
        let resolve!: (value: typeof file) => void;
        service.download.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        fixture.detectChanges();
        await settle();
        source.set('episode-two');
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Show',
            secondary: 'S02E03',
        });
        service.searchTitles.mockResolvedValue([
            { imdbId: 'tt7654321', title: 'Show', type: 'series', year: 2020 },
        ]);
        await settle();
        resolve(file);
        await settle();
        expect(service.findEnglish).toHaveBeenLastCalledWith(
            expect.objectContaining({ imdbId: 'tt7654321' }),
            { title: 'Show', type: 'series', season: 2, episode: 3 },
            expect.any(AbortSignal)
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('retries with the page year when it arrives after an ambiguous bare title', async () => {
        fixture.componentRef.setInput('mediaTitle', { primary: 'Weapons' });
        const weapons = {
            imdbId: 'tt26581740',
            title: 'Weapons',
            year: 2025,
            type: 'movie',
        };
        service.searchTitles.mockResolvedValue([
            weapons,
            {
                imdbId: 'tt0497470',
                title: 'Weapons',
                year: 2007,
                type: 'movie',
            },
        ]);
        fixture.detectChanges();
        await settle();
        expect(fixture.componentInstance.status()).toBe('NO_MATCH');
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Weapons',
            year: 2025,
        });
        await settle();
        expect(service.findEnglish).toHaveBeenCalledWith(
            weapons,
            { title: 'Weapons', type: 'movie', year: 2025 },
            expect.any(AbortSignal)
        );
        expect(load).toHaveBeenCalledWith(file);
        expect(fixture.componentInstance.status()).toBe('LOADED');
    });

    it('does not guess an ambiguous remake or a series with missing episode details', async () => {
        service.searchTitles.mockResolvedValue([
            { imdbId: 'tt1234567', title: 'Movie', year: 2020, type: 'movie' },
            { imdbId: 'tt7654321', title: 'Movie', year: 2020, type: 'movie' },
        ]);
        fixture.detectChanges();
        await settle();
        expect(service.findEnglish).not.toHaveBeenCalled();
        source.set('series');
        fixture.componentRef.setInput('mediaTitle', { primary: 'Show' });
        state.update((value) => ({ ...value, canNextEpisode: true }));
        await settle();
        expect(service.searchTitles).toHaveBeenCalledTimes(1);
    });

    it('tries a bounded alternative when the best release download fails', async () => {
        service.download.mockRejectedValueOnce(new Error('Gone'));
        fixture.detectChanges();
        await settle();
        expect(service.download).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('does not repeatedly contact an unavailable service on playback ticks', async () => {
        service.searchTitles.mockRejectedValueOnce(new Error('Offline'));
        fixture.detectChanges();
        await settle();
        state.update((value) => ({ ...value, positionSeconds: 10 }));
        await settle();
        expect(service.searchTitles).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.status()).toBe('ERROR');
    });
});
