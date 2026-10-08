import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
    mapDiscoverResults,
    type DiscoverTitle,
} from '@iptvnator/services';
import type { AiRecommendationRankResponse } from '@iptvnator/shared/interfaces';
import {
    candidateLookup,
    isExcludedCandidate,
    type DashboardRecommendationItem,
    type ExclusionIndex,
    type RecommendationCandidate,
} from './dashboard-recommendations.util';

export interface DashboardAiDiscoveryInput {
    enabled: boolean;
    evidenceGeneration: string;
    hints: Pick<
        AiRecommendationRankResponse,
        'suggestedTitles' | 'discoveryGenres'
    >;
    activePlaylistIds: readonly string[];
    excluded: ExclusionIndex;
    /** Media type + TMDB ID, for example movie:123. */
    dismissedIds: ReadonlySet<string>;
}

interface DiscoveryGeneration {
    hints: DashboardAiDiscoveryInput['hints'];
    items: DashboardRecommendationItem[];
    loading: boolean;
    failed: boolean;
}
const identity = (item: RecommendationCandidate) =>
    item.mediaType + ':' + item.tmdbId;

/** First AI hints own each evidence generation; expanded reranking cannot feed a loop.
 * All suggestions must match an active imported catalog before they become cards. */
@Injectable({ providedIn: 'root' })
export class DashboardAiDiscoveryService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);
    readonly items = signal<readonly DashboardRecommendationItem[]>([]);
    readonly loading = signal(false);
    readonly failed = signal(false);
    private readonly generations = new Map<string, DiscoveryGeneration>();
    private current: DashboardAiDiscoveryInput | null = null;

    refresh(input: DashboardAiDiscoveryInput, retry = false): void {
        if (
            !input.enabled ||
            !this.enrichment.isEnabled() ||
            !this.titleMatch.isAvailable
        ) {
            this.cancelCurrent();
            this.current = null;
            this.setItems([]);
            this.loading.set(false);
            this.failed.set(false);
            return;
        }
        if (this.current?.evidenceGeneration !== input.evidenceGeneration)
            this.cancelCurrent();
        this.current = {
            ...input,
            activePlaylistIds: [...input.activePlaylistIds],
            dismissedIds: new Set(input.dismissedIds),
        };
        const existing = this.generations.get(input.evidenceGeneration);
        if (existing && (!retry || !existing.failed || existing.loading)) {
            this.publish(existing);
            return;
        }
        const hints = existing?.hints ?? this.boundHints(input.hints);
        if (!hints.suggestedTitles?.length && !hints.discoveryGenres?.length) {
            // Empty initial ranking hints do not claim the generation.
            this.setItems([]);
            this.loading.set(false);
            this.failed.set(false);
            return;
        }
        const generation: DiscoveryGeneration = {
            hints,
            items: [],
            loading: true,
            failed: false,
        };
        this.generations.set(input.evidenceGeneration, generation);
        if (this.generations.size > 8)
            this.generations.delete(
                this.generations.keys().next().value as string
            );
        this.publish(generation);
        void this.discover(input.evidenceGeneration, generation);
    }

    private cancelCurrent(): void {
        const key = this.current?.evidenceGeneration;
        if (key && this.generations.get(key)?.loading)
            this.generations.delete(key);
    }

    private owns(key: string, generation: DiscoveryGeneration): boolean {
        return (
            this.current?.evidenceGeneration === key &&
            this.generations.get(key) === generation
        );
    }

    private publish(generation: DiscoveryGeneration): void {
        const input = this.current;
        if (!input) return;
        const ids = new Set(input.activePlaylistIds);
        this.setItems(
            this.balanced(
                generation.items.filter(
                    (item) =>
                        ids.has(item.match.playlistId) &&
                        !input.dismissedIds.has(identity(item)) &&
                        !isExcludedCandidate(item, input.excluded)
                )
            )
        );
        this.loading.set(generation.loading);
        this.failed.set(generation.failed);
    }

    private setItems(next: readonly DashboardRecommendationItem[]): void {
        const current = this.items();
        if (
            current.length === next.length &&
            current.every((item, index) => item === next[index])
        )
            return;
        this.items.set(next);
    }

    private boundHints(
        hints: DashboardAiDiscoveryInput['hints']
    ): DashboardAiDiscoveryInput['hints'] {
        const seenTitles = new Set<string>();
        const suggestedTitles = (hints.suggestedTitles ?? [])
            .filter((item) => {
                const key =
                    item.mediaType +
                    ':' +
                    item.title.trim().toLocaleLowerCase();
                if (!item.title.trim() || seenTitles.has(key)) return false;
                seenTitles.add(key);
                return true;
            })
            .slice(0, 12);
        const seenGenres = new Set<string>();
        const discoveryGenres = (hints.discoveryGenres ?? [])
            .filter((item) => {
                const key = item.mediaType + ':' + item.genreId;
                if (
                    !Number.isInteger(item.genreId) ||
                    item.genreId <= 0 ||
                    seenGenres.has(key)
                )
                    return false;
                seenGenres.add(key);
                return true;
            })
            .slice(0, 4);
        return { suggestedTitles, discoveryGenres };
    }

    private async discover(
        key: string,
        generation: DiscoveryGeneration
    ): Promise<void> {
        try {
            const suggestions = await this.resolveSuggestions(key, generation);
            if (!this.owns(key, generation)) return;
            const results = await Promise.all(
                (generation.hints.discoveryGenres ?? []).map(async (hint) => {
                    try {
                        const titles = await this.enrichment.discoverTitles(
                            hint.mediaType,
                            { genreId: hint.genreId }
                        );
                        if (titles === null) generation.failed = true;
                        return titles ?? [];
                    } catch {
                        generation.failed = true;
                        return [];
                    }
                })
            );
            if (!this.owns(key, generation)) return;
            // Each interest contributes before a long first facet can claim the pool.
            const pools = [
                suggestions,
                ...results.map((titles) =>
                    titles.slice(0, 100).map((title) => this.toCandidate(title))
                ),
            ];
            const candidates: RecommendationCandidate[] = [];
            for (
                let index = 0;
                pools.some((pool) => index < pool.length);
                index++
            ) {
                for (const pool of pools)
                    if (pool[index]) candidates.push(pool[index]);
            }
            const titles: string[] = [];
            for (const candidate of candidates) {
                titles.push(candidate.title);
                if (candidate.originalTitle)
                    titles.push(candidate.originalTitle);
            }
            const activeIds = new Set(this.current?.activePlaylistIds ?? []);
            const grouped = groupTitleMatchesByKey(
                (await this.titleMatch.matchTitles(titles)).filter((match) =>
                    activeIds.has(match.playlistId)
                )
            );
            if (!this.owns(key, generation)) return;
            const seen = new Set<string>();
            const rows = new Set<string>();
            const verified: DashboardRecommendationItem[] = [];
            for (const candidate of candidates) {
                const match = pickTitleMatch(
                    candidateLookup(candidate),
                    grouped
                );
                if (!match) continue;
                const row =
                    match.playlistId + ':' + match.type + ':' + match.xtreamId;
                if (seen.has(identity(candidate)) || rows.has(row)) continue;
                seen.add(identity(candidate));
                rows.add(row);
                verified.push({ ...candidate, match });
            }
            generation.items = verified;
        } catch {
            generation.failed = true;
        } finally {
            generation.loading = false;
            if (this.owns(key, generation)) this.publish(generation);
        }
    }

    private async resolveSuggestions(
        key: string,
        generation: DiscoveryGeneration
    ): Promise<RecommendationCandidate[]> {
        const suggestions = generation.hints.suggestedTitles ?? [];
        if (!suggestions.length) return [];
        const ids = new Set(this.current?.activePlaylistIds ?? []);
        const grouped = groupTitleMatchesByKey(
            (
                await this.titleMatch.matchTitles(
                    suggestions.map((item) => item.title)
                )
            ).filter((match) => ids.has(match.playlistId))
        );
        if (!this.owns(key, generation)) return [];
        const verified = suggestions.filter((item) =>
            pickTitleMatch(
                {
                    type: item.mediaType === 'movie' ? 'movie' : 'series',
                    titles: [item.title],
                    year: null,
                },
                grouped
            )
        );
        const results = await Promise.all(
            verified.map(async (item) => {
                try {
                    const query = { title: item.title };
                    const details =
                        item.mediaType === 'movie'
                            ? await this.enrichment.enrichMovie(query)
                            : await this.enrichment.enrichTv(query);
                    if (!details) return null;
                    const title = mapDiscoverResults(
                        [
                            {
                                ...details,
                                genre_ids: details.genres?.map(
                                    (genre) => genre.id
                                ),
                            },
                        ],
                        item.mediaType
                    )[0];
                    return title ? this.toCandidate(title) : null;
                } catch {
                    generation.failed = true;
                    return null;
                }
            })
        );
        return results.filter(
            (item): item is RecommendationCandidate => item !== null
        );
    }

    private toCandidate(title: DiscoverTitle): RecommendationCandidate {
        return {
            ...title,
            genreIds: title.genreIds ?? [],
            seedTitle: '',
            rating:
                title.voteAverage == null ? null : title.voteAverage.toFixed(1),
        };
    }

    private balanced(
        items: DashboardRecommendationItem[]
    ): DashboardRecommendationItem[] {
        const movies = items.filter((item) => item.mediaType === 'movie');
        const series = items.filter((item) => item.mediaType === 'tv');
        const result: DashboardRecommendationItem[] = [];
        for (
            let index = 0;
            result.length < 160 &&
            (index < movies.length || index < series.length);
            index++
        ) {
            if (movies[index]) result.push(movies[index]);
            if (series[index] && result.length < 160)
                result.push(series[index]);
        }
        return result;
    }
}
