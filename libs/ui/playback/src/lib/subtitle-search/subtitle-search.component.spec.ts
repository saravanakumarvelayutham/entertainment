import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    SubtitleMatchService,
    type SubtitleMatch,
    type SubtitleTitleMatch,
} from '@iptvnator/services';
import { SubtitleSearchComponent } from './subtitle-search.component';
import {
    createEmptyControlsState,
    DEFAULT_PLAYER_CAPABILITIES,
} from '../player-controls/player-controls-defaults';
import type { PlayerController } from '../player-controls/player-controls.model';

describe('SubtitleSearchComponent', () => {
    const match: SubtitleTitleMatch = {
        title: 'Inception',
        year: 2010,
        imdbId: 'tt1375666',
        type: 'movie',
    };
    const release: SubtitleMatch = {
        id: 'one',
        label: 'English WEB-DL',
        release: 'Movie.WEB-DL',
        url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/123',
    };
    const file = {
        name: 'English.srt',
        format: 'srt' as const,
        content: '1\n00:00:01,000 --> 00:00:02,000\nHello',
    };
    const service = {
        searchTitles: jest.fn(),
        findEnglish: jest.fn(),
        download: jest.fn(),
    };
    const load = jest.fn();
    let fixture: ComponentFixture<SubtitleSearchComponent>;
    let component: SubtitleSearchComponent;
    let controller: PlayerController;

    beforeEach(async () => {
        jest.clearAllMocks();
        service.searchTitles.mockResolvedValue([match]);
        service.findEnglish.mockResolvedValue([release]);
        service.download.mockResolvedValue(file);
        load.mockReturnValue(true);
        controller = {
            capabilities: signal(DEFAULT_PLAYER_CAPABILITIES),
            state: signal(createEmptyControlsState()),
            commands: {} as PlayerController['commands'],
            getSubtitleTarget: () => ({ load }),
        };
        await TestBed.configureTestingModule({
            imports: [SubtitleSearchComponent, TranslateModule.forRoot()],
            providers: [{ provide: SubtitleMatchService, useValue: service }],
        }).compileComponents();
        fixture = TestBed.createComponent(SubtitleSearchComponent);
        fixture.componentRef.setInput('controller', controller);
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Inception (2010)',
        });
        fixture.detectChanges();
        component = fixture.componentInstance;
    });
    afterEach(() => fixture.destroy());

    it('contacts no provider until explicit search, then resolves the title without downloading an arbitrary release', async () => {
        expect(service.searchTitles).not.toHaveBeenCalled();
        component.expanded.set(true);
        await component.search();
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="subtitle-search-title"]'
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelectorAll(
                '[data-test-id="subtitle-search-result"]'
            )
        ).toHaveLength(1);
        expect(service.searchTitles).toHaveBeenCalledWith(
            { title: 'Inception', type: 'movie', year: 2010 },
            expect.any(AbortSignal)
        );
        expect(service.findEnglish).toHaveBeenCalledWith(
            match,
            expect.objectContaining({ year: 2010 }),
            expect.any(AbortSignal)
        );
        expect(component.subtitles()).toEqual([release]);
        expect(service.download).not.toHaveBeenCalled();
        await component.load(release);
        expect(load).toHaveBeenCalledWith(file);
        expect(component.message()).toBe('LOADED');
    });

    it('requires the user to choose an ambiguous title', async () => {
        service.searchTitles.mockResolvedValueOnce([
            match,
            { ...match, imdbId: 'tt9999999' },
        ]);
        await component.search();
        expect(service.findEnglish).not.toHaveBeenCalled();
        await component.chooseTitle(match);
        expect(service.findEnglish).toHaveBeenCalledTimes(1);
    });

    it('searches the series IMDb plus current season and episode', async () => {
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Breaking Bad',
            secondary: 'S02E03',
        });
        fixture.detectChanges();
        service.searchTitles.mockResolvedValueOnce([
            { ...match, title: 'Breaking Bad', year: 2008, type: 'series' },
        ]);
        await component.search();
        expect(service.findEnglish).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'series' }),
            { title: 'Breaking Bad', type: 'series', season: 2, episode: 3 },
            expect.any(AbortSignal)
        );
    });

    it('blocks provider URLs and malformed episode numbers before making requests', async () => {
        component.title.set('https://host/movie/user/password/123');
        await component.search();
        expect(service.searchTitles).not.toHaveBeenCalled();
        component.title.set('Movie');
        component.type.set('series');
        component.episode.set('0');
        await component.search();
        expect(service.searchTitles).not.toHaveBeenCalled();
        expect(component.message()).toBe('INVALID');
    });

    it('shows empty subtitle and network failure states for retry', async () => {
        service.findEnglish.mockResolvedValueOnce([]);
        await component.search();
        expect(component.message()).toBe('NO_SUBTITLES');
        service.searchTitles.mockRejectedValueOnce(new Error('Offline'));
        await component.search();
        expect(component.message()).toBe('ERROR');
        expect(component.busy()).toBe(false);
    });

    it('does not attach a late download after the panel is destroyed or the media changes', async () => {
        let resolve!: (value: typeof file) => void;
        service.download.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        await component.search();
        const pending = component.load(release);
        fixture.componentRef.setInput('mediaTitle', { primary: 'Next movie' });
        fixture.detectChanges();
        resolve(file);
        await pending;
        expect(load).not.toHaveBeenCalled();
        expect(component.title()).toBe('Next movie');
    });

    it('reports stale engine targets and invalid downloaded cues instead of claiming success', async () => {
        load.mockReturnValue(false);
        await component.search();
        await component.load(release);
        expect(component.message()).toBe('SOURCE_CHANGED');
    });
});
