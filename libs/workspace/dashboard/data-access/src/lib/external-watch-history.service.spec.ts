import { TestBed } from '@angular/core/testing';
import { DatabaseService } from '@iptvnator/services';
import { ExternalWatchHistoryService } from './external-watch-history.service';

describe('ExternalWatchHistoryService', () => {
    let getAppStateOrThrow: jest.Mock;

    function createService(): ExternalWatchHistoryService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DatabaseService,
                    useValue: {
                        getAppStateOrThrow,
                        setAppState: jest.fn(),
                    },
                },
            ],
        });
        return TestBed.inject(ExternalWatchHistoryService);
    }

    beforeEach(() => {
        getAppStateOrThrow = jest.fn();
    });

    it('shares the startup read with concurrent callers', async () => {
        let resolveRead!: (value: string) => void;
        getAppStateOrThrow.mockReturnValue(
            new Promise<string>((resolve) => {
                resolveRead = resolve;
            })
        );
        const service = createService();

        const first = service.load();
        const second = service.load();
        resolveRead(
            JSON.stringify({
                importedAt: '2026-09-15T12:00:00.000Z',
                entries: [
                    {
                        title: 'Saved title',
                        watchedAt: '2026-09-14T12:00:00.000Z',
                    },
                ],
            })
        );
        await Promise.all([first, second]);

        expect(getAppStateOrThrow).toHaveBeenCalledTimes(1);
        expect(service.entries()).toEqual([
            {
                title: 'Saved title',
                watchedAt: '2026-09-14T12:00:00.000Z',
            },
        ]);
    });

    it('retries after a failed startup read', async () => {
        getAppStateOrThrow
            .mockRejectedValueOnce(new Error('worker unavailable'))
            .mockResolvedValueOnce(
                JSON.stringify({
                    entries: [
                        {
                            title: 'Recovered title',
                            watchedAt: '2026-09-14T12:00:00.000Z',
                        },
                    ],
                })
            );
        const service = createService();

        await expect(service.load()).rejects.toThrow('worker unavailable');
        await service.load();

        expect(getAppStateOrThrow).toHaveBeenCalledTimes(2);
        expect(service.entries()[0].title).toBe('Recovered title');
    });

    it('does not repeatedly read a legitimately empty history', async () => {
        getAppStateOrThrow.mockResolvedValue(null);
        const service = createService();

        await service.load();
        await service.load();

        expect(getAppStateOrThrow).toHaveBeenCalledTimes(1);
    });
});
