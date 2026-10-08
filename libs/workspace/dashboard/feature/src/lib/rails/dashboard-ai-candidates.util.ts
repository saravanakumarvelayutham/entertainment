import {
    buildRecommendationExclusionIndex,
    isExcludedCandidate,
    type DashboardRecommendationItem,
    type DashboardTmdbLookupItem,
    type DashboardTrendingItem,
} from '@iptvnator/workspace/dashboard/data-access';

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
