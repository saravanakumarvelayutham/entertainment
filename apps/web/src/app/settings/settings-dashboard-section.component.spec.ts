import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DashboardGenreRecommendationsService,
    ExternalWatchHistoryService,
} from '@iptvnator/workspace/dashboard/data-access';
import { SettingsDashboardSectionComponent } from './settings-dashboard-section.component';

describe('SettingsDashboardSectionComponent', () => {
    let fixture: ComponentFixture<SettingsDashboardSectionComponent>;
    let importNetflix: jest.Mock;
    let loadRecommendations: jest.Mock;
    let recommendationRails: ReturnType<typeof signal>;
    let historyEntries: ReturnType<typeof signal>;
    let importedAt: ReturnType<typeof signal>;
    let recommendationsAvailable: boolean;

    const createForm = () =>
        new FormGroup({
            showDashboard: new FormControl(true),
            dashboardRails: new FormGroup({
                hero: new FormControl(true),
                continueWatching: new FormControl(true),
                liveFavorites: new FormControl(true),
                recentlyWatchedLive: new FormControl(true),
                favoriteMoviesAndSeries: new FormControl(true),
                recentSources: new FormControl(true),
                xtreamRecentlyAdded: new FormControl(true),
                tmdbTrending: new FormControl(true),
                tmdbRecommendations: new FormControl(true),
            }),
        });

    const statusText = (): string =>
        (
            fixture.nativeElement.querySelector(
                '[data-test-id="netflix-history-status"] span'
            ) as HTMLElement | null
        )?.textContent?.trim() ?? '';

    beforeEach(async () => {
        importNetflix = jest.fn();
        loadRecommendations = jest.fn().mockResolvedValue(undefined);
        recommendationRails = signal([]);
        historyEntries = signal([]);
        importedAt = signal(null);
        recommendationsAvailable = true;

        await TestBed.configureTestingModule({
            imports: [
                SettingsDashboardSectionComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: ExternalWatchHistoryService,
                    useValue: {
                        entries: historyEntries,
                        importedAt,
                        load: jest.fn().mockResolvedValue(undefined),
                        importNetflix,
                    },
                },
                {
                    provide: DashboardGenreRecommendationsService,
                    useValue: {
                        get isAvailable() {
                            return recommendationsAvailable;
                        },
                        rails: recommendationRails,
                        load: loadRecommendations,
                    },
                },
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                SETTINGS: {
                    NETFLIX_HISTORY_PREVIOUS:
                        'Last import: {{imported}} Netflix entries on {{date}}.',
                    NETFLIX_HISTORY_IMPORTING: 'Importing…',
                    NETFLIX_HISTORY_CANCELLED: 'Import cancelled.',
                    NETFLIX_HISTORY_FAILED: 'Import failed.',
                    NETFLIX_HISTORY_SUCCESS_UPDATED:
                        'Imported {{imported}}; skipped {{skipped}}. Your Picks were recalculated: {{genres}}.',
                    NETFLIX_HISTORY_SUCCESS_NO_PICKS:
                        'Imported {{imported}}, but no new Your Picks matched.',
                    NETFLIX_HISTORY_SUCCESS_UNAVAILABLE:
                        'Imported {{imported}}; recommendations unavailable.',
                },
            },
            true
        );
        translate.use('en');

        fixture = TestBed.createComponent(SettingsDashboardSectionComponent);
        fixture.componentRef.setInput('form', createForm());
        fixture.detectChanges();
    });

    it('keeps the previous successful import visible after reopening settings', () => {
        historyEntries.set([
            { title: 'Arrival', watchedAt: '2026-09-14T12:00:00.000Z' },
            { title: 'Dark', watchedAt: '2026-09-13T12:00:00.000Z' },
        ]);
        importedAt.set('2026-09-15T12:00:00.000Z');
        fixture.detectChanges();

        expect(statusText()).toContain('Last import: 2 Netflix entries');
    });

    it('reports success and the genres recalculated for Your Picks', async () => {
        importNetflix.mockResolvedValue({ imported: 42, skipped: 3 });
        recommendationRails.set([
            { genre: 'Drama', score: 10, items: [] },
            { genre: 'Comedy', score: 8, items: [] },
        ]);

        await fixture.componentInstance.importNetflixHistory();
        fixture.detectChanges();

        expect(loadRecommendations).toHaveBeenCalledTimes(1);
        expect(statusText()).toContain('Imported 42; skipped 3');
        expect(statusText()).toContain(
            'Your Picks were recalculated: Drama, Comedy'
        );
    });

    it('reports a cancelled import without claiming anything changed', async () => {
        importNetflix.mockResolvedValue(null);

        await fixture.componentInstance.importNetflixHistory();
        fixture.detectChanges();

        expect(statusText()).toBe('Import cancelled.');
        expect(loadRecommendations).not.toHaveBeenCalled();
    });

    it('reports a failed import', async () => {
        importNetflix.mockRejectedValue(new Error('bad csv'));

        await fixture.componentInstance.importNetflixHistory();
        fixture.detectChanges();

        expect(statusText()).toBe('Import failed.');
    });
});
