import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    DiscoverTitle,
    TmdbDetails,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from '@iptvnator/services';
import { PortalActivityItem } from '@iptvnator/shared/interfaces';
import {
    HybridRecommendationCandidate,
    TasteAffinity,
    rankHybridRecommendations,
    selectBalancedRecommendationSeeds,
} from '@iptvnator/recommendations/util';
import { DashboardDataService } from './dashboard-data.service';
import { ExternalWatchHistoryService } from './external-watch-history.service';
import { RecommendationFeedbackService } from './recommendation-feedback.service';
import {
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
} from './dashboard-tmdb-lookup.util';
import {
    DashboardRecommendationItem,
    ExclusionIndex,
    RecommendationCandidate,
    buildRecommendationExclusionIndex,
    candidateLookup,
    isExcludedCandidate,
} from './dashboard-recommendations.util';

export interface DashboardGenreRail {
    readonly genre: string;
    readonly score: number;
    readonly items: readonly DashboardRecommendationItem[];
}

interface GenrePreference {
    readonly name: string;
    score: number;
    movieId?: number;
    tvId?: number;
}

interface PreferenceSeed {
    readonly item: DashboardTmdbLookupItem;
    readonly recentIndex: number | null;
    readonly favorite: boolean;
    readonly external: boolean;
}

const MAX_SEEDS = 16;
const MAX_GENRES = 4;
const MAX_ITEMS = 20;
const MIN_ITEMS = 5;

