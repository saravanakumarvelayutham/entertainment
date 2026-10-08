import type { DatabaseService } from '@iptvnator/services';
import type {
    AiRecommendationRankResponse,
    AiRecommendationSettings,
    AiRecommendationTasteSignals,
} from '@iptvnator/shared/interfaces';
import { canonicalDashboardAiSignals } from './dashboard-ai-response.util';
import type { DashboardRecommendationItem } from './dashboard-recommendations.util';

export function dashboardAiResultKey(
    config: AiRecommendationSettings,
    candidates: readonly DashboardRecommendationItem[],
    signals?: AiRecommendationTasteSignals
): string {
    const publicCandidates = candidates
        .map((item) => ({
            id: item.mediaType + ':' + item.tmdbId,
            title: item.title,
            year: item.year,
            mediaType: item.mediaType,
            genreIds: [...item.genreIds].sort((a, b) => a - b),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const evidence = canonicalDashboardAiSignals(signals);
    return JSON.stringify({
        model: config.model,
        preferences: config.preferences,
        learnFromHistory: config.learnFromHistory,
        candidates: publicCandidates,
        tasteSignals: evidence,
    });
}
function publicResponse(
    response: AiRecommendationRankResponse
): AiRecommendationRankResponse {
    return {
        ranked: response.ranked.map(({ id, reason }) => ({ id, reason })),
        ...(response.tasteSummary
            ? { tasteSummary: response.tasteSummary }
            : {}),
        suggestedTitles: (response.suggestedTitles ?? []).map(
            ({ title, mediaType }) => ({ title, mediaType })
        ),
        discoveryGenres: (response.discoveryGenres ?? []).map(
            ({ genreId, mediaType }) => ({ genreId, mediaType })
        ),
    };
}

export const AI_RESULT_CACHE_TTL = 24 * 60 * 60 * 1000;
export const AI_RESULT_CACHE_KEY = 'recommendations:ai-results:v1';
interface CacheEntry {
    key: string;
    savedAt: number;
    response: AiRecommendationRankResponse;
}

/** Persist public ranking data only; playback sources are resolved by the caller. */
export class DashboardAiResultCache {
    private entries: CacheEntry[] = [];
    private loaded: Promise<void> | null = null;
    private writes: Promise<void> = Promise.resolve();
    constructor(
        private readonly database: Pick<
            DatabaseService,
            'getAppStateOrThrow' | 'setAppState'
        >
    ) {}

    peek(key: string): AiRecommendationRankResponse | null {
        const entry = this.entries.find((item) => item.key === key);
        return entry &&
            entry.savedAt <= Date.now() &&
            Date.now() - entry.savedAt < AI_RESULT_CACHE_TTL
            ? entry.response
            : null;
    }
    async read(key: string): Promise<AiRecommendationRankResponse | null> {
        this.loaded ??= this.load();
        await this.loaded;
        return this.peek(key);
    }
    async save(
        key: string,
        response: AiRecommendationRankResponse
    ): Promise<void> {
        // Settle startup reads before they can overwrite a newly generated result.
        await this.read(key).catch(() => null);
        this.entries = [
            ...this.entries.filter(
                (item) =>
                    item.key !== key &&
                    Date.now() - item.savedAt < AI_RESULT_CACHE_TTL
            ),
            { key, savedAt: Date.now(), response: publicResponse(response) },
        ].slice(-8);
        const snapshot = JSON.stringify(this.entries);
        const write = this.writes.then(async () => {
            if (
                !(await this.database.setAppState(
                    AI_RESULT_CACHE_KEY,
                    snapshot
                ))
            )
                throw new Error('AI result cache could not be saved.');
        });
        this.writes = write.catch(() => undefined);
        await write;
    }
    private async load(): Promise<void> {
        const raw = await this.database.getAppStateOrThrow(AI_RESULT_CACHE_KEY);
        if (!raw) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (!Array.isArray(parsed)) return;
        this.entries = parsed
            .slice(-8)
            .filter((entry): entry is CacheEntry => {
                if (
                    !entry ||
                    typeof entry.key !== 'string' ||
                    entry.key.length > 100000 ||
                    !Number.isFinite(entry.savedAt) ||
                    !entry.response
                )
                    return false;
                const {
                    ranked,
                    tasteSummary,
                    suggestedTitles,
                    discoveryGenres,
                } = entry.response;
                return (
                    Array.isArray(ranked) &&
                    ranked.length <= 20 &&
                    ranked.every(
                        (item: { id?: unknown; reason?: unknown }) =>
                            typeof item?.id === 'string' &&
                            /^(movie|tv):[1-9]\d*$/.test(item.id) &&
                            typeof item.reason === 'string' &&
                            item.reason.length <= 240
                    ) &&
                    (tasteSummary === undefined ||
                        (typeof tasteSummary === 'string' &&
                            !!tasteSummary.trim() &&
                            tasteSummary.length <= 1000)) &&
                    (suggestedTitles === undefined ||
                        (Array.isArray(suggestedTitles) &&
                            suggestedTitles.length <= 12 &&
                            suggestedTitles.every(
                                (item: {
                                    title?: unknown;
                                    mediaType?: unknown;
                                }) =>
                                    typeof item?.title === 'string' &&
                                    !!item.title.trim() &&
                                    item.title.length <= 300 &&
                                    ['movie', 'tv'].includes(
                                        String(item.mediaType)
                                    )
                            ))) &&
                    (discoveryGenres === undefined ||
                        (Array.isArray(discoveryGenres) &&
                            discoveryGenres.length <= 4 &&
                            discoveryGenres.every(
                                (item: {
                                    genreId?: unknown;
                                    mediaType?: unknown;
                                }) =>
                                    Number.isInteger(item?.genreId) &&
                                    Number(item.genreId) > 0 &&
                                    ['movie', 'tv'].includes(
                                        String(item.mediaType)
                                    )
                            )))
                );
            })
            .map(({ key, savedAt, response }) => ({
                key,
                savedAt,
                response: publicResponse(response),
            }));
    }
}
