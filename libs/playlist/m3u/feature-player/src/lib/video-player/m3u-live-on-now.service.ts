import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import type { Subscription } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    resolveChannelEpgLookupKey,
    selectChannels,
    selectFavorites,
} from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    type LiveOnNowLastWatched,
    type LiveOnNowSource,
    type LiveOnNowTile,
    parseLiveOnNowTimestamp,
    pickLiveOnNowProgram,
} from '@iptvnator/portal/shared/ui';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    type Channel,
    type EpgProgram,
    isM3uRecentlyViewedItem,
    playlistDisplayLabel,
} from '@iptvnator/shared/interfaces';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';

/** Favorite tiles shown at most; the group/playlist fallback shows fewer. */
export const M3U_ON_NOW_MAX_FAVORITES = 12;
export const M3U_ON_NOW_MAX_FALLBACK = 8;
const CLOCK_TICK_MS = 30_000;
/** The current-programme lookup is repeated this often while the stage shows. */
const EPG_REFRESH_MS = 5 * 60_000;

/**
 * Data for the M3U player's "On now" stage: the playlist's favorite channels
 * (else the first channels of the group the sidebar is browsing, or of the
 * playlist) with the programme each is airing, plus the channel last watched
 * on this playlist.
 *
 * Programmes come from `EpgService.getCurrentProgramsForChannels`, the same
 * batched XMLTV lookup the channel list uses (playlist-scoped sources,
 * manual mappings), gated on `active` so a hidden stage never queries.
 */
@Injectable()
export class M3uLiveOnNowService {
    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly settingsStore = inject(SettingsStore);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly destroyRef = inject(DestroyRef);

    /** Set by the host while the stage is rendered. */
    readonly active = signal(false);
    /** Group the sidebar's groups view is browsing; mirrored by the host. */
    readonly selectedGroup = signal<string | null>(null);
    readonly nowMs = signal(Date.now());

    private readonly channels = this.store.selectSignal(selectChannels);
    private readonly favoriteUrls = this.store.selectSignal(selectFavorites);
    private readonly programsByKey = signal<
        ReadonlyMap<string, EpgProgram | null>
    >(new Map());
    private epgSubscription: Subscription | null = null;

    private readonly channelsByUrl = computed(() => {
        const map = new Map<string, Channel>();
        for (const channel of this.channels()) {
            if (channel.url && !map.has(channel.url)) {
                map.set(channel.url, channel);
            }
        }
        return map;
    });
    private readonly favoriteChannels = computed(() => {
        const byUrl = this.channelsByUrl();
        return this.favoriteUrls()
            .map((url) => byUrl.get(url))
            .filter((channel): channel is Channel => !!channel)
            .slice(0, M3U_ON_NOW_MAX_FAVORITES);
    });
    readonly source = computed<LiveOnNowSource>(() =>
        this.favoriteChannels().length > 0 ? 'favorites' : 'category'
    );
    /** Subline label for the fallback: the browsed group, else the playlist. */
    readonly sourceLabel = computed(
        () =>
            this.selectedGroup() ??
            playlistDisplayLabel(this.playlistContext.activePlaylist()?.title)
    );
    private readonly candidates = computed<readonly Channel[]>(() => {
        if (this.source() === 'favorites') {
            return this.favoriteChannels();
        }
        const group = this.selectedGroup();
        const pool = group
            ? this.channels().filter(
                  (channel) => channel.group?.title === group
              )
            : this.channels();
        return pool.slice(0, M3U_ON_NOW_MAX_FALLBACK);
    });
    private readonly lookupKeys = computed(() =>
        Array.from(
            new Set(
                this.candidates()
                    .map((channel) => resolveChannelEpgLookupKey(channel))
                    .filter(Boolean)
            )
        )
    );

    readonly tiles = computed<LiveOnNowTile[]>(() => {
        const now = this.nowMs();
        const offset = this.settingsStore.resolvedEpgOffsetMinutes();
        const programs = this.programsByKey();
        return this.candidates().map((channel) => {
            const program = programs.get(resolveChannelEpgLookupKey(channel));
            return {
                id: channel.id,
                name: channel.name?.trim() || channel.tvg?.name || channel.url,
                logoUrl: channel.tvg?.logo?.trim() || null,
                program: pickLiveOnNowProgram(
                    program ? [program] : null,
                    now,
                    offset
                ),
            };
        });
    });

    readonly lastWatched = computed<LiveOnNowLastWatched | null>(() => {
        const byUrl = this.channelsByUrl();
        const latest = (
            this.playlistContext.activePlaylist()?.recentlyViewed ?? []
        )
            .filter(isM3uRecentlyViewedItem)
            .map((item) => ({
                item,
                channel: byUrl.get(item.url),
                watchedAtMs: parseLiveOnNowTimestamp(item.added_at),
            }))
            .filter((entry) => !!entry.channel)
            .sort((left, right) => right.watchedAtMs - left.watchedAtMs)[0];
        if (!latest?.channel) {
            return null;
        }
        return {
            id: latest.channel.id,
            name: latest.channel.name?.trim() || latest.item.title,
            logoUrl: latest.channel.tvg?.logo?.trim() || null,
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
            this.epgSubscription?.unsubscribe();
        });

        effect(() => {
            if (!this.active() || !this.runtime.supportsEpg) {
                return;
            }
            const keys = this.lookupKeys();
            // Re-read the guide every few minutes while the stage stays up,
            // so a programme boundary moves the tiles on.
            Math.floor(this.nowMs() / EPG_REFRESH_MS);
            const playlist = this.playlistContext.activePlaylist();
            const sourceUrls = normalizeEpgUrls(playlist?.epgUrls ?? []);
            untracked(() => this.loadPrograms(keys, sourceUrls));
        });
    }

    /** The channel behind a stage id — a tile's, or the last-watched bar's. */
    resolveChannel(id: string): Channel | null {
        return (
            this.candidates().find((channel) => channel.id === id) ??
            this.channels().find((channel) => channel.id === id) ??
            null
        );
    }

    private loadPrograms(keys: string[], sourceUrls: string[]): void {
        this.epgSubscription?.unsubscribe();
        if (keys.length === 0) {
            this.programsByKey.set(new Map());
            return;
        }
        this.epgSubscription = this.epgService
            .getCurrentProgramsForChannels(
                keys,
                sourceUrls.length > 0 ? { sourceUrls } : undefined
            )
            .subscribe((programs) => this.programsByKey.set(programs));
    }
}
