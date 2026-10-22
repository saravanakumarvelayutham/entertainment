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
    type LiveOnNowProgramSource,
    type LiveOnNowSource,
    type LiveOnNowTile,
    parseLiveOnNowTimestamp,
    pickLiveOnNowProgram,
} from '@iptvnator/portal/shared/ui';
import {
    EpgQueueService,
    FavoritesService,
    type XtreamCredentials,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import type { EpgItem } from '@iptvnator/shared/interfaces';
import { XtreamFavoriteMarksService } from '../portal-channels-list/xtream-favorite-marks.service';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

/** Favorite tiles shown at most; the category fallback shows fewer. */
export const XTREAM_ON_NOW_MAX_FAVORITES = 12;
export const XTREAM_ON_NOW_MAX_CATEGORY = 8;
const CLOCK_TICK_MS = 30_000;

function toProgramSource(item: EpgItem): LiveOnNowProgramSource {
    const seconds = (value: string | number | null | undefined) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    return {
        title: item.title,
        start: item.start,
        stop: item.stop ?? item.end,
        startTimestamp: seconds(item.start_timestamp),
        stopTimestamp: seconds(item.stop_timestamp),
    };
}

/**
 * Data for the Xtream live layout's "On now" stage: the playlist's favorite
 * live channels (else the selected category's first rows) with the programme
 * each is airing, plus the last live channel watched on this playlist.
 *
 * EPG comes from the same `EpgQueueService` the channel list uses (provider
 * short EPG with the XMLTV fallback and manual mappings), so a tile never
 * shows anything the list would not. Fetching is gated on `active`: the
 * stage is only on screen while nothing plays, and rows that are not shown
 * must not spend provider requests.
 */
@Injectable()
export class XtreamLiveOnNowService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly favoriteMarks = inject(XtreamFavoriteMarksService);
    private readonly epgQueue = inject(EpgQueueService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly destroyRef = inject(DestroyRef);

    /** Set by the host while the stage is rendered. */
    readonly active = signal(false);
    readonly nowMs = signal(Date.now());

    private readonly favoriteIds = signal<readonly number[]>([]);
    private readonly programsByStream = signal<ReadonlyMap<number, EpgItem[]>>(
        new Map()
    );
    private loadedPlaylistId: string | null = null;

    private readonly liveById = computed(() => {
        const map = new Map<number, XtreamLiveChannelItem>();
        for (const item of this.xtreamStore.liveStreams() as unknown as XtreamLiveChannelItem[]) {
            map.set(Number(item.xtream_id), item);
        }
        return map;
    });
    private readonly favoriteChannels = computed(() => {
        const byId = this.liveById();
        return this.favoriteIds()
            .map((id) => byId.get(id))
            .filter((item): item is XtreamLiveChannelItem => !!item)
            .slice(0, XTREAM_ON_NOW_MAX_FAVORITES);
    });
    readonly source = computed<LiveOnNowSource>(() =>
        this.favoriteChannels().length > 0 ? 'favorites' : 'category'
    );
    private readonly candidates = computed<readonly XtreamLiveChannelItem[]>(
        () =>
            this.source() === 'favorites'
                ? this.favoriteChannels()
                : (
                      this.xtreamStore.selectItemsFromSelectedCategory() as XtreamLiveChannelItem[]
                  ).slice(0, XTREAM_ON_NOW_MAX_CATEGORY)
    );

    readonly tiles = computed<LiveOnNowTile[]>(() => {
        const now = this.nowMs();
        const offset = this.settingsStore.resolvedEpgOffsetMinutes();
        const programs = this.programsByStream();
        return this.candidates().map((item) => ({
            id: String(item.xtream_id),
            name: item.title ?? item.name ?? '',
            logoUrl: item.poster_url || item.stream_icon || null,
            program: pickLiveOnNowProgram(
                programs.get(Number(item.xtream_id))?.map(toProgramSource),
                now,
                offset
            ),
        }));
    });

    readonly lastWatched = computed<LiveOnNowLastWatched | null>(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return null;
        }
        const latest = this.xtreamStore
            .recentItems()
            .filter(
                (item) =>
                    item.type === 'live' &&
                    item.playlist_id === playlistId &&
                    Number(item.xtream_id) > 0
            )
            .map((item) => ({
                item,
                watchedAtMs: parseLiveOnNowTimestamp(item.viewed_at),
            }))
            .sort((left, right) => right.watchedAtMs - left.watchedAtMs)[0];
        if (!latest) {
            return null;
        }
        const channel = this.liveById().get(Number(latest.item.xtream_id));
        return {
            id: String(latest.item.xtream_id),
            name: channel?.title ?? channel?.name ?? latest.item.title ?? '',
            logoUrl:
                channel?.poster_url ||
                channel?.stream_icon ||
                latest.item.poster_url ||
                null,
            watchedAtMs: latest.watchedAtMs,
        };
    });

    constructor() {
        const clock = setInterval(
            () => this.nowMs.set(Date.now()),
            CLOCK_TICK_MS
        );
        this.destroyRef.onDestroy(() => clearInterval(clock));

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id ?? null;
            if (playlistId === this.loadedPlaylistId) {
                return;
            }
            this.loadedPlaylistId = playlistId;
            untracked(() => this.loadPlaylistData(playlistId));
        });

        effect(() => {
            if (!this.active() || !this.runtime.supportsEpg) {
                return;
            }
            const candidates = this.candidates();
            const playlist = this.xtreamStore.currentPlaylist();
            if (!playlist || candidates.length === 0) {
                return;
            }
            untracked(() => this.loadEpg(candidates, playlist));
        });

        if (this.runtime.supportsEpg) {
            this.epgQueue.epgResult$
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(({ streamId, items }) =>
                    this.rememberPrograms(streamId, items)
                );
        }
        this.favoriteMarks.changes$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((change) => {
                if (change.playlistId !== this.loadedPlaylistId) {
                    return;
                }
                const [type, rawId] = change.key.split(':');
                const id = Number(rawId);
                if (type !== 'live' || !Number.isFinite(id)) {
                    return;
                }
                this.favoriteIds.update((ids) =>
                    change.isFavorite
                        ? ids.includes(id)
                            ? ids
                            : [...ids, id]
                        : ids.filter((other) => other !== id)
                );
            });
    }

    /** The channel behind a stage id — a tile's, or the last-watched bar's. */
    resolveChannel(id: string): XtreamLiveChannelItem | null {
        const xtreamId = Number(id);
        return (
            this.candidates().find(
                (item) => Number(item.xtream_id) === xtreamId
            ) ??
            this.liveById().get(xtreamId) ??
            null
        );
    }

    /** The rows a selection on the stage was made from. */
    displayedChannels(): readonly XtreamLiveChannelItem[] {
        return this.candidates();
    }

    private loadPlaylistData(playlistId: string | null): void {
        this.favoriteIds.set([]);
        this.programsByStream.set(new Map());
        if (!playlistId) {
            return;
        }
        this.favoritesService
            .getFavorites(playlistId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((favorites) => {
                if (this.loadedPlaylistId !== playlistId) {
                    return;
                }
                this.favoriteIds.set(
                    favorites
                        .filter((favorite) => favorite.type === 'live')
                        .map((favorite) => Number(favorite.xtream_id))
                        .filter((id) => Number.isFinite(id) && id > 0)
                );
            });
        this.xtreamStore.loadRecentItems({ id: playlistId });
    }

    private loadEpg(
        channels: readonly XtreamLiveChannelItem[],
        playlist: XtreamCredentials & { id: string }
    ): void {
        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            serverTimezone: playlist.serverTimezone,
        };
        const uncached: {
            streamId: number;
            epgChannelId?: string | null;
            playlistId?: string | null;
        }[] = [];
        for (const channel of channels) {
            const cached = this.epgQueue.getCached(channel.xtream_id);
            if (cached !== null) {
                this.rememberPrograms(channel.xtream_id, cached);
                continue;
            }
            uncached.push({
                streamId: channel.xtream_id,
                epgChannelId: channel.epg_channel_id ?? null,
                playlistId: playlist.id,
            });
        }
        if (uncached.length === 0) {
            return;
        }
        this.epgQueue
            .enqueue(
                uncached,
                new Set(channels.map((channel) => channel.xtream_id)),
                credentials
            )
            .catch(() => undefined);
    }

    private rememberPrograms(streamId: number, items: EpgItem[]): void {
        if (!this.candidates().some((item) => item.xtream_id === streamId)) {
            return;
        }
        this.programsByStream.update((programs) => {
            const next = new Map(programs);
            next.set(streamId, items);
            return next;
        });
    }
}
