/**
 * Presentation contract of the Live TV "On now" stage — what the portal and
 * M3U live hosts hand to `app-live-on-now-stage` before a channel is picked.
 * Every field is already resolved for display: the stage renders, it never
 * looks anything up.
 */

/** The programme airing on a tile's channel, as the stage shows it. */
export interface LiveOnNowProgram {
    readonly title: string;
    /** "HH:mm – HH:mm" in display time, or null when the times are unknown. */
    readonly timeRange: string | null;
    /** "HH:mm" the programme ends at (display time), or null. */
    readonly endsAt: string | null;
    /** Whole minutes until the programme ends, or null without times. */
    readonly minutesLeft: number | null;
    /** 0–100 progress through the programme, or null without times. */
    readonly progress: number | null;
}

export interface LiveOnNowTile {
    /** Host-owned key; handed back through `channelSelected`. */
    readonly id: string;
    readonly name: string;
    readonly logoUrl: string | null;
    /** Null when the host has no programme data: the tile shows logo + name only. */
    readonly program: LiveOnNowProgram | null;
}

export interface LiveOnNowLastWatched {
    /** Host-owned key; handed back through `channelSelected`. */
    readonly id: string;
    readonly name: string;
    readonly logoUrl: string | null;
    /** Wall-clock milliseconds of the last viewing. */
    readonly watchedAtMs: number;
}

/** Where the tiles come from; drives the subline under the heading. */
export type LiveOnNowSource = 'favorites' | 'category';

/**
 * The subset of `EpgProgram` the stage needs. `EpgItem`-shaped provider data
 * is converted to this by the host; `EpgProgram` satisfies it structurally.
 */
export interface LiveOnNowProgramSource {
    readonly title?: string | null;
    readonly start?: string | null;
    readonly stop?: string | null;
    /** Unix SECONDS, the app-wide `EpgProgram` contract. */
    readonly startTimestamp?: number | null;
    readonly stopTimestamp?: number | null;
}

/** Translation key + params describing how long ago something was watched. */
export interface LiveOnNowRelativeTime {
    readonly key: string;
    readonly params?: Record<string, string | number>;
}
