import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore, RuntimeCapabilitiesService } from '@iptvnator/services';
import type { PortalRecentItem } from '@iptvnator/shared/interfaces';
import {
    DashboardDataService,
    DashboardGenreRecommendationsService,
    DashboardRecommendationsService,
    DashboardTasteProfileService,
    ExternalWatchHistoryService,
    RecommendationFeedbackService,
    DashboardRecommendationItem,
    DashboardTasteProfile,
    RecommendationFeedbackEntry,
} from '@iptvnator/workspace/dashboard/data-access';
import { WatchingInsightsComponent } from './watching-insights.component';
import { filterWatchingHistory } from './watching-insights.utils';

const historyItem = (
    id: number,
    type: 'movie' | 'series' | 'live' = 'movie'
): PortalRecentItem => ({
    id,
    title: `Recorded ${id}`,
    type,
    playlist_id: 'source',
    source: 'xtream',
    category_id: 7,
    xtream_id: id,
    viewed_at: new Date().toISOString(),
});
const recommendation = (id: number): DashboardRecommendationItem => ({
    tmdbId: id,
    mediaType: 'movie',
    title: `Available ${id}`,
    year: 2025,
    originalTitle: null,
    posterUrl: null,
    rating: null,
    genreIds: [9648],
    seedTitle: 'Mystery',
    match: {
        playlistId: 'source',
        playlistName: 'Library',
        type: 'movie',
        categoryId: 7,
        xtreamId: id,
    },
});
const profile: DashboardTasteProfile = {
    titles: [
        {
            key: 'movie:1',
            title: 'Recorded 1',
            mediaType: 'movie',
            tmdbId: 1,
            posterUrl: '/poster.jpg',
            backdropUrl: '/backdrop.jpg',
            year: 2025,
            genreIds: [9648],
            recent: true,
            favorite: false,
            external: false,
        },
    ],
    genres: [
        {
            key: 'movie:genre:9648',
            name: 'Mystery',
            movieId: 9648,
            score: 4,
            titleCount: 1,
        },
    ],
    totalSeeds: 1,
    resolvedSeeds: 1,
};

