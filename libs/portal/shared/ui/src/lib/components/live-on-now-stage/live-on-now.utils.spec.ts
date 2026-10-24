import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    describeLiveOnNowRelativeTime,
    liveOnNowInitials,
    liveOnNowTileHue,
    parseLiveOnNowTimestamp,
    pickLiveOnNowProgram,
} from './live-on-now.utils';

// Local-time wall clock so the formatted range is stable in every timezone
// the suite runs in.
const START = new Date(2026, 0, 15, 20, 0, 0, 0);
const STOP = new Date(2026, 0, 15, 21, 0, 0, 0);
const QUARTER_MS = START.getTime() + 15 * 60_000;

function program(overrides: Partial<EpgProgram> = {}): EpgProgram {
    return {
        start: START.toISOString(),
        stop: STOP.toISOString(),
        channel: 'channel-1',
        title: 'Evening News',
        desc: null,
        category: null,
        ...overrides,
    };
}

describe('pickLiveOnNowProgram', () => {
    it('shapes the programme airing now with range, end, minutes left and progress', () => {
        expect(pickLiveOnNowProgram([program()], QUARTER_MS)).toEqual({
            title: 'Evening News',
            timeRange: '20:00 – 21:00',
            endsAt: '21:00',
            minutesLeft: 45,
            progress: 25,
        });
    });

    it('prefers the unix-second timestamps over the ISO strings', () => {
        const row = program({
            start: '2000-01-01T00:00:00.000Z',
            stop: '2000-01-01T01:00:00.000Z',
            startTimestamp: Math.floor(START.getTime() / 1000),
            stopTimestamp: Math.floor(STOP.getTime() / 1000),
        });

        expect(pickLiveOnNowProgram([row], QUARTER_MS)?.progress).toBe(25);
    });

    it('skips programmes that are over or not yet on, so a stale cache never draws a bar', () => {
        const later = program({
            title: 'Late Show',
            start: STOP.toISOString(),
            stop: new Date(2026, 0, 15, 22, 0).toISOString(),
        });

        expect(
            pickLiveOnNowProgram([program(), later], QUARTER_MS)?.title
        ).toBe('Evening News');
        expect(
            pickLiveOnNowProgram(
                [program(), later],
                new Date(2026, 0, 15, 23, 0).getTime()
            )
        ).toBeNull();
    });

    it('applies the EPG display offset in both forms', () => {
        // Provider labels the 20:00 programme as 19:00; +60 min corrects it.
        const row = program({
            start: new Date(2026, 0, 15, 19, 0).toISOString(),
            stop: new Date(2026, 0, 15, 20, 0).toISOString(),
        });

        expect(pickLiveOnNowProgram([row], QUARTER_MS, 60)).toEqual(
            expect.objectContaining({
                timeRange: '20:00 – 21:00',
                endsAt: '21:00',
                minutesLeft: 45,
                progress: 25,
            })
        );
        expect(pickLiveOnNowProgram([row], QUARTER_MS, 0)).toBeNull();
    });

    it('ignores untitled entries and returns null for empty input', () => {
        expect(
            pickLiveOnNowProgram([program({ title: '  ' })], QUARTER_MS)
        ).toBeNull();
        expect(pickLiveOnNowProgram([], QUARTER_MS)).toBeNull();
        expect(pickLiveOnNowProgram(null, QUARTER_MS)).toBeNull();
    });

    it('names a single time-less programme without any progress', () => {
        expect(
            pickLiveOnNowProgram(
                [{ title: 'Rolling coverage', start: '', stop: '' }],
                QUARTER_MS
            )
        ).toEqual({
            title: 'Rolling coverage',
            timeRange: null,
            endsAt: null,
            minutesLeft: null,
            progress: null,
        });
    });
});

describe('parseLiveOnNowTimestamp', () => {
    it('reads SQLite CURRENT_TIMESTAMP as UTC', () => {
        expect(parseLiveOnNowTimestamp('2026-07-02 10:00:00')).toBe(
            Date.parse('2026-07-02T10:00:00Z')
        );
    });

    it('scales unix seconds and keeps milliseconds', () => {
        expect(parseLiveOnNowTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
        expect(parseLiveOnNowTimestamp('1700000000000')).toBe(
            1_700_000_000_000
        );
    });

    it('returns 0 for unusable values', () => {
        expect(parseLiveOnNowTimestamp('')).toBe(0);
        expect(parseLiveOnNowTimestamp('yesterday')).toBe(0);
        expect(parseLiveOnNowTimestamp(undefined)).toBe(0);
    });
});

describe('describeLiveOnNowRelativeTime', () => {
    const now = new Date(2026, 2, 12, 21, 12).getTime();

    it('buckets by elapsed time and calendar day', () => {
        expect(describeLiveOnNowRelativeTime(now - 20_000, now)).toEqual({
            key: 'LIVE_ON_NOW.JUST_NOW',
        });
        expect(describeLiveOnNowRelativeTime(now - 12 * 60_000, now)).toEqual({
            key: 'LIVE_ON_NOW.MINUTES_AGO',
            params: { count: 12 },
        });
        expect(describeLiveOnNowRelativeTime(now - 3 * 3_600_000, now)).toEqual(
            {
                key: 'LIVE_ON_NOW.HOURS_AGO',
                params: { count: 3 },
            }
        );
        expect(
            describeLiveOnNowRelativeTime(
                new Date(2026, 2, 12, 9, 4).getTime(),
                now
            )
        ).toEqual({ key: 'LIVE_ON_NOW.TODAY_AT', params: { time: '09:04' } });
        expect(
            describeLiveOnNowRelativeTime(
                new Date(2026, 2, 11, 21, 4).getTime(),
                now
            )
        ).toEqual({
            key: 'LIVE_ON_NOW.YESTERDAY_AT',
            params: { time: '21:04' },
        });
        expect(
            describeLiveOnNowRelativeTime(
                new Date(2026, 2, 1, 21, 4).getTime(),
                now
            ).key
        ).toBe('LIVE_ON_NOW.ON_DATE');
    });

    it('treats a future or unknown time as just now', () => {
        expect(describeLiveOnNowRelativeTime(now + 60_000, now).key).toBe(
            'LIVE_ON_NOW.JUST_NOW'
        );
        expect(describeLiveOnNowRelativeTime(0, now).key).toBe(
            'LIVE_ON_NOW.JUST_NOW'
        );
    });
});

describe('tile helpers', () => {
    it('derives a stable hue and initials from the channel name', () => {
        expect(liveOnNowTileHue('Aurora News')).toBe(
            liveOnNowTileHue('aurora news')
        );
        expect(liveOnNowTileHue('Aurora News')).toBeGreaterThanOrEqual(0);
        expect(liveOnNowTileHue('Aurora News')).toBeLessThan(360);
        expect(liveOnNowInitials('Aurora News')).toBe('AN');
        expect(liveOnNowInitials('CNN')).toBe('CN');
        expect(liveOnNowInitials('  ')).toBe('');
    });
});
