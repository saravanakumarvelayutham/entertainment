import { CommonModule } from '@angular/common';
import {
    Component,
    computed,
    inject,
    input,
    signal,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import {
    DashboardGenreRecommendationsService,
    ExternalWatchHistoryService,
} from '@iptvnator/workspace/dashboard/data-access';

interface NetflixImportStatus {
    readonly icon: string;
    readonly key: string;
    readonly params?: Record<string, string | number>;
    readonly tone: 'info' | 'success' | 'error';
}

@Component({
    selector: 'app-settings-dashboard-section',
    imports: [
        CommonModule,
        MatCheckboxModule,
        MatButtonModule,
        MatIconModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-dashboard-section.component.html',
    styleUrl: './settings-dashboard-section.component.scss',
    encapsulation: ViewEncapsulation.None,
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class SettingsDashboardSectionComponent {
    private readonly externalHistory = inject(ExternalWatchHistoryService);
    private readonly genreRecommendations = inject(
        DashboardGenreRecommendationsService
    );
    readonly form = input.required<FormGroup>();
    readonly importBusy = signal(false);
    private readonly importOutcome = signal<NetflixImportStatus | null>(null);
    readonly importStatus = computed<NetflixImportStatus | null>(() => {
        const outcome = this.importOutcome();
        if (outcome) return outcome;

        const importedAt = this.externalHistory.importedAt();
        if (!importedAt) return null;
        return {
            icon: 'history',
            key: 'SETTINGS.NETFLIX_HISTORY_PREVIOUS',
            params: {
                imported: this.externalHistory.entries().length,
                date: new Date(importedAt).toLocaleString(),
            },
            tone: 'info',
        };
    });

    constructor() {
        void this.externalHistory.load().catch(() => undefined);
    }

    async importNetflixHistory(): Promise<void> {
        this.importBusy.set(true);
        this.importOutcome.set({
            icon: 'hourglass_top',
            key: 'SETTINGS.NETFLIX_HISTORY_IMPORTING',
            tone: 'info',
        });
        try {
            const result = await this.externalHistory.importNetflix();
            if (!result) {
                this.importOutcome.set({
                    icon: 'info',
                    key: 'SETTINGS.NETFLIX_HISTORY_CANCELLED',
                    tone: 'info',
                });
                return;
            }

            await this.genreRecommendations.load();
            const genres = this.genreRecommendations
                .rails()
                .map((rail) => rail.genre)
                .join(', ');
            const params = {
                imported: result.imported,
                skipped: result.skipped,
                genres,
            };
            this.importOutcome.set({
                icon: 'check_circle',
                key: genres
                    ? 'SETTINGS.NETFLIX_HISTORY_SUCCESS_UPDATED'
                    : this.genreRecommendations.isAvailable
                      ? 'SETTINGS.NETFLIX_HISTORY_SUCCESS_NO_PICKS'
                      : 'SETTINGS.NETFLIX_HISTORY_SUCCESS_UNAVAILABLE',
                params,
                tone: 'success',
            });
        } catch {
            this.importOutcome.set({
                icon: 'error',
                key: 'SETTINGS.NETFLIX_HISTORY_FAILED',
                tone: 'error',
            });
        } finally {
            this.importBusy.set(false);
        }
    }
}
