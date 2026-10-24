import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    DashboardDataService,
    DashboardGenreRecommendationsService,
    DashboardRecommendationsService,
    DashboardRecommendationItem,
    DashboardTasteProfileService,
    ExternalWatchHistoryService,
    RecommendationFeedbackService,
    DashboardTasteGenre,
} from '@iptvnator/workspace/dashboard/data-access';
import {
    DashboardRailComponent,
    DashboardRailActionSelection,
} from '../rails/dashboard-rail.component';
import {
    filterWatchingHistory,
    insightRecommendationCard,
    InsightsContent,
} from './watching-insights.utils';

@Component({
    selector: 'lib-watching-insights',
    imports: [
        DecimalPipe,
        MatButtonModule,
        MatIcon,
        RouterLink,
        TranslatePipe,
        DashboardRailComponent,
    ],
    templateUrl: './watching-insights.component.html',
    styleUrl: './watching-insights.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchingInsightsComponent {
    readonly data = inject(DashboardDataService);
    readonly taste = inject(DashboardTasteProfileService);
    readonly genreRecommendations = inject(
        DashboardGenreRecommendationsService
    );
    readonly watchedRecommendations = inject(DashboardRecommendationsService);
    readonly feedback = inject(RecommendationFeedbackService);
    readonly external = inject(ExternalWatchHistoryService);
    private readonly translate = inject(TranslateService);
    private readonly snack = inject(MatSnackBar);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    readonly content = signal<InsightsContent>('all');
    readonly days = signal(0);
    readonly selectedGenre = signal<string | null>(null);
    readonly refreshError = signal(false);
    readonly refreshing = signal(false);
    readonly failedImages = signal<ReadonlySet<string>>(new Set());
    readonly history = computed(() =>
        filterWatchingHistory(
            this.data
                .globalRecentItems()
                .filter((item) =>
                    this.data
                        .playlists()
                        .some((source) => source._id === item.playlist_id)
                ),
            this.content(),
            this.days()
        )
    );
    readonly stats = computed(() => {
        const records = this.history();
        const movies = records.filter((item) => item.type === 'movie').length;
        const series = records.filter((item) => item.type === 'series').length;
        const live = records.filter((item) => item.type === 'live').length;
        return {
            movies,
            series,
            live,
            total: records.length,
            movieShare:
                movies + series ? (movies / (movies + series)) * 100 : 0,
        };
    });
    readonly genres = computed(() =>
        !this.taste.isAvailable || !this.hasEvidence()
            ? []
            : this.taste
                  .profile()
                  .genres.filter(
                      (genre) =>
                          this.content() === 'all' ||
                          (this.content() === 'movie' &&
                              genre.movieId !== undefined) ||
                          (this.content() === 'series' &&
                              genre.tvId !== undefined)
                  )
                  .slice(0, 6)
    );
    readonly strongestGenre = computed(() => this.genres()[0] ?? null);
    readonly maxGenreCount = computed(() =>
        Math.max(1, ...this.genres().map((genre) => genre.titleCount))
    );
    readonly selected = computed(
        () => this.genres().find((g) => g.key === this.selectedGenre()) ?? null
    );
    readonly artwork = computed(() => {
        const titles = (
            this.taste.isAvailable && this.hasEvidence()
                ? this.taste.profile().titles
                : []
        )
            .filter(
                (item) =>
                    this.content() === 'all' ||
                    (this.content() === 'series'
                        ? item.mediaType === 'tv'
                        : item.mediaType === this.content())
            )
            .map((item) => ({
                key: item.key,
                title: item.title,
                poster: item.posterUrl,
                backdrop: item.backdropUrl,
            }));
        const recent = this.history().map((item) => ({
            key: `${item.playlist_id}:${item.type}:${item.xtream_id}`,
            title: item.title,
            poster: item.poster_url ?? null,
            backdrop: item.backdrop_url ?? null,
        }));
        // Enriched titles carry trusted backdrop identity; stored artwork works offline too.
        return titles.some((item) => item.poster || item.backdrop)
            ? titles
            : recent;
    });
    readonly backdrop = computed(
        () =>
            this.artwork().find((item) => this.imageAvailable(item.backdrop))
                ?.backdrop ?? null
    );
    readonly posters = computed(() =>
        this.artwork()
            .filter((item) => this.imageAvailable(item.poster))
            .slice(0, 3)
    );
    readonly recommendations = computed(() => {
        if (!this.hasEvidence() || !this.taste.isAvailable) return [];
        const selected = this.selected();
        const candidates = [
            ...this.genreRecommendations
                .rails()
                .reduce(
                    (items, rail) => [...items, ...rail.items],
                    [] as DashboardRecommendationItem[]
                ),
            ...this.watchedRecommendations.items(),
        ];
        const seen = new Set<string>();
        return candidates
            .filter((item) => {
                const key = `${item.mediaType}:${item.tmdbId}`;
                if (seen.has(key) || this.feedback.isDismissed(item))
                    return false;
                if (this.content() === 'live') return false;
                if (this.content() === 'movie' && item.mediaType !== 'movie')
                    return false;
                if (this.content() === 'series' && item.mediaType !== 'tv')
                    return false;
                if (
                    selected &&
                    !item.genreIds.includes(
                        item.mediaType === 'movie'
                            ? (selected.movieId ?? -1)
                            : (selected.tvId ?? -1)
                    )
                )
                    return false;
                // A removed source must not remain playable while a refresh is in flight.
                if (
                    !this.data
                        .playlists()
                        .some((p) => p._id === item.match.playlistId)
                )
                    return false;
                seen.add(key);
                return true;
            })
            .slice(0, 12);
    });
    readonly cards = computed(() =>
        this.recommendations().map((item) =>
            insightRecommendationCard(
                item,
                this.feedback.choiceFor(item) === 'more-like-this',
                this.translate.instant(
                    'WORKSPACE.INSIGHTS.RECOMMENDATION_REASON',
                    { title: item.seedTitle }
                )
            )
        )
    );
    readonly ready = computed(
        () => this.data.globalRecentLoaded() && !this.refreshing()
    );
    readonly hasEvidence = computed(
        () =>
            this.data
                .globalRecentItems()
                .some((item) =>
                    this.data
                        .playlists()
                        .some((source) => source._id === item.playlist_id)
                ) ||
            this.data
                .globalFavoriteItems()
                .some((item) =>
                    this.data
                        .playlists()
                        .some((source) => source._id === item.playlist_id)
                ) ||
            this.external.entries().length > 0 ||
            this.feedback.entries().length > 0
    );
    readonly busy = computed(
        () =>
            this.taste.loading() ||
            this.genreRecommendations.loading() ||
            this.watchedRecommendations.loading()
    );

    constructor() {
        void this.refresh();
        effect(() => {
            if (
                !this.data.globalRecentLoaded() ||
                !this.data.globalFavoritesLoaded() ||
                this.refreshing()
            )
                return;
            this.taste.key();
            untracked(() => void this.loadDiscovery());
        });
    }

    async refresh(): Promise<void> {
        if (this.refreshing()) return;
        this.refreshing.set(true);
        this.refreshError.set(false);
        try {
            await Promise.all([
                this.data.reloadGlobalRecentItems(),
                this.data.reloadGlobalFavorites(),
                ...(this.runtime.isElectron
                    ? [this.external.load(), this.feedback.load()]
                    : []),
            ]);
            await this.data.reloadPlaybackPositions();
        } catch {
            this.refreshError.set(true);
        } finally {
            this.refreshing.set(false);
        }
    }

    private async loadDiscovery(): Promise<void> {
        await this.taste.load();
        await Promise.all([
            this.genreRecommendations.load(),
            this.watchedRecommendations.load(),
        ]);
    }

    setContent(event: Event): void {
        this.content.set(
            (event.target as HTMLSelectElement).value as InsightsContent
        );
        this.selectedGenre.set(null);
    }

    setDays(event: Event): void {
        this.days.set(Number((event.target as HTMLSelectElement).value));
    }

    selectGenre(genre: DashboardTasteGenre): void {
        this.selectedGenre.set(
            this.selectedGenre() === genre.key ? null : genre.key
        );
    }

    imageAvailable(url: string | null | undefined): boolean {
        return !!url && !this.failedImages().has(url);
    }

    markFailed(url: string): void {
        this.failedImages.update((previous) => new Set([...previous, url]));
    }

    async onAction(selection: DashboardRailActionSelection): Promise<void> {
        const item = this.recommendations().find(
            (candidate) =>
                `insights-${candidate.mediaType}-${candidate.tmdbId}` ===
                selection.card.id
        );
        if (!item) return;
        const action = selection.action.id;
        if (
            ![
                'recommendation-more-like-this',
                'recommendation-not-for-me',
                'recommendation-undo-more-like-this',
            ].includes(action)
        )
            return;
        try {
            await this.feedback.setFeedback(
                item,
                action === 'recommendation-not-for-me'
                    ? 'not-for-me'
                    : action === 'recommendation-more-like-this'
                      ? 'more-like-this'
                      : null
            );
            this.snack.open(
                this.translate.instant(
                    'WORKSPACE.DASHBOARD.RECOMMENDATION_SAVED'
                ),
                undefined,
                { duration: 2500 }
            );
        } catch {
            this.snack.open(
                this.translate.instant('WORKSPACE.DASHBOARD.ACTION_FAILED'),
                undefined,
                { duration: 5000 }
            );
        }
    }

    async undoFeedback(entry: {
        mediaType: 'movie' | 'tv';
        tmdbId: number;
        genreIds: readonly number[];
    }): Promise<void> {
        try {
            await this.feedback.setFeedback(entry, null);
        } catch {
            this.snack.open(
                this.translate.instant('WORKSPACE.DASHBOARD.ACTION_FAILED'),
                undefined,
                { duration: 5000 }
            );
        }
    }
}
