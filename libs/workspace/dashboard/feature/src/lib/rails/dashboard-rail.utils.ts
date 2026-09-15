import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    isPortalAccountPlaylist,
    normalizeTitleKeys,
} from '@iptvnator/shared/interfaces';
import {
    buildCollectionViewState,
    COLLECTION_VIEW_STATE_KEY,
    CollectionContentType,
} from '@iptvnator/portal/shared/util';
import type {
    DashboardRailAction,
    DashboardRailCard,
} from './dashboard-rail.component';
import type { DashboardRailsSettings } from '@iptvnator/shared/interfaces';

// Cap dashboard rails at 20 items. Users get ~3x what's visible at once,
// the DOM stays cheap, and the "Manage all" link is one click away for the
// full list. Matches the single-rail density of Netflix / Apple TV+.
export const RAIL_ITEM_LIMIT = 20;

// Six placeholder slots per skeleton rail fills a typical viewport without
// taking the whole page. Mirrors the recently-added skeleton density.
export const SKELETON_CARDS_PER_RAIL = [1, 2, 3, 4, 5, 6] as const;
export const SKELETON_RAILS = [1, 2, 3] as const;

const LOW_QUALITY_RELEASE = /\b(?:cam(?:rip)?|hdcam|telesync)\b/iu;
const RELEASE_TAG =
    /\b(?:2160p?|4k|uhd|1440p|1080[pi]?|720[pi]?|576[pi]?|480[pi]?|360[pi]?|cam(?:rip)?|hdcam|telesync|telecine|web[ ._-]?dl|webrip|blu[ ._-]?ray|brrip|dvdrip|remux)\b/giu;

const QUALITY_RANKS: ReadonlyArray<[RegExp, number]> = [
    [/\b(?:2160p?|4k|uhd)\b/iu, 6],
    [/\b1440p\b/iu, 5],
    [/\b1080[pi]?\b/iu, 4],
    [/\b720[pi]?\b/iu, 3],
    [/\b576[pi]?\b/iu, 2],
    [/\b480[pi]?\b/iu, 1],
    [/\b360[pi]?\b/iu, 0],
];

function releaseQualityRank(title: string): number {
    return QUALITY_RANKS.find(([pattern]) => pattern.test(title))?.[1] ?? 0;
}

