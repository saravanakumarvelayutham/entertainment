import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    type LiveOnNowLastWatched,
    type LiveOnNowSource,
    type LiveOnNowTile,
    parseLiveOnNowTimestamp,
    pickLiveOnNowProgram,
} from '@iptvnator/portal/shared/ui';
import {
    normalizeStalkerEntityId,
    type StalkerFavoriteItem,
    type StalkerItvChannel,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    type EpgItem,
    type EpgProgram,
    shortEpgWindowSize,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    EPG_PREVIEW_FETCH_SIZE,
    StalkerEpgPreviewQueue,
} from './stalker-live-epg-preview';

/** Favorite tiles shown at most; the category fallback shows fewer. */
export const STALKER_ON_NOW_MAX_FAVORITES = 12;
export const STALKER_ON_NOW_MAX_CATEGORY = 8;
const CLOCK_TICK_MS = 30_000;

type StoredLiveItem = StalkerFavoriteItem | StalkerPortalItem;

function toSeconds(
    rawTimestamp: string | number | null | undefined,
    rawDate: string | undefined
): number | null {
    const timestamp = Number.parseInt(String(rawTimestamp ?? ''), 10);
    if (Number.isFinite(timestamp) && timestamp > 0) {
        return timestamp;
    }
    const parsed = Date.parse(rawDate ?? '');
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function toProgram(item: EpgItem, channelId: string): EpgProgram {
    return {
        start: item.start,
        stop: item.stop || item.end,
        channel: channelId,
        title: item.title,
        desc: item.description || null,
        category: null,
        startTimestamp: toSeconds(item.start_timestamp, item.start),
        stopTimestamp: toSeconds(item.stop_timestamp, item.stop || item.end),
    };
}

/** Live-TV rows only: radio and VOD favorites share the same store. */
function isStoredItvItem(item: StoredLiveItem): boolean {
    const category =
        item.category_id == null ? 'itv' : String(item.category_id);
    return category === 'itv' && typeof item.cmd === 'string';
}

/** A stored favorite/recent row as a playable channel. */
function toItvChannel(item: StoredLiveItem): StalkerItvChannel | null {
    const id = item.id ?? item.stream_id;
    if (id == null || typeof item.cmd !== 'string') {
        return null;
    }
    return {
        id,
        cmd: item.cmd,
        name: item.name ?? item.title,
        o_name: item.o_name,
        logo: item.logo ?? item.cover,
    } as StalkerItvChannel;
}

/**
 * Data for the Stalker ITV layout's "On now" stage: the portal's favorite
 * channels (else the selected category's first rows) with the programme each
 * is airing, plus the last channel watched on this portal.
 *
 * Programmes come from the store's bulk ITV EPG (`get_epg_info`, with manual
 * XMLTV mappings overlaid); rows the bulk guide cannot answer fall back to
 * the per-channel short EPG through the same `StalkerEpgPreviewQueue` the
 * channel list uses, gated on `active` so a hidden stage never spends portal
 * requests.
 */
@Injectable()
export class StalkerLiveOnNowService {
    private readonly stalkerStore = inject(StalkerStore);
    private readonly playlistService = inject(PlaylistsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly destroyRef = inject(DestroyRef);

    /** Set by the host while the stage is rendered. */
    readonly active = signal(false);
    readonly nowMs = signal(Date.now());

    private readonly favoriteItems = signal<readonly StalkerFavoriteItem[]>([]);
    private readonly recentItems = signal<readonly StalkerPortalItem[]>([]);
    private readonly fallbackPrograms = signal<
        ReadonlyMap<string, EpgProgram[]>
    >(new Map());
    private loadedPlaylistId: string | null = null;
    private readonly previewQueue = new StalkerEpgPreviewQueue({
        fetchPrograms: async (channelId) =>
            (
                await this.stalkerStore.fetchChannelEpg(
                    channelId,
                    shortEpgWindowSize(
                        this.settingsStore.resolvedEpgOffsetMinutes(),
                        EPG_PREVIEW_FETCH_SIZE
                    )
                )
            ).map((item) => toProgram(item, channelId)),
        onPrograms: (channelId, programs) =>
            this.fallbackPrograms.update((previous) =>
                new Map(previous).set(channelId, programs)
            ),
        epgOffsetMinutes: () => this.settingsStore.resolvedEpgOffsetMinutes(),
    });

    private readonly channelById = computed(() => {
        const map = new Map<string, StalkerItvChannel>();
        for (const list of [
            this.stalkerStore.itvChannels(),
            this.stalkerStore.itvFullChannelList(),
        ]) {
            for (const item of list) {
                const id = normalizeStalkerEntityId(item.id);
                if (!map.has(id)) {
                    map.set(id, item);
                }
            }
        }
        return map;
    });
    private readonly favoriteChannels = computed(() => {
        const byId = this.channelById();
        return this.favoriteItems()
            .filter(isStoredItvItem)
            .map(
                (favorite) =>
                    byId.get(normalizeStalkerEntityId(favorite.id)) ??
                    toItvChannel(favorite)
            )
            .filter((item): item is StalkerItvChannel => !!item)
            .slice(0, STALKER_ON_NOW_MAX_FAVORITES);
    });
    readonly source = computed<LiveOnNowSource>(() =>
        this.favoriteChannels().length > 0 ? 'favorites' : 'category'
    );
    private readonly candidates = computed<readonly StalkerItvChannel[]>(() =>
        this.source() === 'favorites'
            ? this.favoriteChannels()
            : this.stalkerStore
                  .itvChannels()
                  .slice(0, STALKER_ON_NOW_MAX_CATEGORY)
    );

    readonly tiles = computed<LiveOnNowTile[]>(() => {
        const now = this.nowMs();
        const offset = this.settingsStore.resolvedEpgOffsetMinutes();
        const bulk = this.stalkerStore.bulkItvEpgByChannel();
        const fallback = this.fallbackPrograms();
        return this.candidates().map((item) => {
            const id = normalizeStalkerEntityId(item.id);
            const program =
                pickLiveOnNowProgram(bulk[id], now, offset) ??
                (this.stalkerStore.hasItvEpgMappingOverride(id)
                    ? null
                    : pickLiveOnNowProgram(fallback.get(id), now, offset));
            return {
                id,
                name: item.o_name || item.name || '',
                logoUrl: item.logo || null,
                program,
            };
        });
    });

    readonly lastWatched = computed<LiveOnNowLastWatched | null>(() => {
        const latest = this.recentItems()
            .filter(isStoredItvItem)
            .map((item) => ({
                item,
                watchedAtMs: parseLiveOnNowTimestamp(item.added_at),
            }))
            .sort((left, right) => right.watchedAtMs - left.watchedAtMs)[0];
        if (!latest) {
            return null;
        }
        const id = normalizeStalkerEntityId(
            latest.item.id ?? latest.item.stream_id
        );
        const channel = this.channelById().get(id);
        return {
            id,
            name:
                channel?.o_name ||
                channel?.name ||
                latest.item.title ||
                latest.item.o_name ||
                latest.item.name ||
                '',
            logoUrl:
                channel?.logo || latest.item.logo || latest.item.cover || null,
            watchedAtMs: latest.watchedAtMs,
        };
    });

    constructor() {
        const clock = setInterval(
            () => this.nowMs.set(Date.now()),
            CLOCK_TICK_MS
        );
        this.destroyRef.onDestroy(() => {
            clearInterval(clock);
            this.previewQueue.destroy();
        });

        effect(() => {
            const playlistId = this.stalkerStore.currentPlaylist()?._id ?? null;
            if (playlistId === this.loadedPlaylistId) {
                return;
            }
            this.loadedPlaylistId = playlistId;
            untracked(() => this.loadPlaylistData(playlistId));
        });

        // Short-EPG fallback for tiles the bulk guide leaves without a
        // current programme — deferred until the bulk request settles so the
        // queue never races the answer it is a fallback for.
        effect(() => {
            if (!this.active() || !this.runtime.supportsEpg) {
                this.previewQueue.sync([]);
                return;
            }
            if (!this.stalkerStore.bulkItvEpgLoaded()) {
                return;
            }
            const now = this.nowMs();
            const offset = this.settingsStore.resolvedEpgOffsetMinutes();
            const bulk = this.stalkerStore.bulkItvEpgByChannel();
            const missing = this.candidates()
                .map((item) => normalizeStalkerEntityId(item.id))
                .filter(
                    (id) =>
                        !pickLiveOnNowProgram(bulk[id], now, offset) &&
                        !this.stalkerStore.hasItvEpgMappingOverride(id)
                );
            untracked(() => this.previewQueue.sync(missing));
        });
    }

    /** Keeps the favorites tiles in step with the sidebar's heart toggles. */
    setFavorite(item: StalkerItvChannel, isFavorite: boolean): void {
        const id = normalizeStalkerEntityId(item.id);
        this.favoriteItems.update((favorites) => {
            const others = favorites.filter(
                (favorite) => normalizeStalkerEntityId(favorite.id) !== id
            );
            return isFavorite
                ? [
                      ...others,
                      { ...item, category_id: 'itv' } as StalkerFavoriteItem,
                  ]
                : others;
        });
    }

    /** The channel behind a stage id — a tile's, or the last-watched bar's. */
    resolveChannel(id: string): StalkerItvChannel | null {
        const normalized = normalizeStalkerEntityId(id);
        const fromCandidates = this.candidates().find(
            (item) => normalizeStalkerEntityId(item.id) === normalized
        );
        if (fromCandidates) {
            return fromCandidates;
        }
        const fromCatalog = this.channelById().get(normalized);
        if (fromCatalog) {
            return fromCatalog;
        }
        const stored = [...this.favoriteItems(), ...this.recentItems()].find(
            (item) =>
                isStoredItvItem(item) &&
                normalizeStalkerEntityId(item.id ?? item.stream_id) ===
                    normalized
        );
        return stored ? toItvChannel(stored) : null;
    }

    private loadPlaylistData(playlistId: string | null): void {
        this.favoriteItems.set([]);
        this.recentItems.set([]);
        this.fallbackPrograms.set(new Map());
        this.previewQueue.reset();
        if (!playlistId) {
            return;
        }
        this.playlistService
            .getPortalFavorites(playlistId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((favorites) => {
                if (this.loadedPlaylistId === playlistId) {
                    this.favoriteItems.set(favorites ?? []);
                }
            });
        this.playlistService
            .getPortalRecentlyViewed(playlistId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((items) => {
                if (this.loadedPlaylistId === playlistId) {
                    this.recentItems.set(items ?? []);
                }
            });
    }
}
