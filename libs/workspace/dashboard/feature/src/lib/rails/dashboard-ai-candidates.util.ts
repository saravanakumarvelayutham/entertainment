import {
    buildRecommendationExclusionIndex,
    isExcludedCandidate,
    type DashboardRecommendationItem,
    type DashboardTmdbLookupItem,
    type DashboardTrendingItem,
} from '@iptvnator/workspace/dashboard/data-access';

/** Interleave sources so a large first rail cannot consume the AI input budget. */
export function balanceDashboardAiPools(
    pools: readonly (readonly DashboardRecommendationItem[])[]
): DashboardRecommendationItem[] {
    const result: DashboardRecommendationItem[] = [];
    const seen = new Set<string>();
    const length = Math.max(0, ...pools.map((pool) => pool.length));
    for (let index = 0; index < length; index++) {
        for (const pool of pools) {
            const item = pool[index];
            if (!item) continue;
            const key = `${item.mediaType}:${item.tmdbId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(item);
        }
    }
    return result;
}

/** Rail order owns each title once, while retaining its original card. */
export function distinctDashboardCards<T extends { id: string }>(
    cards: readonly T[],
    used: Set<string>
): T[] {
    return cards.filter((card) => {
        if (used.has(card.id)) return false;
        used.add(card.id);
        return true;
    });
}

/** Local filtering only: the transport receives public metadata, never these sources. */
export function buildDashboardAiCandidates(
    recommendations: readonly DashboardRecommendationItem[],
    trending: readonly DashboardTrendingItem[],
    activity: readonly DashboardTmdbLookupItem[],
    playlistIds: ReadonlySet<string>,
    isDismissed: (item: DashboardRecommendationItem) => boolean
): DashboardRecommendationItem[] {
    const excluded = buildRecommendationExclusionIndex(activity);
    const seen = new Set<string>();
    const trendingCandidates: DashboardRecommendationItem[] = [];
    for (const item of trending) {
        if (item.match)
            trendingCandidates.push({
                ...item,
                match: item.match,
                originalTitle: null,
                genreIds: [],
                seedTitle: '',
            });
    }
    return [...recommendations, ...trendingCandidates].filter((item) => {
        const id = item.mediaType + ':' + item.tmdbId;
        if (
            seen.has(id) ||
            !playlistIds.has(item.match.playlistId) ||
            isExcludedCandidate(item, excluded) ||
            isDismissed(item)
        )
            return false;
        seen.add(id);
        return true;
    });
}
