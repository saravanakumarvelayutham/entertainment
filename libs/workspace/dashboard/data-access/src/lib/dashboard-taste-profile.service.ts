import { Injectable, inject, signal } from '@angular/core';
import {
    RuntimeCapabilitiesService,
    TmdbDetails,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { PortalActivityItem } from '@iptvnator/shared/interfaces';
import { selectBalancedRecommendationSeeds } from '@iptvnator/recommendations/util';
import { DashboardDataService } from './dashboard-data.service';
import { ExternalWatchHistoryService } from './external-watch-history.service';
import { RecommendationFeedbackService } from './recommendation-feedback.service';
import {
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
} from './dashboard-tmdb-lookup.util';

export interface DashboardTasteGenre {
    readonly key: string;
    readonly name: string;
    readonly score: number;
    readonly titleCount: number;
    readonly movieId?: number;
    readonly tvId?: number;
}
export interface DashboardTasteTitle {
    readonly key: string;
    readonly title: string;
    readonly mediaType: 'movie' | 'tv';
    readonly tmdbId: number;
    readonly posterUrl: string | null;
    readonly backdropUrl: string | null;
    readonly year: number | null;
    readonly genreIds: readonly number[];
    readonly recent: boolean;
    readonly favorite: boolean;
    readonly external: boolean;
}
export interface DashboardTasteProfile {
    readonly genres: readonly DashboardTasteGenre[];
    readonly titles: readonly DashboardTasteTitle[];
    readonly totalSeeds: number;
    readonly resolvedSeeds: number;
}
interface PreferenceSeed {
    readonly item: DashboardTmdbLookupItem;
    readonly recentIndex: number | null;
    readonly favorite: boolean;
    readonly external: boolean;
}
const emptyProfile = (): DashboardTasteProfile => ({
    genres: [],
    titles: [],
    totalSeeds: 0,
    resolvedSeeds: 0,
});

/** Bounded local taste evidence shared by watching insights and discovery. */
@Injectable({ providedIn: 'root' })
export class DashboardTasteProfileService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly data = inject(DashboardDataService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly externalHistory = inject(ExternalWatchHistoryService);
    private readonly feedback = inject(RecommendationFeedbackService);
    private loadedKey: string | null = null;
    private pending: Promise<void> | null = null;
    private readonly profileState =
        signal<DashboardTasteProfile>(emptyProfile());
    readonly profile = this.profileState.asReadonly();
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    get isAvailable(): boolean {
        return this.enrichment.isEnabled();
    }

    /** Completion buckets avoid enrichment on ordinary playback ticks. */
    key(): string {
        const active = new Set(this.data.playlists().map((item) => item._id));
        return JSON.stringify([
            this.isAvailable,
            this.enrichment.language(),
            this.data
                .playlists()
                .map((item) => item._id)
                .sort(),
            this.selectSeeds().map((seed) => [
                dashboardTmdbLookupKey(seed.item),
                seed.recentIndex,
                seed.favorite,
                seed.external,
                seed.external
                    ? 0
                    : this.completionWeight(seed.item as PortalActivityItem),
            ]),
            // Exclusions use all recorded activity, including titles outside the seed budget.
            [
                this.data.globalRecentItems(),
                this.data.globalFavoriteItems(),
            ].map((items) =>
                items
                    .filter((item) => active.has(item.playlist_id))
                    .map((item) => [item.title, dashboardTmdbLookupKey(item)])
                    .sort()
            ),
            this.feedback.cacheKey(),
        ]);
    }
    affinities(): readonly { key: string; label: string; weight: number }[] {
        const weights = new Map(this.feedback.affinityWeights());
        for (const genre of this.profile().genres)
            weights.set(genre.key, genre.score);
        return [...weights].map(([key, weight]) => ({
            key,
            label:
                this.profile().genres.find((genre) => genre.key === key)
                    ?.name ?? key,
            weight,
        }));
    }
    async load(): Promise<void> {
        if (this.pending) return this.pending;
        const operation = this.loadCurrent();
        this.pending = operation;
        try {
            await operation;
        } finally {
            if (this.pending === operation) this.pending = null;
        }
    }
    private async loadCurrent(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        try {
            // Imported history and feedback persist through Electron app state only.
            if (this.runtime.isElectron) {
                await Promise.all([
                    this.externalHistory.load(),
                    this.feedback.load(),
                ]);
            }
            let currentKey: string;
            do {
                currentKey = this.key();
                if (currentKey === this.loadedKey) return;
                if (!this.isAvailable) {
                    this.profileState.set(emptyProfile());
                    this.loadedKey = null;
                    return;
                }
                const seeds = this.selectSeeds();
                this.profileState.set(emptyProfile());
                const profile = await this.resolveProfile(seeds);
                if (currentKey === this.key()) {
                    this.profileState.set(profile);
                    this.loadedKey =
                        profile.resolvedSeeds || !seeds.length
                            ? currentKey
                            : null;
                }
            } while (currentKey !== this.key());
        } catch {
            this.profileState.set(emptyProfile());
            this.loadedKey = null;
            this.error.set(
                'Watching interests could not be loaded. Please retry.'
            );
        } finally {
            this.loading.set(false);
        }
    }
    private async resolveProfile(
        seeds: readonly PreferenceSeed[]
    ): Promise<DashboardTasteProfile> {
        const results = await Promise.all(
            seeds.map(async (seed) => ({
                seed,
                resolved: await this.resolveSeed(seed.item),
            }))
        );
        const titles = new Map<string, DashboardTasteTitle>();
        const weights = new Map<string, number>();
        const genres = new Map<string, DashboardTasteGenre>();
        for (const { seed, resolved } of results) {
            if (
                !resolved ||
                !Number.isInteger(resolved.details.id) ||
                resolved.details.id <= 0
            )
                continue;
            const { details, mediaType } = resolved;
            const key = mediaType + ':' + details.id;
            const previous = titles.get(key);
            const recent = seed.recentIndex !== null && !seed.external;
            const movie = 'title' in details ? details : null;
            const tv = 'name' in details ? details : null;
            const date = movie?.release_date ?? tv?.first_air_date;
            const year = date ? Number(date.slice(0, 4)) : null;
            titles.set(key, {
                key,
                title: movie?.title ?? tv?.name ?? seed.item.title,
                mediaType,
                tmdbId: details.id,
                posterUrl: details.poster_path
                    ? 'https://image.tmdb.org/t/p/w500' + details.poster_path
                    : null,
                backdropUrl: details.backdrop_path
                    ? 'https://image.tmdb.org/t/p/w1280' + details.backdrop_path
                    : null,
                year: year && Number.isFinite(year) ? year : null,
                genreIds: [
                    ...new Set((details.genres ?? []).map((genre) => genre.id)),
                ],
                recent: recent || !!previous?.recent,
                favorite: seed.favorite || !!previous?.favorite,
                external: seed.external || !!previous?.external,
            });
            // Episodes/provider copies strengthen evidence flags without multiplying taste.
            const weight =
                (seed.recentIndex === null
                    ? 0
                    : Math.max(1, 4 - seed.recentIndex * 0.5)) +
                (seed.external
                    ? 0
                    : this.completionWeight(seed.item as PortalActivityItem)) +
                (seed.favorite ? 5 : 0);
            weights.set(key, Math.max(weights.get(key) ?? 0, weight));
            for (const genre of details.genres ?? []) {
                const genreKey = mediaType + ':genre:' + genre.id;
                if (genre.id > 0 && genre.name.trim())
                    genres.set(genreKey, {
                        key: genreKey,
                        name: genre.name.trim(),
                        score: 0,
                        titleCount: 0,
                        ...(mediaType === 'movie'
                            ? { movieId: genre.id }
                            : { tvId: genre.id }),
                    });
            }
        }
        const feedback = this.feedback.affinityWeights();
        for (const [key, genre] of genres) {
            const matching = [...titles.values()].filter((title) =>
                title.genreIds.some(
                    (id) => title.mediaType + ':genre:' + id === key
                )
            );
            genres.set(key, {
                ...genre,
                titleCount: matching.length,
                score:
                    matching.reduce(
                        (score, title) => score + (weights.get(title.key) ?? 0),
                        0
                    ) + (feedback.get(key) ?? 0),
            });
        }
        return {
            genres: [...genres.values()].sort(
                (a, b) => b.score - a.score || a.key.localeCompare(b.key)
            ),
            titles: [...titles.values()],
            totalSeeds: seeds.length,
            resolvedSeeds: titles.size,
        };
    }
    private selectSeeds(): PreferenceSeed[] {
        const active = new Set(this.data.playlists().map((item) => item._id));
        const recent = this.data
            .globalRecentVodItems()
            .filter((item) => active.has(item.playlist_id));
        const favorites = this.data
            .globalFavoriteItems()
            .filter(
                (item) =>
                    active.has(item.playlist_id) &&
                    (item.type === 'movie' || item.type === 'series')
            );
        const favoriteKeys = new Set(favorites.map(dashboardTmdbLookupKey));
        const recentSeeds: PreferenceSeed[] = [];
        const favoriteSeeds: PreferenceSeed[] = [];
        const externalSeeds: PreferenceSeed[] = [];

        const add = (
            seeds: PreferenceSeed[],
            item: DashboardTmdbLookupItem,
            recentIndex: number | null,
            favorite: boolean,
            external = false
        ): void => {
            if (buildDashboardTmdbAttempts(item).length === 0) return;
            seeds.push({ item, recentIndex, favorite, external });
        };

        recent.forEach((item, index) =>
            add(
                recentSeeds,
                item,
                index,
                favoriteKeys.has(dashboardTmdbLookupKey(item))
            )
        );
        favorites.forEach((item) => add(favoriteSeeds, item, null, true));
        this.externalHistory.entries().forEach((entry, index) => {
            // Netflix series rows have a stable "Show: Season N: Episode N"
            // shape. Preserve colons in movie titles while reducing that one
            // known form to the series title for TMDB lookup.
            const episodeSuffix = /: Season \d+: Episode \d+.*$/i;
            const isSeries = episodeSuffix.test(entry.title);
            const title = entry.title.replace(episodeSuffix, '');
            add(
                externalSeeds,
                {
                    title,
                    type: isSeries ? 'series' : 'movie',
                    source: 'external',
                } as unknown as DashboardTmdbLookupItem,
                index,
                false,
                true
            );
        });
        const positiveSeeds: PreferenceSeed[] = this.feedback
            .entries()
            .filter((entry) => entry.choice === 'more-like-this' && entry.title)
            .map((entry) => ({
                item: {
                    title: entry.title ?? '',
                    type: entry.mediaType === 'tv' ? 'series' : 'movie',
                    source: 'external',
                    tmdb_id: entry.tmdbId,
                } as unknown as DashboardTmdbLookupItem,
                recentIndex: null,
                favorite: false,
                external: false,
            }));
        return selectBalancedRecommendationSeeds(
            [recentSeeds, favoriteSeeds, externalSeeds, positiveSeeds],
            {
                limit: 16,
                key: ({ item }) => dashboardTmdbLookupKey(item),
            }
        );
    }

    private async resolveSeed(
        item: DashboardTmdbLookupItem
    ): Promise<{ details: TmdbDetails; mediaType: 'movie' | 'tv' } | null> {
        for (const attempt of buildDashboardTmdbAttempts(item)) {
            const query = {
                title: attempt.title,
                originalTitle: attempt.originalTitle,
                tmdbId: attempt.tmdbId,
                year: attempt.year,
            };
            const details =
                attempt.mediaType === 'tv'
                    ? await this.enrichment.enrichTv(query)
                    : await this.enrichment.enrichMovie(query);
            if (details) return { details, mediaType: attempt.mediaType };
        }
        return null;
    }

    private completionWeight(item: PortalActivityItem): number {
        const position = this.data.getPlaybackPositionForItem(item);
        if (!position?.durationSeconds || position.durationSeconds <= 0)
            return 0;
        const ratio = position.positionSeconds / position.durationSeconds;
        return ratio >= 0.85 ? 1 : ratio >= 0.25 ? 0.5 : 0;
    }
}
