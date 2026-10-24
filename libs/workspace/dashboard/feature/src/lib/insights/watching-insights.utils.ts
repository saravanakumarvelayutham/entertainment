import type { PortalRecentItem } from '@iptvnator/shared/interfaces';
import type { DashboardRecommendationItem } from '@iptvnator/workspace/dashboard/data-access';
import type { DashboardRailCard } from '../rails/dashboard-rail.component';

export type InsightsContent = 'all' | 'movie' | 'series' | 'live';

export function insightRecommendationCard(
    item: DashboardRecommendationItem,
    liked: boolean,
    reason: string
): DashboardRailCard {
    return {
        id: `insights-${item.mediaType}-${item.tmdbId}`,
        title: item.title,
        imageUrl: item.posterUrl ?? undefined,
        subtitle: [item.year, item.match.playlistName]
            .filter(Boolean)
            .join(' · '),
        icon: item.mediaType === 'movie' ? 'movie' : 'video_library',
        contentType: item.mediaType === 'movie' ? 'movie' : 'series',
        link: [
            '/workspace/xtreams',
            item.match.playlistId,
            item.match.type === 'movie' ? 'vod' : 'series',
            String(item.match.categoryId),
            String(item.match.xtreamId),
        ],
        actions: [
            {
                id: 'recommendation-explanation',
                label: reason,
                icon: 'info',
                disabled: true,
            },
            {
                id: liked
                    ? 'recommendation-undo-more-like-this'
                    : 'recommendation-more-like-this',
                labelKey: `WORKSPACE.DASHBOARD.RECOMMENDATION_${liked ? 'UNDO_MORE_LIKE_THIS' : 'MORE_LIKE_THIS'}`,
                icon: 'thumb_up',
                pressed: liked,
            },
            {
                id: 'recommendation-not-for-me',
                labelKey: 'WORKSPACE.DASHBOARD.RECOMMENDATION_NOT_FOR_ME',
                icon: 'thumb_down',
            },
        ],
    };
}

/** Latest source records are observations, never sessions or watched duration. */
export function filterWatchingHistory(
    records: readonly PortalRecentItem[],
    content: InsightsContent,
    days: number,
    now = Date.now()
): PortalRecentItem[] {
    const seen = new Set<string>();
    return records.filter((item) => {
        if (content !== 'all' && item.type !== content) return false;
        if (days > 0) {
            const observed = Date.parse(item.viewed_at);
            if (
                !Number.isFinite(observed) ||
                observed < now - days * 86_400_000
            )
                return false;
        }
        const key = `${item.playlist_id}:${item.source}:${item.type}:${item.xtream_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
