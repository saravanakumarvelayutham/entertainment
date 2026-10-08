import {
    DashboardAiRecommendationsService,
    dashboardAiEvidenceKey,
} from './dashboard-ai-recommendations.service';
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
    for (let i = 0; i < 30; i++) await Promise.resolve();
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
        await settle();
        expect(rank).toHaveBeenCalledTimes(1);
        expect(service.items()).toHaveLength(1);
    });
    it('discards stale results and serializes the latest request', async () => {
        const pending = deferred();
        rank.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(
            response(3)
        );
        service.refresh(settings, [candidate()]);
        await settle();
        service.refresh(settings, [candidate(2)]);
        service.refresh(settings, [candidate(3)]);
        await settle();
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
        await settle();
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
        for (let i = 0; i < 40; i++) await Promise.resolve();
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
        const writes = setAppState.mock.calls.filter(
            ([key]) => key === 'recommendations:ai-taste-profile:v1'
        );
        expect(JSON.parse(writes.at(-1)?.[1]).summary).toBe(
            'You enjoy comedy.'
        );
        service.refresh(
            { ...learnedSettings, preferences: 'Adventure' },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(rank.mock.calls[2][0].priorTasteSummary).toBe(
            'You enjoy comedy.'
        );
    });

    it('uses the previous saved taste summary when new feedback changes the learning fingerprint', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        const changed = {
            ...tasteSignals,
            favorites: [{ title: 'Comedy', mediaType: 'movie' as const }],
        };
        service.refresh(learnedSettings, [candidate()], false, changed);
        await finishProfile();
        expect(rank.mock.calls[1][0].priorTasteSummary).toBe(
            learnedResponse.tasteSummary
        );
        service.refresh(learnedSettings, [candidate()], false, changed);
        await finishProfile();
        expect(rank).toHaveBeenCalledTimes(2);
    });

    it('keeps previous context on restart even when the evidence or preferences changed', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        getAppStateOrThrow.mockResolvedValue(setAppState.mock.calls[0][1]);
        const restarted = TestBed.runInInjectionContext(
            () => new DashboardAiRecommendationsService()
        );
        restarted.refresh(
            { ...learnedSettings, preferences: 'Less violence' },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(rank.mock.calls[1][0].priorTasteSummary).toBe(
            learnedResponse.tasteSummary
        );
        expect(rank.mock.calls[1][0].preferences).toBe('Less violence');
    });

    it('does not share a saved taste summary in manual-only mode', async () => {
        getAppStateOrThrow.mockResolvedValue(
            JSON.stringify({
                fingerprint: 'old-learning',
                summary: 'Private learned tastes',
            })
        );
        service.refresh(
            { ...settings, learnFromHistory: false },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(rank.mock.calls[0][0]).not.toHaveProperty('priorTasteSummary');
        expect(rank.mock.calls[0][0]).not.toHaveProperty('tasteSignals');
    });

    it('caches bounded discovery hints alongside rankings and never displays a suggested title as a playable card', async () => {
        const hints = {
            suggestedTitles: [
                { title: 'AI suggestion', mediaType: 'movie' as const },
            ],
            discoveryGenres: [{ genreId: 878, mediaType: 'movie' as const }],
        };
        rank.mockResolvedValueOnce({
            ...learnedResponse,
            ...hints,
        }).mockResolvedValueOnce({ ...response(), tasteSummary: 'Comedy' });
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(service.discoveryHints()).toEqual(hints);
        expect(service.items()).toHaveLength(1);
        expect(service.items()[0].item.title).toBe('Movie 1');
        service.refresh(
            { ...learnedSettings, preferences: 'Comedy' },
            [candidate()],
            false,
            tasteSignals
        );
        await finishProfile();
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        expect(service.discoveryHints()).toEqual(hints);
        expect(rank).toHaveBeenCalledTimes(2);
    });

    it('retains only sanitized main error codes, latches them, and resets them on explicit retry', async () => {
        rank.mockRejectedValueOnce(
            new Error(
                'Error invoking remote method: secret [ai-recommendations:auth]'
            )
        );
        service.refresh(settings, [candidate()]);
        await finishProfile();
        expect(service.errorCode()).toBe('auth');
        service.refresh(settings, [candidate()]);
        expect(service.errorCode()).toBe('auth');
        service.refresh(settings, [candidate()], true);
        expect(service.errorCode()).toBeNull();
        await finishProfile();
        expect(service.errorCode()).toBeNull();
        rank.mockRejectedValueOnce(
            new Error('secret credentials [ai-recommendations:made-up]')
        );
        service.refresh(settings, [candidate(2)]);
        await finishProfile();
        expect(service.errorCode()).toBe('unavailable');
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
    it('reuses navigation results despite volatile source changes and transient disabled/empty pools', async () => {
        service.refresh(settings, [candidate(), candidate(2)]);
        await settle();
        service.refresh({ ...settings, enabled: false }, []);
        service.refresh(settings, []);
        const current = {
            ...candidate(),
            rating: '9.0',
            match: { ...candidate().match, playlistId: 'new-verified-source' },
        };
        service.refresh(settings, [candidate(2), current]);
        await settle();
        expect(rank).toHaveBeenCalledTimes(1);
        expect(service.items()[0].item).toBe(current);
        const cacheWrite = setAppState.mock.calls.find(
            ([key]) => key === 'recommendations:ai-results:v1'
        )[1];
        expect(cacheWrite).not.toContain('private-source');
        expect(cacheWrite).not.toContain('Private account');
        expect(cacheWrite).not.toContain('match');
    });
    it('restores results after restart and remaps them to the verified current pool', async () => {
        const store = new Map<string, string>();
        setAppState.mockImplementation(async (key, value) => {
            store.set(key, value);
            return true;
        });
        getAppStateOrThrow.mockImplementation(
            async (key) => store.get(key) ?? null
        );
        service.refresh(settings, [candidate()]);
        await settle();
        const restarted = TestBed.runInInjectionContext(
            () => new DashboardAiRecommendationsService()
        );
        const current = {
            ...candidate(),
            match: { ...candidate().match, playlistId: 'current-source' },
        };
        restarted.refresh(settings, [current]);
        await settle();
        expect(rank).toHaveBeenCalledTimes(1);
        expect(restarted.items()[0].item).toBe(current);
        restarted.refresh(settings, [current], true);
        await settle();
        expect(rank).toHaveBeenCalledTimes(2);
    });
    it('expires cached results after 24 hours and refreshes meaningful evidence', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(100000000);
        try {
            service.refresh(settings, [candidate()]);
            await settle();
            clock.mockReturnValue(100000000 + 24 * 60 * 60 * 1000);
            service.refresh(settings, [candidate()]);
            await settle();
            expect(rank).toHaveBeenCalledTimes(2);
            service.refresh({ ...settings, preferences: 'Comedies' }, [
                candidate(),
            ]);
            await settle();
            expect(rank).toHaveBeenCalledTimes(3);
        } finally {
            clock.mockRestore();
        }
    });
    it('ignores persisted entries whose ranked IDs are outside the verified pool', async () => {
        service.refresh(settings, [candidate()]);
        await settle();
        const saved = JSON.parse(
            setAppState.mock.calls.find(
                ([key]) => key === 'recommendations:ai-results:v1'
            )[1]
        );
        saved[0].response.ranked[0].id = 'movie:999';
        getAppStateOrThrow.mockResolvedValue(JSON.stringify(saved));
        const restarted = TestBed.runInInjectionContext(
            () => new DashboardAiRecommendationsService()
        );
        restarted.refresh(settings, [candidate()]);
        await settle();
        expect(rank).toHaveBeenCalledTimes(2);
        expect(restarted.items()[0].item.tmdbId).toBe(1);
    });
    it('retries failed result persistence locally without another inference', async () => {
        setAppState.mockResolvedValueOnce(false);
        service.refresh(settings, [candidate()]);
        await settle();
        expect(service.resultCachePersistenceFailed()).toBe(true);
        expect(service.items()).toHaveLength(1);
        await service.retrySaveResults();
        expect(service.resultCachePersistenceFailed()).toBe(false);
        expect(rank).toHaveBeenCalledTimes(1);
    });
    it('retains both base and expanded caches when discovery advances during profile persistence', async () => {
        const store = new Map<string, string>();
        let release!: () => void;
        const firstWrite = new Promise<void>((resolve) => {
            release = resolve;
        });
        let blocked = false;
        setAppState.mockImplementation(async (key, value) => {
            if (!blocked && key === 'recommendations:ai-taste-profile:v1') {
                blocked = true;
                await firstWrite;
            }
            store.set(key, value);
            return true;
        });
        getAppStateOrThrow.mockImplementation(
            async (key) => store.get(key) ?? null
        );
        rank.mockResolvedValueOnce(learnedResponse).mockResolvedValueOnce({
            ...learnedResponse,
            ranked: response(2).ranked,
        });
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await settle();
        expect(service.items()).toHaveLength(1);
        service.refresh(
            learnedSettings,
            [candidate(), candidate(2)],
            false,
            tasteSignals
        );
        release();
        await finishProfile();
        expect(
            JSON.parse(store.get('recommendations:ai-results:v1') ?? '[]')
        ).toHaveLength(2);
        const restarted = TestBed.runInInjectionContext(
            () => new DashboardAiRecommendationsService()
        );
        restarted.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        restarted.refresh(
            learnedSettings,
            [candidate(), candidate(2)],
            false,
            tasteSignals
        );
        await finishProfile();
        expect(rank).toHaveBeenCalledTimes(2);
    });
    it('does not republish identical hints, profile, or items when dashboard effects repeat the same cache key', async () => {
        rank.mockResolvedValue(learnedResponse);
        service.refresh(learnedSettings, [candidate()], false, tasteSignals);
        await finishProfile();
        const items = service.items();
        const hints = service.discoveryHints();
        const writes = setAppState.mock.calls.length;
        for (let i = 0; i < 5; i++)
            service.refresh(
                learnedSettings,
                [candidate()],
                false,
                tasteSignals
            );
        await finishProfile();
        expect(service.items()).toBe(items);
        expect(service.discoveryHints()).toBe(hints);
        expect(setAppState).toHaveBeenCalledTimes(writes);
        expect(rank).toHaveBeenCalledTimes(1);
    });
    it('canonicalizes evidence ordering and published hint ownership without new scans', async () => {
        rank.mockResolvedValue(learnedResponse);
        const signals = {
            ...tasteSignals,
            favorites: [
                { title: 'Arrival', mediaType: 'movie' as const },
                { title: 'Dune', mediaType: 'movie' as const },
            ],
        };
        service.refresh(learnedSettings, [candidate()], false, signals);
        await finishProfile();
        const reordered = {
            ...signals,
            favorites: [...signals.favorites].reverse(),
        };
        expect(dashboardAiEvidenceKey(learnedSettings, reordered)).toBe(
            dashboardAiEvidenceKey(learnedSettings, signals)
        );
        expect(service.discoveryEvidenceKey()).toBe(
            dashboardAiEvidenceKey(learnedSettings, signals)
        );
        service.refresh(learnedSettings, [candidate()], false, reordered);
        await finishProfile();
        expect(rank).toHaveBeenCalledTimes(1);
        service.refresh(
            { ...learnedSettings, enabled: false },
            [],
            false,
            reordered
        );
        expect(service.discoveryEvidenceKey()).toBeNull();
    });
});
