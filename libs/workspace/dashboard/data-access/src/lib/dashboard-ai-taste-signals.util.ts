import type {
    AiRecommendationTasteSignals,
    PlaybackPositionData,
    PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import {
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import type { RecommendationFeedbackEntry } from './recommendation-feedback.service';

/** Select bounded taste evidence locally; source identifiers only locate progress. */
export function buildDashboardAiTasteSignals(
    activity: readonly PortalActivityItem[],
    favorites: readonly PortalActivityItem[],
    positions: ReadonlyMap<string, PlaybackPositionData>,
    votes: readonly RecommendationFeedbackEntry[]
): AiRecommendationTasteSignals {
    const seriesPositions = new Map<string, PlaybackPositionData>();
    for (const [key, position] of positions) {
        if (
            position.contentType !== 'episode' ||
            !Number.isFinite(position.seriesXtreamId)
        )
            continue;
        const playlistId =
            position.playlistId ?? key.split('::').slice(0, -2).join('::');
        const seriesKey = `${playlistId}::${position.seriesXtreamId}`;
        const previous = seriesPositions.get(seriesKey);
        if (
            !previous ||
            Date.parse(position.updatedAt ?? '') >=
                Date.parse(previous.updatedAt ?? '') ||
            !previous.updatedAt
        )
            seriesPositions.set(seriesKey, position);
    }
    const titleSignal = (item: PortalActivityItem) => {
        const title = item.title?.trim();
        if (
            !title ||
            title.length > 300 ||
            (item.type !== 'movie' && item.type !== 'series')
        )
            return null;
        return {
            title,
            mediaType:
                item.type === 'movie' ? ('movie' as const) : ('tv' as const),
        };
    };
    const seenWatched = new Set<string>();
    const watched: AiRecommendationTasteSignals['watched'][number][] = [];
    for (const item of activity) {
        const signal = titleSignal(item);
        if (!signal) continue;
        const key = `${signal.mediaType}:${signal.title.toLocaleLowerCase()}`;
        if (seenWatched.has(key)) continue;
        const id = Number(item.xtream_id);
        const position =
            positions.get(
                `${item.playlist_id}::${id}::${item.type === 'movie' ? 'vod' : 'episode'}`
            ) ??
            (item.type === 'series'
                ? seriesPositions.get(`${item.playlist_id}::${id}`)
                : undefined);
        watched.push({
            ...signal,
            completion: isPortalPlaybackWatched(position)
                ? 'completed'
                : isPortalPlaybackInProgress(position)
                  ? 'in-progress'
                  : 'started',
        });
        seenWatched.add(key);
        if (watched.length === 50) break;
    }
    const seenFavorites = new Set<string>();
    const favoriteSignals: AiRecommendationTasteSignals['favorites'][number][] =
        [];
    for (const item of favorites) {
        const signal = titleSignal(item);
        if (!signal) continue;
        const key = `${signal.mediaType}:${signal.title.toLocaleLowerCase()}`;
        if (seenFavorites.has(key)) continue;
        seenFavorites.add(key);
        favoriteSignals.push(signal);
        if (favoriteSignals.length === 50) break;
    }
    const seenVotes = new Set<string>();
    const voteSignals: AiRecommendationTasteSignals['votes'][number][] = [];
    for (const vote of votes) {
        const key = `${vote.mediaType}:${vote.tmdbId}`;
        if (
            seenVotes.has(key) ||
            !Number.isInteger(vote.tmdbId) ||
            vote.tmdbId <= 0 ||
            !['movie', 'tv'].includes(vote.mediaType) ||
            !['more-like-this', 'not-for-me'].includes(vote.choice)
        )
            continue;
        seenVotes.add(key);
        const title = vote.title?.trim();
        voteSignals.push({
            tmdbId: vote.tmdbId,
            mediaType: vote.mediaType,
            genreIds: [
                ...new Set(
                    vote.genreIds.filter((id) => Number.isInteger(id) && id > 0)
                ),
            ].slice(0, 30),
            choice: vote.choice,
            ...(title && title.length <= 300 ? { title } : {}),
        });
        if (voteSignals.length === 100) break;
    }
    return { watched, favorites: favoriteSignals, votes: voteSignals };
}

export function hasDashboardAiTasteSignals(
    signals: AiRecommendationTasteSignals | undefined
): boolean {
    return (
        !!signals &&
        signals.watched.length +
            signals.favorites.length +
            signals.votes.length >
            0
    );
}