function curatedTitleKey(title: string): string {
    const withoutReleaseTags = title
        .replace(RELEASE_TAG, ' ')
        .replace(/[()[\]{}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const keys = normalizeTitleKeys(withoutReleaseTags);
    return keys.base || keys.exact || title.trim().toLocaleLowerCase();
}

/**
 * Presentation-only cleanup for broad provider feeds such as Recently Added.
 * Obvious pre-release captures are omitted, and copies that differ only by a
 * release/quality tag collapse to the highest-labelled version. Audio and
 * language tags stay in the identity, so a dub is never hidden as a duplicate.
 */
export function curateDashboardContentItems<T extends { title: string }>(
    items: readonly T[]
): T[] {
    const selected = new Map<
        string,
        { item: T; qualityRank: number; firstIndex: number }
    >();

    items.forEach((item, index) => {
        if (LOW_QUALITY_RELEASE.test(item.title)) {
            return;
        }

        const key = curatedTitleKey(item.title);
        const qualityRank = releaseQualityRank(item.title);
        const current = selected.get(key);
        if (!current) {
            selected.set(key, { item, qualityRank, firstIndex: index });
            return;
        }

        if (qualityRank > current.qualityRank) {
            selected.set(key, {
                item,
                qualityRank,
                firstIndex: current.firstIndex,
            });
        }
    });

    return [...selected.values()]
        .sort((a, b) => a.firstIndex - b.firstIndex)
        .map(({ item }) => item);
}

export function isDashboardHighRated(rating: string | null): boolean {
    const value = Number(rating);
    return rating !== null && Number.isFinite(value) && value >= 7.5;
}

export type DashboardSourceActionId =
    'refresh' | 'playlist-info' | 'account-info' | 'remove';

export function buildDashboardSourceActions(
    playlist: PlaylistMeta,
    canRefresh: boolean
): DashboardRailAction[] {
    const actions: DashboardRailAction[] = [];

    if (canRefresh) {
        actions.push({
            id: 'refresh',
            icon: 'sync',
            labelKey: playlist.serverUrl
                ? 'HOME.PLAYLISTS.REFRESH_XTREAM'
                : 'HOME.PLAYLISTS.REFRESH',
        });
    }

    actions.push({
        id: 'playlist-info',
        icon: 'edit',
        labelKey: 'HOME.PLAYLISTS.SHOW_DETAILS',
    });

    if (isPortalAccountPlaylist(playlist)) {
        actions.push({
            id: 'account-info',
            icon: 'person',
            labelKey: 'WORKSPACE.SHELL.ACCOUNT_INFO',
        });
    }

    actions.push({
        id: 'remove',
        icon: 'delete',
        labelKey: 'HOME.PLAYLISTS.REMOVE_DIALOG.TITLE',
        destructive: true,
        separatorBefore: true,
    });

    return actions;
}

export type DashboardContinueWatchingActionId =
    'resume' | 'mark-watched' | 'remove-from-history';

/**
 * ⋮ menu for Continue Watching cards (issue #1441). The default card click is
 * detail-only (movie-like); the explicit Resume action carries the one-shot
 * auto-play handoff instead. Reuses existing translation keys so no new
 * strings are needed across the language files.
 */
export function buildDashboardContinueWatchingActions(options: {
    canResume: boolean;
    canMarkWatched: boolean;
}): DashboardRailAction[] {
    const actions: DashboardRailAction[] = [];

    if (options.canResume) {
        actions.push({
            id: 'resume',
            icon: 'play_arrow',
            labelKey: 'XTREAM.RESUME_EPISODE',
        });
    }

    if (options.canMarkWatched) {
        actions.push({
            id: 'mark-watched',
            icon: 'check_circle',
            labelKey: 'XTREAM.MARK_WATCHED',
        });
    }

    actions.push({
        id: 'remove-from-history',
        icon: 'delete',
        labelKey: 'WORKSPACE.DASHBOARD.REMOVE_FROM_HISTORY',
        destructive: true,
        separatorBefore: actions.length > 0,
    });

    return actions;
}

export function liveRailTitleKeyForSource(
    source: 'favorites' | 'recent'
): string {
    return source === 'favorites'
        ? 'WORKSPACE.DASHBOARD.LIVE_FAVORITES'
        : 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED_LIVE_TV';
}

export function buildDashboardCollectionViewState(
    selectedContentType: CollectionContentType
): Record<string, unknown> {
    return {
        [COLLECTION_VIEW_STATE_KEY]: buildCollectionViewState({
            selectedContentType,
        }),
    };
}

export function buildDashboardRailSeeAllState(
    cards: readonly Pick<DashboardRailCard, 'contentType'>[],
    fallbackContentType: CollectionContentType = 'movie'
): Record<string, unknown> {
    const firstContentType =
        cards.find(
            (
                card
            ): card is Pick<DashboardRailCard, 'contentType'> & {
                contentType: CollectionContentType;
            } =>
                card.contentType === 'live' ||
                card.contentType === 'movie' ||
                card.contentType === 'series'
        )?.contentType ?? fallbackContentType;

    return buildDashboardCollectionViewState(firstContentType);
}

type DashboardRecentRailSettings = Pick<
    DashboardRailsSettings,
    'continueWatching' | 'recentlyWatchedLive'
>;
type DashboardLiveFavoriteRailSettings = Pick<
    DashboardRailsSettings,
    'liveFavorites'
>;

export interface DashboardRecentContentSkeletonInput {
    readonly continueWatchingCount: number;
    readonly globalRecentLoading: boolean;
    readonly recentLiveCount: number;
}

export function shouldShowRecentContentSkeleton(
    rails: DashboardRecentRailSettings,
    input: DashboardRecentContentSkeletonInput
): boolean {
    if (!input.globalRecentLoading) {
        return false;
    }

    return (
        (rails.continueWatching && input.continueWatchingCount === 0) ||
        (rails.recentlyWatchedLive && input.recentLiveCount === 0)
    );
}

export interface DashboardLiveFavoritesSkeletonInput {
    readonly globalFavoritesLoading: boolean;
}

export function shouldShowLiveFavoritesSkeleton(
    rails: DashboardLiveFavoriteRailSettings,
    input: DashboardLiveFavoritesSkeletonInput
): boolean {
    return rails.liveFavorites && input.globalFavoritesLoading;
}
