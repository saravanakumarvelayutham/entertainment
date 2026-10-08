import { DashboardAiRecommendationsService } from './dashboard-ai-recommendations.service';
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
    const original = window.electron;
    beforeEach(() => {
        rank = jest.fn().mockResolvedValue(response());
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { rankAiRecommendations: rank },
        });
        service = new DashboardAiRecommendationsService();
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
});
