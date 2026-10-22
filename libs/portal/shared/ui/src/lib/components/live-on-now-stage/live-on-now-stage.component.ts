import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';
import type {
    LiveOnNowLastWatched,
    LiveOnNowSource,
    LiveOnNowTile,
} from './live-on-now.model';
import {
    describeLiveOnNowRelativeTime,
    formatLiveOnNowClock,
    liveOnNowInitials,
    liveOnNowTileHue,
} from './live-on-now.utils';

/**
 * The Live TV stage before a channel is picked: an "On now" mosaic of the
 * source's favorite channels (or the selected category's first channels)
 * showing the programme each one is airing, plus a "Last watched · Tune in"
 * bar. Purely presentational — every live host (Xtream, Stalker, M3U) maps
 * its own catalog, favorites, history and EPG into `LiveOnNowTile`s and
 * answers `channelSelected` through the same selection path a click in its
 * channel list takes, so there is exactly one way to start playback.
 *
 * With nothing to show (no tiles, no history) it falls back to the plain
 * "select a channel" empty state, so the stage never renders an empty grid.
 */
@Component({
    selector: 'app-live-on-now-stage',
    templateUrl: './live-on-now-stage.component.html',
    styleUrl: './live-on-now-stage.component.scss',
    imports: [MatIcon, PortalEmptyStateComponent, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveOnNowStageComponent {
    readonly tiles = input.required<readonly LiveOnNowTile[]>();
    readonly lastWatched = input<LiveOnNowLastWatched | null>(null);
    readonly source = input<LiveOnNowSource>('favorites');
    /** Category name shown in the subline when `source` is `category`. */
    readonly sourceLabel = input<string>('');
    /** Wall-clock now; the host's tick drives the clock and relative labels. */
    readonly nowMs = input.required<number>();
    /** A tile's or the last-watched bar's id — the host resolves and plays it. */
    readonly channelSelected = output<string>();

    readonly hasContent = computed(
        () => this.tiles().length > 0 || this.lastWatched() !== null
    );
    readonly clockLabel = computed(() => formatLiveOnNowClock(this.nowMs()));
    readonly sublineKey = computed(() =>
        this.source() === 'favorites'
            ? this.tiles().length === 1
                ? 'LIVE_ON_NOW.ACROSS_FAVORITE'
                : 'LIVE_ON_NOW.ACROSS_FAVORITES'
            : 'LIVE_ON_NOW.FROM_CATEGORY'
    );
    readonly sublineParams = computed(() => ({
        count: this.tiles().length,
        category: this.sourceLabel(),
    }));
    readonly lastWatchedRelative = computed(() => {
        const last = this.lastWatched();
        return last
            ? describeLiveOnNowRelativeTime(last.watchedAtMs, this.nowMs())
            : null;
    });

    private readonly failedLogos = signal<ReadonlySet<string>>(new Set());

    tileHue(tile: LiveOnNowTile): number {
        return liveOnNowTileHue(tile.name);
    }

    tileInitials(tile: LiveOnNowTile): string {
        return liveOnNowInitials(tile.name);
    }

    showsLogo(tile: LiveOnNowTile): boolean {
        return !!tile.logoUrl && !this.failedLogos().has(tile.id);
    }

    markLogoFailed(tile: LiveOnNowTile): void {
        this.failedLogos.update((failed) => new Set(failed).add(tile.id));
    }

    select(id: string): void {
        this.channelSelected.emit(id);
    }
}
