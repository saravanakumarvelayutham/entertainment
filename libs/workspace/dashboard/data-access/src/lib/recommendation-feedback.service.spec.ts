import { TestBed } from '@angular/core/testing';
import { DatabaseService } from '@iptvnator/services';
import { RecommendationFeedbackService } from './recommendation-feedback.service';

describe('RecommendationFeedbackService', () => {
    let getAppStateOrThrow: jest.Mock;
    let setAppState: jest.Mock;

    const createService = () => {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DatabaseService,
                    useValue: { getAppStateOrThrow, setAppState },
                },
            ],
        });
        return TestBed.inject(RecommendationFeedbackService);
    };

    beforeEach(() => {
        getAppStateOrThrow = jest.fn().mockResolvedValue(null);
        setAppState = jest.fn().mockResolvedValue(true);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('restores persisted feedback and turns likes into genre affinities', async () => {
        getAppStateOrThrow.mockResolvedValue(
            JSON.stringify({
                entries: [
                    {
                        mediaType: 'movie',
                        tmdbId: 42,
                        genreIds: [28, 12],
                        choice: 'more-like-this',
                        updatedAt: '2026-09-15T12:00:00.000Z',
                    },
                ],
            })
        );
        const service = createService();

        await service.load();

        expect(service.choiceFor({ mediaType: 'movie', tmdbId: 42 })).toBe(
            'more-like-this'
        );
        expect(service.affinityWeights()).toEqual(
            new Map([
                ['movie:genre:28', 20],
                ['movie:genre:12', 20],
            ])
        );
    });

    it('persists dismissals before exposing them to the dashboard', async () => {
        const service = createService();

        await service.setFeedback(
            { mediaType: 'tv', tmdbId: 7, genreIds: [18] },
            'not-for-me'
        );

        expect(service.isDismissed({ mediaType: 'tv', tmdbId: 7 })).toBe(true);
        expect(setAppState).toHaveBeenCalledWith(
            'recommendations:feedback:v1',
            expect.stringContaining('not-for-me')
        );
    });

    it('keeps the previous choice when persistence fails', async () => {
        setAppState.mockResolvedValue(false);
        const service = createService();

        await expect(
            service.setFeedback(
                { mediaType: 'movie', tmdbId: 8, genreIds: [35] },
                'more-like-this'
            )
        ).rejects.toThrow('could not save recommendation feedback');

        expect(service.choiceFor({ mediaType: 'movie', tmdbId: 8 })).toBeNull();
    });
});
