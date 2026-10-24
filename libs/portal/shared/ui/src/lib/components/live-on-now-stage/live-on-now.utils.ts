import {
    epgDisplayTimeMs,
    epgProviderClockMs,
} from '@iptvnator/shared/interfaces';
import type {
    LiveOnNowProgram,
    LiveOnNowProgramSource,
    LiveOnNowRelativeTime,
} from './live-on-now.model';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Reads a programme boundary as wall-clock milliseconds in the PROVIDER's
 * clock: the cached unix-second timestamp when it is usable, else the ISO
 * string. Zero, negative or non-finite timestamps fall back to the string,
 * matching `getProgramTimeMs` in `@iptvnator/ui/epg`.
 */
function programBoundaryMs(
    seconds: number | null | undefined,
    iso: string | null | undefined
): number | null {
    if (Number.isFinite(seconds) && Number(seconds) > 0) {
        return Number(seconds) * 1000;
    }
    const parsed = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function pad(value: number): string {
    return value.toString().padStart(2, '0');
}

/** "HH:mm" in the viewer's local time. */
export function formatLiveOnNowClock(ms: number): string {
    const date = new Date(ms);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Picks the programme airing now from `programs` and shapes it for a tile.
 *
 * `nowMs` is wall-clock; `offsetMinutes` is the EPG display offset applied
 * in its two forms (`epg-display-offset.util.ts`), one per comparison: the
 * airing test, progress and minutes-left compare the raw times with the
 * provider clock, while the printed times are shifted for display.
 *
 * Returns null when nothing is airing now or the current programme has no
 * title — a tile must never show a progress bar for a programme that is not
 * on, nor a bar with no headline above it. A programme with a title but no
 * usable times is returned without range/progress so the host can at least
 * name it.
 */
export function pickLiveOnNowProgram(
    programs: readonly LiveOnNowProgramSource[] | null | undefined,
    nowMs: number,
    offsetMinutes = 0
): LiveOnNowProgram | null {
    if (!programs?.length) {
        return null;
    }
    const providerNow = epgProviderClockMs(nowMs, offsetMinutes);
    let untimed: LiveOnNowProgramSource | null = null;

    for (const program of programs) {
        const title = program.title?.trim();
        if (!title) {
            continue;
        }
        const start = programBoundaryMs(program.startTimestamp, program.start);
        const stop = programBoundaryMs(program.stopTimestamp, program.stop);
        if (start === null || stop === null) {
            if (!untimed) {
                untimed = program;
            }
            continue;
        }
        if (stop <= start || providerNow < start || providerNow >= stop) {
            continue;
        }
        const ratio = (providerNow - start) / (stop - start);
        return {
            title,
            timeRange: `${formatLiveOnNowClock(
                epgDisplayTimeMs(start, offsetMinutes)
            )} – ${formatLiveOnNowClock(epgDisplayTimeMs(stop, offsetMinutes))}`,
            endsAt: formatLiveOnNowClock(epgDisplayTimeMs(stop, offsetMinutes)),
            minutesLeft: Math.max(
                0,
                Math.ceil((stop - providerNow) / MINUTE_MS)
            ),
            progress: Math.max(0, Math.min(100, ratio * 100)),
        };
    }

    // Only a single, time-less entry can be taken at face value: a list
    // with real times whose entries are all over means nothing is on.
    if (untimed && programs.length === 1) {
        return {
            title: untimed.title?.trim() ?? '',
            timeRange: null,
            endsAt: null,
            minutesLeft: null,
            progress: null,
        };
    }
    return null;
}

/**
 * Parses the various "when was this watched" values the hosts persist:
 * unix seconds or milliseconds (number or digit string), SQLite
 * `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`, which is UTC but carries no
 * zone, so `Date.parse` would read it as local time), and ISO strings.
 * Returns 0 for anything unusable.
 */
export function parseLiveOnNowTimestamp(value: unknown): number {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return 0;
        return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return 0;
    }
    if (/^\d+$/.test(trimmed)) {
        return parseLiveOnNowTimestamp(Number(trimmed));
    }
    const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(trimmed);
    const parsed = Date.parse(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isSameLocalDay(left: Date, right: Date): boolean {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

/**
 * "just now" / "12 min ago" / "3 h ago" / "today at 21:04" /
 * "yesterday at 21:04" / "on 12/03/2026", as a translation key + params.
 * A future or unusable `watchedAtMs` reads as "just now".
 */
export function describeLiveOnNowRelativeTime(
    watchedAtMs: number,
    nowMs: number,
    locale?: string
): LiveOnNowRelativeTime {
    const elapsed = nowMs - watchedAtMs;
    if (!Number.isFinite(elapsed) || watchedAtMs <= 0 || elapsed < MINUTE_MS) {
        return { key: 'LIVE_ON_NOW.JUST_NOW' };
    }
    if (elapsed < HOUR_MS) {
        return {
            key: 'LIVE_ON_NOW.MINUTES_AGO',
            params: { count: Math.floor(elapsed / MINUTE_MS) },
        };
    }
    const watched = new Date(watchedAtMs);
    const now = new Date(nowMs);
    const time = formatLiveOnNowClock(watchedAtMs);
    if (isSameLocalDay(watched, now)) {
        return elapsed < 6 * HOUR_MS
            ? {
                  key: 'LIVE_ON_NOW.HOURS_AGO',
                  params: { count: Math.floor(elapsed / HOUR_MS) },
              }
            : { key: 'LIVE_ON_NOW.TODAY_AT', params: { time } };
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameLocalDay(watched, yesterday)) {
        return { key: 'LIVE_ON_NOW.YESTERDAY_AT', params: { time } };
    }
    return {
        key: 'LIVE_ON_NOW.ON_DATE',
        params: { date: watched.toLocaleDateString(locale) },
    };
}

/**
 * Stable 0–359 hue derived from the channel name: live channels carry no
 * artwork beyond a small logo, so each tile gets a name-keyed tint the way
 * the dashboard hero tints its ambient backdrop from the title.
 */
export function liveOnNowTileHue(name: string): number {
    let hash = 0;
    for (const char of name.trim().toLowerCase()) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash) % 360;
}

/** Up to two initials for the logo fallback ("Aurora News" → "AN"). */
export function liveOnNowInitials(name: string): string {
    const words = name
        .split(/[\s\-_|/]+/)
        .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean);
    const initials =
        words.length >= 2
            ? `${words[0][0]}${words[1][0]}`
            : (words[0] ?? '').slice(0, 2);
    return initials.toUpperCase();
}
