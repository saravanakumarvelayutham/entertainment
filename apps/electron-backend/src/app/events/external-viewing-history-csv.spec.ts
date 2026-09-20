import { parseExternalViewingHistory } from './external-viewing-history-csv';

describe('parseExternalViewingHistory', () => {
    it('retains only usable title and start-date rows from Prime Video exports', () => {
        const result = parseExternalViewingHistory(
            'Title,Playback Start Datetime (UTC),City\n"Reacher - Season 4",2026-09-03T21:01:58Z,Riverview\n"",2026-09-03T21:02:00Z,Riverview\nThe Runner,not-a-date,Riverview\n'
        );

        expect(result).toEqual({
            entries: [
                {
                    title: 'Reacher - Season 4',
                    watchedAt: '2026-09-03T21:01:58.000Z',
                },
            ],
            skipped: 2,
        });
    });

    it('continues to accept Netflix exports', () => {
        expect(
            parseExternalViewingHistory('Title,Date\nWednesday,2026-09-01\n')
        ).toEqual({
            entries: [
                { title: 'Wednesday', watchedAt: '2026-09-01T00:00:00.000Z' },
            ],
            skipped: 0,
        });
    });
});