/** Personalized library rails inferred locally from activity and favorites. */
@Injectable({ providedIn: 'root' })
export class DashboardGenreRecommendationsService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);
    private readonly data = inject(DashboardDataService);
    private readonly externalHistory = inject(ExternalWatchHistoryService);
    private readonly feedback = inject(RecommendationFeedbackService);

    readonly rails = signal<readonly DashboardGenreRail[]>([]);
    readonly loading = signal(false);
    private loadedKey: string | null = null;
    private rerunQueued = false;

    get isAvailable(): boolean {
        return this.enrichment.isEnabled() && this.titleMatch.isAvailable;
    }

    async load(): Promise<void> {
        if (!this.isAvailable) return;
        if (this.loading()) {
            this.rerunQueued = true;
            return;
        }

        this.loading.set(true);
        try {
            await Promise.all([
                this.externalHistory.load(),
                this.feedback.load(),
            ]);
            const seeds = this.selectSeeds();
            if (seeds.length === 0) {
                this.rails.set([]);
                this.loadedKey = null;
            } else {
                const loadKey = this.loadKey(seeds);
                if (loadKey !== this.loadedKey) {
                    const preferences = await this.rankGenres(seeds);
                    const excluded = this.exclusionIndex();
                    const claimedRows = new Set<string>();
                    const visible: DashboardGenreRail[] = [];
                    for (const preference of preferences) {
                        const rail = await this.buildRail(
                            preference,
                            preferences,
                            excluded,
                            claimedRows
                        );
                        if (rail) visible.push(rail);
                    }
                    this.rails.set(visible);
                    // Empty matching can also mean a transient worker failure.
                    // Keep it retryable instead of hiding genre discovery all session.
                    this.loadedKey = visible.length > 0 ? loadKey : null;
                }
            }
        } catch (error) {
            console.warn('Dashboard genre recommendations load failed:', error);
        } finally {
            this.loading.set(false);
        }

        if (this.rerunQueued) {
            this.rerunQueued = false;
            await this.load();
        }
    }

    private selectSeeds(): PreferenceSeed[] {
        const recent = this.data.globalRecentVodItems();
        const favorites = this.data
            .globalFavoriteItems()
            .filter((item) => item.type === 'movie' || item.type === 'series');
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
        return selectBalancedRecommendationSeeds(
            [recentSeeds, favoriteSeeds, externalSeeds],
            {
                limit: MAX_SEEDS,
                key: ({ item }) => dashboardTmdbLookupKey(item),
            }
        );
    }

    private async rankGenres(
        seeds: readonly PreferenceSeed[]
    ): Promise<GenrePreference[]> {
        const ranked = new Map<string, GenrePreference>();
        await Promise.all(
            seeds.map(async (seed) => {
                const resolved = await this.resolveSeed(seed.item);
                if (!resolved) return;
                const { details, mediaType } = resolved;
                const rating =
                    (details.vote_count ?? 0) > 0
                        ? Math.max(0, details.vote_average ?? 0) / 2
                        : 0;
                const recency =
                    seed.recentIndex === null
                        ? 0
                        : Math.max(1, 4 - seed.recentIndex * 0.5);
                const completion = seed.external
                    ? 0
                    : this.completionWeight(seed.item as PortalActivityItem);
                const weight =
                    recency + completion + rating + (seed.favorite ? 5 : 0);

                for (const genre of details.genres ?? []) {
                    if (!genre.id || !genre.name) continue;
                    const key = genre.name.trim().toLocaleLowerCase();
                    const preference = ranked.get(key) ?? {
                        name: genre.name.trim(),
                        score: 0,
                    };
                    preference.score += weight;
                    if (mediaType === 'movie') preference.movieId = genre.id;
                    else preference.tvId = genre.id;
                    ranked.set(key, preference);
                }
            })
        );

        return [...ranked.values()]
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, MAX_GENRES);
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
        return ratio >= 0.85 ? 3 : ratio >= 0.25 ? 1.5 : 0;
    }

    private async buildRail(
        preference: GenrePreference,
        profile: readonly GenrePreference[],
        excluded: ExclusionIndex,
        claimedRows: Set<string>
    ): Promise<DashboardGenreRail | null> {
        const discoveries = await Promise.all([
            preference.movieId
                ? this.enrichment.discoverTitles('movie', {
                      genreId: preference.movieId,
                  })
                : null,
            preference.tvId
                ? this.enrichment.discoverTitles('tv', {
                      genreId: preference.tvId,
                  })
                : null,
        ]);
        const candidates = this.toCandidates(
            discoveries,
            preference.name,
            profile,
            excluded
        );
        const items = await this.attachMatches(candidates, claimedRows);
        if (items.length < MIN_ITEMS) return null;
        for (const item of items) {
            claimedRows.add(this.catalogRowKey(item));
        }
        return { genre: preference.name, score: preference.score, items };
    }

    private toCandidates(
        discoveries: readonly (readonly DiscoverTitle[] | null)[],
        genre: string,
        profile: readonly GenrePreference[],
        excluded: ExclusionIndex
    ): RecommendationCandidate[] {
        const seen = new Set<string>();
        const candidates: HybridRecommendationCandidate<RecommendationCandidate>[] =
            [];
        const longest = Math.max(
            0,
            ...discoveries.map((list) => list?.length ?? 0)
        );
        for (let index = 0; index < longest; index++) {
            for (const list of discoveries) {
                const title = list?.[index];
                if (!title) continue;
                const candidate: RecommendationCandidate = {
                    ...title,
                    rating: null,
                    genreIds: title.genreIds ?? [],
                    seedTitle: genre,
                };
                const key = `${candidate.mediaType}:${candidate.tmdbId}`;
                if (
                    seen.has(key) ||
                    isExcludedCandidate(candidate, excluded) ||
                    this.feedback.isDismissed(candidate)
                )
                    continue;
                seen.add(key);
                candidates.push({
                    id: key,
                    value: candidate,
                    affinityKeys: (title.genreIds ?? []).map(
                        (id) => `${title.mediaType}:genre:${id}`
                    ),
                    sourceRank: index,
                    rating: title.voteAverage ?? null,
                    voteCount: title.voteCount ?? 0,
                    popularity: title.popularity ?? 0,
                    year: title.year,
                    mediaType: title.mediaType,
                });
            }
        }
        const affinities: TasteAffinity[] = [];
        for (const preference of profile) {
            if (preference.movieId) {
                affinities.push({
                    key: `movie:genre:${preference.movieId}`,
                    label: preference.name,
                    weight: preference.score,
                });
            }
            if (preference.tvId) {
                affinities.push({
                    key: `tv:genre:${preference.tvId}`,
                    label: preference.name,
                    weight: preference.score,
                });
            }
        }
        for (const [key, weight] of this.feedback.affinityWeights()) {
            affinities.push({ key, label: key, weight });
        }
        return rankHybridRecommendations(affinities, candidates, {
            limit: candidates.length,
        }).map(({ value }) => value);
    }

    private async attachMatches(
        candidates: readonly RecommendationCandidate[],
        claimedRows: ReadonlySet<string>
    ): Promise<DashboardRecommendationItem[]> {
        const titles: string[] = [];
        for (const candidate of candidates) {
            titles.push(candidate.title);
            if (candidate.originalTitle) titles.push(candidate.originalTitle);
        }
        if (titles.length === 0) return [];
        const grouped = groupTitleMatchesByKey(
            await this.titleMatch.matchTitles(titles)
        );
        const items: DashboardRecommendationItem[] = [];
        const rows = new Set<string>();
        for (const candidate of candidates) {
            const match = pickTitleMatch(candidateLookup(candidate), grouped);
            if (!match) continue;
            const row = `${match.playlistId}:${match.type}:${match.xtreamId}`;
            if (rows.has(row) || claimedRows.has(row)) continue;
            rows.add(row);
            items.push({ ...candidate, match });
            if (items.length === MAX_ITEMS) break;
        }
        return items;
    }

    private catalogRowKey(item: DashboardRecommendationItem): string {
        return `${item.match.playlistId}:${item.match.type}:${item.match.xtreamId}`;
    }

    private exclusionIndex(): ExclusionIndex {
        return buildRecommendationExclusionIndex([
            ...this.data.globalRecentItems(),
            ...this.data.globalFavoriteItems(),
        ]);
    }

    private loadKey(seeds: readonly PreferenceSeed[]): string {
        const catalog = this.data
            .playlists()
            .map((item) => item._id)
            .sort()
            .join(',');
        const seedKey = seeds
            .map((seed) => {
                const position = seed.external
                    ? null
                    : this.data.getPlaybackPositionForItem(
                          seed.item as PortalActivityItem
                      );
                return `${dashboardTmdbLookupKey(seed.item)}:${seed.favorite ? 1 : 0}:${seed.external ? 1 : 0}:${position?.positionSeconds ?? 0}:${position?.durationSeconds ?? 0}`;
            })
            .join('|');
        const activityKey = [
            ...this.data.globalRecentItems().map(dashboardTmdbLookupKey),
            '--favorites--',
            ...this.data.globalFavoriteItems().map(dashboardTmdbLookupKey),
        ].join('|');
        const externalKey = this.externalHistory
            .entries()
            .map((entry) => `${entry.title}:${entry.watchedAt}`)
            .join('|');
        return `${this.enrichment.language()}//${catalog}//${seedKey}//${activityKey}//${externalKey}//${this.feedback.cacheKey()}`;
    }
}
