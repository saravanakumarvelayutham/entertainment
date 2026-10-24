import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    DiscoverTitle,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from '@iptvnator/services';
import {
    HybridRecommendationCandidate,
    rankHybridRecommendations,
} from '@iptvnator/recommendations/util';
import { DashboardDataService } from './dashboard-data.service';
import {
    DashboardTasteGenre,
    DashboardTasteProfileService,
} from './dashboard-taste-profile.service';
import { RecommendationFeedbackService } from './recommendation-feedback.service';
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

const MAX_GENRES = 4;
const MAX_ITEMS = 20;
const MIN_ITEMS = 5;

/** Personalized library rails inferred locally from activity and favorites. */
@Injectable({ providedIn: 'root' })
export class DashboardGenreRecommendationsService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);
    private readonly data = inject(DashboardDataService);
    private readonly taste = inject(DashboardTasteProfileService);
    private readonly feedback = inject(RecommendationFeedbackService);

    readonly rails = signal<readonly DashboardGenreRail[]>([]);
    readonly loading = signal(false);
    private loadedKey: string | null = null;
    private rerunQueued = false;

    get isAvailable(): boolean {
        return this.enrichment.isEnabled() && this.titleMatch.isAvailable;
    }

    async load(): Promise<void> {
        if (!this.isAvailable) {
            this.rails.set([]);
            this.loadedKey = null;
            return;
        }
        if (this.loading()) {
            this.rerunQueued = true;
            return;
        }

        this.loading.set(true);
        try {
            await this.taste.load();
            const seeds = this.taste.profile().titles;
            if (seeds.length === 0) {
                this.rails.set([]);
                this.loadedKey = null;
            } else {
                const loadKey = this.taste.key();
                if (loadKey !== this.loadedKey) {
                    const preferences = this.taste
                        .profile()
                        .genres.slice(0, MAX_GENRES);
                    const excluded = this.exclusionIndex();
                    const claimedRows = new Set<string>();
                    const visible: DashboardGenreRail[] = [];
                    for (const preference of preferences) {
                        const rail = await this.buildRail(
                            preference,
                            excluded,
                            claimedRows
                        );
                        if (rail) visible.push(rail);
                    }
                    if (loadKey !== this.taste.key() || !this.isAvailable) {
                        this.rails.set([]);
                        this.rerunQueued = true;
                    } else this.rails.set(visible);
                    // Empty matching can also mean a transient worker failure.
                    // Keep it retryable instead of hiding genre discovery all session.
                    this.loadedKey =
                        !this.rerunQueued && visible.length > 0
                            ? loadKey
                            : null;
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

    private async buildRail(
        preference: DashboardTasteGenre,
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
        return rankHybridRecommendations(this.taste.affinities(), candidates, {
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
        const active = new Set(this.data.playlists().map((item) => item._id));
        return buildRecommendationExclusionIndex([
            ...this.data
                .globalRecentItems()
                .filter((item) => active.has(item.playlist_id)),
            ...this.data
                .globalFavoriteItems()
                .filter((item) => active.has(item.playlist_id)),
        ]);
    }
}