describe('WatchingInsightsComponent', () => {
    let fixture: ComponentFixture<WatchingInsightsComponent>;
    let recent: ReturnType<typeof signal<PortalRecentItem[]>>;
    let votes: ReturnType<typeof signal<RecommendationFeedbackEntry[]>>;
    let sources: ReturnType<typeof signal<{ _id: string }[]>>;
    let historyError: ReturnType<typeof signal<string | null>>;
    let tasteProfile: ReturnType<typeof signal<DashboardTasteProfile>>;
    let loadProfile: jest.Mock;
    let setFeedback: jest.Mock;
    let reloadHistory: jest.Mock;
    let snackbar: { open: jest.Mock };
    let metadataEnabled: ReturnType<typeof signal<boolean>>;

    beforeEach(async () => {
        recent = signal([
            historyItem(1),
            historyItem(2, 'series'),
            historyItem(3, 'live'),
        ]);
        votes = signal<RecommendationFeedbackEntry[]>([]);
        sources = signal([{ _id: 'source' }]);
        historyError = signal<string | null>(null);
        tasteProfile = signal(profile);
        loadProfile = jest.fn().mockResolvedValue(undefined);
        reloadHistory = jest.fn().mockResolvedValue(undefined);
        setFeedback = jest.fn().mockImplementation(async (item, choice) => {
            votes.set(
                choice ? [{ ...item, choice, updatedAt: '2026-10-23' }] : []
            );
        });
        snackbar = { open: jest.fn() };
        metadataEnabled = signal(true);
        globalThis.ResizeObserver = class {
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        };
        const feedback = {
            entries: votes,
            load: jest.fn().mockResolvedValue(undefined),
            setFeedback,
            choiceFor: (item: { tmdbId: number }) =>
                votes().find((v) => v.tmdbId === item.tmdbId)?.choice ?? null,
            isDismissed: (item: { tmdbId: number }) =>
                votes().some(
                    (v) => v.tmdbId === item.tmdbId && v.choice === 'not-for-me'
                ),
        };
        await TestBed.configureTestingModule({
            imports: [WatchingInsightsComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
                {
                    provide: SettingsStore,
                    useValue: { stripCountryPrefix: signal(false) },
                },
                { provide: MatSnackBar, useValue: snackbar },
                {
                    provide: DashboardDataService,
                    useValue: {
                        globalRecentItems: recent,
                        globalFavoriteItems: signal([]),
                        playlists: sources,
                        globalRecentLoaded: signal(true),
                        globalFavoritesLoaded: signal(true),
                        globalRecentError: historyError,
                        reloadGlobalRecentItems: reloadHistory,
                        reloadGlobalFavorites: jest
                            .fn()
                            .mockResolvedValue(undefined),
                        reloadPlaybackPositions: jest
                            .fn()
                            .mockResolvedValue(undefined),
                        getRecentItemLink: (item: PortalRecentItem) => [
                            '/workspace/xtreams',
                            item.playlist_id,
                            'vod',
                            '7',
                            String(item.xtream_id),
                        ],
                        getRecentItemDetailNavigationState: () => undefined,
                    },
                },
                {
                    provide: DashboardTasteProfileService,
                    useValue: {
                        profile: tasteProfile,
                        loading: signal(false),
                        error: signal(null),
                        get isAvailable() {
                            return metadataEnabled();
                        },
                        load: loadProfile,
                        key: () => JSON.stringify([recent(), votes()]),
                    },
                },
                {
                    provide: DashboardGenreRecommendationsService,
                    useValue: {
                        rails: signal([
                            {
                                genre: 'Mystery',
                                score: 4,
                                items: [recommendation(9)],
                            },
                        ]),
                        loading: signal(false),
                        load: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: DashboardRecommendationsService,
                    useValue: {
                        items: signal([recommendation(9), recommendation(10)]),
                        loading: signal(false),
                        load: jest.fn().mockResolvedValue(undefined),
                    },
                },
                { provide: RecommendationFeedbackService, useValue: feedback },
                {
                    provide: ExternalWatchHistoryService,
                    useValue: {
                        entries: signal([]),
                        load: jest.fn().mockResolvedValue(undefined),
                    },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(WatchingInsightsComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        // The constructor's independent storage promises finish outside Angular's task tracker.
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('renders observed records and correctly weighted movie/series ring without duration claims', () => {
        const dom: HTMLElement = fixture.nativeElement;
        for (const kind of ['movies', 'series', 'live']) {
            expect(
                dom
                    .querySelector(`[data-test-id="insights-history-${kind}"]`)
                    ?.textContent?.trim()
            ).toBe('1');
        }
        expect(fixture.componentInstance.stats().movieShare).toBe(50);
        expect(
            dom.querySelector('.viewing-ring')?.getAttribute('style')
        ).toContain('50%');
        expect(dom.querySelector('.history-list')?.textContent).toContain(
            'Recorded 1'
        );
        expect(dom.querySelector('.taste-hero__art')?.getAttribute('src')).toBe(
            '/backdrop.jpg'
        );
    });

    it('filters displayed activity without changing the shared taste or re-enriching', async () => {
        const calls = loadProfile.mock.calls.length;
        fixture.componentInstance.content.set('live');
        fixture.componentInstance.days.set(7);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(fixture.componentInstance.stats()).toMatchObject({
            movies: 0,
            series: 0,
            live: 1,
        });
        expect(fixture.componentInstance.genres()).toEqual([]);
        expect(fixture.componentInstance.cards()).toEqual([]);
        expect(tasteProfile()).toBe(profile);
        expect(loadProfile).toHaveBeenCalledTimes(calls);
    });

    it('deduplicates recommendation identities and routes to the verified catalog copy', () => {
        const cards = fixture.componentInstance.cards();
        expect(cards.map((card) => card.title)).toEqual([
            'Available 9',
            'Available 10',
        ]);
        expect(cards[0].link).toEqual([
            '/workspace/xtreams',
            'source',
            'vod',
            '7',
            '9',
        ]);
        sources.set([]);
        expect(fixture.componentInstance.cards()).toEqual([]);
        expect(fixture.componentInstance.history()).toEqual([]);
    });

    it('persists feedback through the existing engine boundary and immediately hides dismissed titles', async () => {
        const component = fixture.componentInstance;
        await component.onAction({
            card: component.cards()[0],
            action: { id: 'recommendation-not-for-me', icon: 'thumb_down' },
        });
        expect(setFeedback).toHaveBeenCalledWith(
            recommendation(9),
            'not-for-me'
        );
        expect(component.cards().map((card) => card.title)).toEqual([
            'Available 10',
        ]);
        await component.undoFeedback(votes()[0]);
        expect(component.cards().map((card) => card.title)).toEqual([
            'Available 9',
            'Available 10',
        ]);
    });

    it('reports a rejected feedback write without changing recommendations', async () => {
        setFeedback.mockRejectedValueOnce(new Error('storage unavailable'));
        const component = fixture.componentInstance;
        await component.onAction({
            card: component.cards()[0],
            action: { id: 'recommendation-not-for-me', icon: 'thumb_down' },
        });
        expect(component.cards()).toHaveLength(2);
        expect(snackbar.open).toHaveBeenCalledWith(
            'WORKSPACE.DASHBOARD.ACTION_FAILED',
            undefined,
            { duration: 5000 }
        );
    });

    it('renders a retryable read error instead of presenting an empty library as success', async () => {
        historyError.set('read failed');
        recent.set([]);
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[role="alert"]'
            )
        ).not.toBeNull();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[data-test-id="insights-history-movies"]'
            )
        ).toBeNull();
        expect(fixture.componentInstance.cards()).toEqual([]);
        reloadHistory.mockImplementationOnce(async () =>
            historyError.set(null)
        );
        await fixture.componentInstance.refresh();
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[role="alert"]'
            )
        ).toBeNull();
    });

    it('drops failed artwork and renders a neutral empty mix', () => {
        const component = fixture.componentInstance;
        component.markFailed('/backdrop.jpg');
        expect(component.backdrop()).toBeNull();
        recent.set([]);
        expect(component.stats().movieShare).toBe(0);
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.viewing-ring--empty'
            )
        ).not.toBeNull();
    });

    it('hides cached genres and recommendation posters immediately when metadata is disabled', () => {
        expect(fixture.componentInstance.cards()).toHaveLength(2);
        metadataEnabled.set(false);
        expect(fixture.componentInstance.cards()).toEqual([]);
        expect(fixture.componentInstance.genres()).toEqual([]);
    });
});

describe('recorded history boundaries', () => {
    it('counts repeated source identities once while preserving provider copies and movie/series collisions', () => {
        const original = historyItem(1);
        const records = [
            original,
            original,
            { ...original, playlist_id: 'another' },
            historyItem(1, 'series'),
        ];
        expect(filterWatchingHistory(records, 'all', 0)).toHaveLength(3);
    });

    it('filters latest activity dates and leaves unknown dates in available history only', () => {
        const records = [
            { ...historyItem(1), viewed_at: '2026-10-22T12:00:00Z' },
            { ...historyItem(2), viewed_at: '2026-09-01T12:00:00Z' },
            { ...historyItem(3), viewed_at: 'unknown' },
        ];
        expect(
            filterWatchingHistory(
                records,
                'all',
                7,
                Date.parse('2026-10-23T12:00:00Z')
            ).map((item) => item.id)
        ).toEqual([1]);
        expect(filterWatchingHistory(records, 'all', 0)).toHaveLength(3);
    });
});
