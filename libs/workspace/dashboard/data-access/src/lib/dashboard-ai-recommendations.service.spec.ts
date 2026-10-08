import { DashboardAiRecommendationsService } from './dashboard-ai-recommendations.service';
import { TestBed } from '@angular/core/testing';
import { DatabaseService } from '@iptvnator/services';
import type { DashboardRecommendationItem } from './dashboard-recommendations.util';
import type { AiRecommendationRankResponse } from '@iptvnator/shared/interfaces';

const settings = {
    enabled: true,
    model: 'security',
    preferences: 'Slow-burn science fiction',
};
const candidate = (id = 1): DashboardRecommendationItem => ({
    tmdbId: id,
    mediaType: 'movie',
    title: `Movie ${id}`,
    originalTitle: null,
    year: 2020,
    posterUrl: null,
    rating: '8.0',
    genreIds: [878],
    seedTitle: 'Private watched title',
    match: {
        queryTitle: `Movie ${id}`,
        playlistId: 'private-source',
        playlistName: 'Private account',
        categoryId: 3,
        xtreamId: id,
        type: 'movie',
        trailingYear: null,
    },
});
const response = (id = 1): AiRecommendationRankResponse => ({
    ranked: [{ id: `movie:${id}`, reason: 'Thoughtful science fiction' }],
});
const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
};
function deferred() {
    let resolve!: (value: AiRecommendationRankResponse) => void;
    const promise = new Promise<AiRecommendationRankResponse>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('DashboardAiRecommendationsService', () => {
    let service: DashboardAiRecommendationsService;
    let rank: jest.Mock;
    let getAppStateOrThrow: jest.Mock;
    let setAppState: jest.Mock;
    const original = window.electron;
    beforeEach(() => {
        rank = jest.fn().mockResolvedValue(response());
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { rankAiRecommendations: rank },
        });
        getAppStateOrThrow = jest.fn().mockResolvedValue(null);
        setAppState = jest.fn().mockResolvedValue(true);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DatabaseService,
                    useValue: { getAppStateOrThrow, setAppState },
                },
            ],
        });
        service = TestBed.inject(DashboardAiRecommendationsService);
    });
    afterEach(() =>
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: original,
        })
    );

    it('sends only explicit preferences and whitelisted public metadata', async () => {
        service.refresh(settings, [candidate()]);
        await settle();
        expect(rank).toHaveBeenCalledWith({
            model: 'security',
            preferences: settings.preferences,
            candidates: [
                {
                    id: 'movie:1',
                    title: 'Movie 1',
                    year: 2020,
                    mediaType: 'movie',
                    genreIds: [878],
                },
            ],
        });
        expect(JSON.stringify(rank.mock.calls)).not.toContain('Private');
        expect(JSON.stringify(rank.mock.calls)).not.toContain('private-source');
        expect(service.items()[0].item.match.playlistId).toBe('private-source');
    });
    it('deduplicates and bounds the candidate pool', async () => {
        service.refresh(settings, [
            candidate(),
            ...Array.from({ length: 50 }, (_, i) => candidate(i + 1)),
        ]);
        await settle();
        expect(rank.mock.calls[0][0].candidates).toHaveLength(40);
    });
    it('does not request when disabled, preferences empty or bridge absent', () => {
        service.refresh({ ...settings, enabled: false }, [candidate()]);
        service.refresh({ ...settings, preferences: ' ' }, [candidate()]);
        service.refresh(settings, []);
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: undefined,
        });
        service.refresh(settings, [candidate()]);
        expect(rank).not.toHaveBeenCalled();
        expect(service.loading()).toBe(false);
    });
    it('caches completed requests and does not duplicate an in-flight request', async () => {
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise);
        service.refresh(settings, [candidate()]);
        service.refresh(settings, [candidate()]);
        pending.resolve(response());
        await settle();
        service.refresh(settings, [candidate()]);
        expect(rank).toHaveBeenCalledTimes(1);
        expect(service.items()).toHaveLength(1);
    });
    it('discards stale results and serializes the latest request', async () => {
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(
            response(3)
        );
        service.refresh(settings, [candidate()]);
        service.refresh(settings, [candidate(2)]);
        service.refresh(settings, [candidate(3)]);
        expect(rank).toHaveBeenCalledTimes(1);
        pending.resolve(response());
        await settle();
        expect(rank).toHaveBeenCalledTimes(2);
        expect(rank.mock.calls[1][0].candidates[0].id).toBe('movie:3');
        expect(service.items()[0].item.tmdbId).toBe(3);
    });
    it('does not restore results after opting out', async () => {
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise);
        service.refresh(settings, [candidate()]);
        service.refresh({ ...settings, enabled: false }, [candidate()]);
        pending.resolve(response());
        await settle();
        expect(service.items()).toEqual([]);
        expect(service.failed()).toBe(false);
    });
    it('uses a cached selection even while an obsolete request is pending', async () => {
        service.refresh(settings, [candidate()]);
        await settle();
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise);
        service.refresh(settings, [candidate(2)]);
        service.refresh(settings, [candidate()]);
        pending.resolve(response(2));
        await settle();
        expect(rank).toHaveBeenCalledTimes(2);
        expect(service.items()[0].item.tmdbId).toBe(1);
    });
    it('latches failure without automatic retries and supports explicit Retry', async () => {
        rank.mockRejectedValueOnce(new Error('unavailable'));
        service.refresh(settings, [candidate()]);
        await settle();
        expect(service.failed()).toBe(true);
        service.refresh(settings, [candidate()]);
        expect(rank).toHaveBeenCalledTimes(1);
        service.refresh(settings, [candidate()], true);
        await settle();
        expect(rank).toHaveBeenCalledTimes(2);
        expect(service.failed()).toBe(false);
    });
    it('ignores unknown and duplicate IDs', async () => {
        rank.mockResolvedValue({
            ranked: [
                ...response().ranked,
                ...response().ranked,
                { id: 'movie:99', reason: 'invented' },
            ],
        });
        service.refresh(settings, [candidate()]);
        await settle();
        expect(service.items()).toHaveLength(1);
    });
    it('shows failure for empty rankings', async () => {
        rank.mockResolvedValue({ ranked: [] });
        service.refresh(settings, [candidate()]);
        await settle();
        expect(service.failed()).toBe(true);
        expect(service.items()).toEqual([]);
    });

    const tasteSignals = {
        watched: [
            {
                title: 'Arrival',
                mediaType: 'movie' as const,
                completion: 'completed' as const,
            },
        ],
        favorites: [],
        votes: [],
    };
    const learnedSettings = {
        ...settings,
        preferences: '',
        learnFromHistory: true,
    };
    const learnedResponse = {
        ...response(),
        tasteSummary: 'You enjoy thoughtful science fiction.',
    };
    const finishProfile = async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
    };

    it('learns from selected signals without written preferences and saves a local profile', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(rank.mock.calls[0][0].tasteSignals).toEqual(tasteSignals);
        expect(service.tasteSummary()).toBe(learnedResponse.tasteSummary);
        expect(setAppState).toHaveBeenCalledWith(
            'recommendations:ai-taste-profile:v1',
            expect.stringContaining(learnedResponse.tasteSummary)
        );
    });

    it('does not transmit history when learning is disabled', async () => {
        service.refresh(
            { ...settings, learnFromHistory: false },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(rank.mock.calls[0][0]).not.toHaveProperty('tasteSignals');
    });

    it('learns and persists a profile even when no catalog candidates are available', async () => {
        rank.mockResolvedValue({
            ranked: [],
            tasteSummary: learnedResponse.tasteSummary,
        });
        service.refresh(learnedSettings, [], false, tasteSignals);
        await finishProfile();
        expect(rank.mock.calls[0][0].candidates).toEqual([]);
        expect(service.tasteSummary()).toBe(learnedResponse.tasteSummary);
        expect(service.failed()).toBe(false);
        expect(setAppState).toHaveBeenCalled();
    });

    it('requests a new ranking and profile when only watch completion changes', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        service.refresh(learnedSettings, [candidate()], false, {
            ...tasteSignals,
            watched: [
                { ...tasteSignals.watched[0], completion: 'in-progress' },
            ],
        });
        await finishProfile();
        expect(rank).toHaveBeenCalledTimes(2);
    });

    it('does not restore or persist a late profile after opting out', async () => {
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        service.refresh(
            { ...learnedSettings, enabled: false },
            [candidate()],
            false,
            tasteSignals
        );
        pending.resolve(learnedResponse);
        await finishProfile();
        expect(service.tasteSummary()).toBeNull();
        expect(setAppState).not.toHaveBeenCalled();
    });

    it('restores cached rankings and profile together after taste A to B to A', async () => {
        rank.mockResolvedValueOnce(learnedResponse).mockResolvedValueOnce({
            ...response(),
            tasteSummary: 'You enjoy comedy.',
        });
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        service.refresh(
            { ...learnedSettings, preferences: 'Comedy' },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(service.tasteSummary()).toBe('You enjoy comedy.');
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(rank).toHaveBeenCalledTimes(2);
        expect(service.tasteSummary()).toBe(learnedResponse.tasteSummary);
        expect(JSON.parse(setAppState.mock.calls.at(-1)?.[1]).summary).toBe(
            learnedResponse.tasteSummary
        );
    });

    it('reports profile read failures but can repair persistence with a fresh successful response', async () => {
        getAppStateOrThrow.mockRejectedValueOnce(
            new Error('Storage unavailable')
        );
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(service.profilePersistenceFailed()).toBe(true);
        expect(service.tasteSummary()).toBeNull();
        pending.resolve(learnedResponse);
        await finishProfile();
        expect(service.profilePersistenceFailed()).toBe(false);
        expect(service.tasteSummary()).toBe(learnedResponse.tasteSummary);
        expect(setAppState).toHaveBeenCalled();
    });

    it('restores a persisted profile only for matching settings and evidence', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        const saved = setAppState.mock.calls[0][1];
        getAppStateOrThrow.mockResolvedValue(saved);
        const restored = TestBed.runInInjectionContext(
            () => new DashboardAiRecommendationsService()
        );
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise).mockReturnValueOnce(
            new Promise(() => undefined)
        );
        restored.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(restored.tasteSummary()).toBe(learnedResponse.tasteSummary);
        restored.refresh(
            { ...learnedSettings, preferences: 'Comedies' },
            [],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(restored.tasteSummary()).toBeNull();
        pending.resolve(learnedResponse);
        await finishProfile();
        expect(restored.tasteSummary()).toBeNull();
    });

    it('keeps regular recommendations on invalid/missing learned profiles and flags failed persistence', async () => {
        rank.mockResolvedValueOnce(response());
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(service.failed()).toBe(true);
        expect(service.tasteSummary()).toBeNull();
        rank.mockResolvedValueOnce(learnedResponse);
        setAppState.mockResolvedValueOnce(false);
        service.refresh(learnedSettings, [candidate()], true, tasteSignals);
        await finishProfile();
        expect(service.failed()).toBe(false);
        expect(service.profilePersistenceFailed()).toBe(true);
        await service.retrySaveTasteProfile();
        expect(service.profilePersistenceFailed()).toBe(false);
        expect(rank).toHaveBeenCalledTimes(2);
    });
});
